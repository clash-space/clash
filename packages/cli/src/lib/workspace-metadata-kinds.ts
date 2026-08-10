import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createRequire } from "node:module";

import { z } from "zod";
import {
  getDeclaredAssetMetadataKind,
  registerAssetMetadataKind,
} from "@clash/shared-types";

/**
 * Workspace-declared custom metadata kinds: `.clash/metadata-kinds/*.json`.
 *
 * A team declares a kind as data -- a name plus a JSON Schema -- and every
 * generic surface (set/get/validate, the CAS projection loop, the fill trunk)
 * accepts it with no code change anywhere. The declaration must pin its own
 * `kind` and a `schemaVersion`, the same bar the in-code registry enforces.
 */

export const WORKSPACE_METADATA_KIND_DIR = join(".clash", "metadata-kinds");

const DeclarationSchema = z.object({
  kind: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/u,
      "kind must be dot-namespaced, like team.shot-notes",
    ),
  schema: z.record(z.string(), z.unknown()),
});

type CompiledValidator = (value: unknown) => Array<{ path: Array<string | number>; message: string }>;

function nodeRequire(): NodeRequire {
  // tsx runs this as ESM (import.meta.url is a file URL); the tsup CJS bundle
  // leaves import.meta.url undefined but provides a real `require`.
  const url = typeof import.meta !== "undefined" ? import.meta.url : undefined;
  if (typeof url === "string" && url) return createRequire(url);
  return eval("require") as NodeRequire;
}

function compileJsonSchema(kind: string, schema: Record<string, unknown>): CompiledValidator {
  // The registry's probe decides "does this schema pin kind and schemaVersion"
  // from issue paths, so ajv errors must be mapped onto real paths -- including
  // `required`, whose ajv error points at the parent, not the missing field.
  const require = nodeRequire();
  let AjvConstructor: new (options: Record<string, unknown>) => {
    compile(schema: unknown): ((value: unknown) => boolean) & { errors?: unknown[] | null };
  };
  try {
    const imported = require("ajv") as { default?: unknown };
    AjvConstructor = (imported.default ?? imported) as typeof AjvConstructor;
  } catch {
    throw new Error(
      `Custom metadata kind ${kind} needs the ajv JSON Schema validator, which is not installed.`,
    );
  }
  const ajv = new AjvConstructor({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  return (value) => {
    if (validate(value)) return [];
    return (validate.errors ?? []).map((raw) => {
      const error = raw as {
        instancePath?: string;
        keyword?: string;
        message?: string;
        params?: { missingProperty?: string };
      };
      const path = (error.instancePath ?? "")
        .split("/")
        .filter(Boolean)
        .map((segment) => segment.replace(/~1/gu, "/").replace(/~0/gu, "~"));
      if (error.keyword === "required" && error.params?.missingProperty) {
        path.push(error.params.missingProperty);
      }
      return { path, message: error.message ?? "invalid" };
    });
  };
}

export type LoadedWorkspaceMetadataKind = {
  kind: string;
  declarationPath: string;
};

const loadedWorkspaces = new Map<string, LoadedWorkspaceMetadataKind[]>();

/**
 * Load and register every kind declared in the workspace. Idempotent per cwd;
 * a bad declaration fails loudly with its file name rather than half-loading.
 */
export async function loadWorkspaceMetadataKinds(
  cwd: string,
): Promise<LoadedWorkspaceMetadataKind[]> {
  const cached = loadedWorkspaces.get(cwd);
  if (cached) return cached;

  const directory = join(cwd, WORKSPACE_METADATA_KIND_DIR);
  let entries: string[];
  try {
    entries = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch (error) {
    if (error && typeof error === "object" && (error as { code?: unknown }).code === "ENOENT") {
      loadedWorkspaces.set(cwd, []);
      return [];
    }
    throw error;
  }

  const loaded: LoadedWorkspaceMetadataKind[] = [];
  for (const name of entries) {
    const declarationPath = join(directory, name);
    let declaration: z.infer<typeof DeclarationSchema>;
    try {
      declaration = DeclarationSchema.parse(
        JSON.parse(await readFile(declarationPath, "utf8")),
      );
    } catch (error) {
      throw new Error(
        `Invalid metadata kind declaration ${declarationPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (getDeclaredAssetMetadataKind(declaration.kind)) {
      // Already registered (another cwd, or a product built-in like
      // media.transcript). First declaration wins; a workspace cannot shadow it.
      throw new Error(
        `${declarationPath}: ${declaration.kind} is already declared and cannot be redeclared`,
      );
    }
    const schemaProperties = declaration.schema.properties as
      | Record<string, { const?: unknown }>
      | undefined;
    const schemaRequired = Array.isArray(declaration.schema.required)
      ? (declaration.schema.required as unknown[])
      : [];
    if (
      schemaProperties?.kind?.const !== declaration.kind ||
      !schemaRequired.includes("kind") ||
      !schemaRequired.includes("schemaVersion")
    ) {
      throw new Error(
        `${declarationPath}: the schema must pin "kind" with const ${JSON.stringify(declaration.kind)} and require both "kind" and "schemaVersion"`,
      );
    }
    const validator = compileJsonSchema(declaration.kind, declaration.schema);
    registerAssetMetadataKind({
      kind: declaration.kind,
      schema: z.unknown().superRefine((value, context) => {
        for (const issue of validator(value)) {
          context.addIssue({
            code: "custom",
            path: issue.path,
            message: `${declaration.kind}: ${issue.message}`,
          });
        }
      }),
    });
    loaded.push({ kind: declaration.kind, declarationPath });
  }
  loadedWorkspaces.set(cwd, loaded);
  return loaded;
}

/**
 * Just the kind names a workspace declares. Used by surfaces that need to list
 * declarable kinds without loading their validators.
 */
export async function listDeclaredAssetMetadataKindNames(cwd: string): Promise<string[]> {
  const loaded = await loadWorkspaceMetadataKinds(cwd);
  return loaded.map((entry) => entry.kind);
}
