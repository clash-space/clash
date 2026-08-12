import { pluginIdSchema } from "@clash/shared-types";
import { Command } from "commander";
import {
  lstat,
  mkdir as mkdirAsync,
  readFile as readFileAsync,
  readdir as readdirAsync,
  rm,
  writeFile as writeFileAsync,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  CustomActionDefinitionSchema,
  ExecutablePluginManifestSchema,
  isSafePluginRelativePath,
  validateExecutablePluginPackage,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { assertDraftOutsideManagedStorage } from "../lib/plugin-draft-location";
import { buildPluginEntrypointIfDeclared } from "../lib/plugin-build";
import { isJsonMode, printJson } from "../lib/output";
import { sendProjectCommand } from "../lib/project-host-client";

const REGISTRY_URL =
  "https://raw.githubusercontent.com/clash-community/awesome-actions/main/registry.json";

/**
 * Plugin package lifecycle is owned by local-api. The CLI prepares packages
 * and sends them through the local host protocol; it never writes live host
 * storage or starts plugin subprocesses itself.
 */
async function requestLocalPluginHost<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${getServerUrl()}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  } & T;
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Local Clash host returned ${response.status} ${response.statusText}.`,
    );
  }
  return body;
}

export function customActionSecretHint(runtime: unknown): string {
  return runtime === "local"
    ? "  → Local actions read credentials from their local runtime environment."
    : "  → Remote worker action secrets are managed in hosted/remote Settings.";
}

/** Shape of the GET /api/v1/actions/:id/package response. */
interface ActionPackage {
  id: string;
  manifest: Record<string, unknown> & { id: string; version?: string };
  /** path → base64-encoded contents. */
  files: Record<string, string>;
}

export interface ValidatedDownloadedActionPackage extends ActionPackage {
  format: "legacy-custom-action" | "executable-plugin";
}

export interface LocalMarketplaceInstallResult {
  actionId: string;
  packageId: string;
  installed: boolean;
  targetDir: string;
}

export async function tryInstallLocalMarketplaceAction(options: {
  packageId: string;
  serverUrl: string;
  apiKey: string;
  request?: typeof fetch;
}): Promise<LocalMarketplaceInstallResult | null> {
  const request = options.request ?? fetch;
  const response = await request(
    `${options.serverUrl}/api/marketplace/actions/${encodeURIComponent(options.packageId)}/install`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${options.apiKey}` },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `Local marketplace returned ${response.status} ${response.statusText}` +
        (detail ? `: ${detail}` : ""),
    );
  }
  return (await response.json()) as LocalMarketplaceInstallResult;
}

function packageRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

/** Validate the complete package in memory before the installer mutates disk. */
export function validateDownloadedActionPackage(
  input: unknown,
): ValidatedDownloadedActionPackage {
  const pkg = packageRecord(input, "Action package");
  const id = typeof pkg.id === "string" ? pkg.id : "";
  if (!id) throw new Error("Action package id is required.");
  const manifestInput = packageRecord(pkg.manifest, "Action package manifest");
  const filesInput = packageRecord(pkg.files, "Action package files");
  const files: Record<string, string> = {};
  for (const [path, contents] of Object.entries(filesInput)) {
    if (!isSafePluginRelativePath(path)) {
      throw new Error(`Refusing suspicious file path in package: ${path}`);
    }
    if (typeof contents === "string") files[path] = contents;
  }

  if (manifestInput.apiVersion === "clash.plugin/v1") {
    const parsedManifest = ExecutablePluginManifestSchema.parse(manifestInput);
    const contributions = (
      parsedManifest as unknown as {
        contributes: {
          cards: Array<{ path: string }>;
          providers: Array<{ path: string }>;
          modelBindings: Array<{ path: string }>;
        };
      }
    ).contributes;
    if (parsedManifest.id !== id) {
      throw new Error(
        `Package id ${id} does not match plugin manifest id ${parsedManifest.id}.`,
      );
    }
    if (
      parsedManifest.runtime.kind === "local" &&
      typeof files[parsedManifest.runtime.entrypoint] !== "string"
    ) {
      throw new Error(
        `Plugin entrypoint ${parsedManifest.runtime.entrypoint} is missing.`,
      );
    }
    const cardDocuments: Record<string, unknown> = {};
    for (const card of contributions.cards) {
      const encoded = files[card.path];
      if (typeof encoded !== "string") {
        throw new Error(`Missing declared Card document: ${card.path}`);
      }
      try {
        cardDocuments[card.path] = JSON.parse(
          Buffer.from(encoded, "base64").toString("utf8"),
        );
      } catch (error) {
        throw new Error(
          `Invalid Card JSON at ${card.path}: ${(error as Error).message}`,
        );
      }
    }
    const providerDocuments: Record<string, unknown> = {};
    for (const provider of contributions.providers) {
      const encoded = files[provider.path];
      if (typeof encoded !== "string") {
        throw new Error(`Missing declared Provider document: ${provider.path}`);
      }
      try {
        providerDocuments[provider.path] = JSON.parse(
          Buffer.from(encoded, "base64").toString("utf8"),
        );
      } catch (error) {
        throw new Error(
          `Invalid Provider JSON at ${provider.path}: ${(error as Error).message}`,
        );
      }
    }
    const modelBindingDocuments: Record<string, unknown> = {};
    for (const binding of contributions.modelBindings) {
      const encoded = files[binding.path];
      if (typeof encoded !== "string") {
        throw new Error(
          `Missing declared model Provider binding: ${binding.path}`,
        );
      }
      try {
        modelBindingDocuments[binding.path] = JSON.parse(
          Buffer.from(encoded, "base64").toString("utf8"),
        );
      } catch (error) {
        throw new Error(
          `Invalid model Provider binding JSON at ${binding.path}: ${(error as Error).message}`,
        );
      }
    }
    const contractTestDocuments: Record<string, unknown> = {};
    for (const path of parsedManifest.contractTests) {
      const encoded = files[path];
      if (typeof encoded !== "string") {
        throw new Error(`Missing declared contract test: ${path}`);
      }
      try {
        contractTestDocuments[path] = JSON.parse(
          Buffer.from(encoded, "base64").toString("utf8"),
        );
      } catch (error) {
        throw new Error(
          `Invalid contract test JSON at ${path}: ${(error as Error).message}`,
        );
      }
    }
    const validated = validateExecutablePluginPackage(
      parsedManifest,
      cardDocuments,
      contractTestDocuments,
      {
        providers: providerDocuments,
        modelBindings: modelBindingDocuments,
      },
    );
    return {
      id,
      format: "executable-plugin",
      manifest: validated.manifest,
      files,
    };
  }

  const legacy = CustomActionDefinitionSchema.parse(manifestInput);
  if (legacy.id !== id) {
    throw new Error(
      `Package id ${id} does not match action manifest id ${legacy.id}.`,
    );
  }
  const entrypoint =
    typeof manifestInput.entrypoint === "string"
      ? manifestInput.entrypoint
      : "handler.py";
  if (!isSafePluginRelativePath(entrypoint)) {
    throw new Error(`Refusing suspicious action entrypoint: ${entrypoint}`);
  }
  if (legacy.runtime === "local" && typeof files[entrypoint] !== "string") {
    throw new Error(`Action entrypoint ${entrypoint} is missing.`);
  }
  return {
    id,
    format: "legacy-custom-action",
    manifest: { ...manifestInput, ...legacy, entrypoint },
    files,
  };
}

export interface ActivatedDownloadedActionPackage {
  id: string;
  version: string;
  targetDir: string;
  rollbackDir?: string;
  contractTests?: PluginContractTestRun;
}

export interface PluginContractTestRun {
  passed: number;
  results?: unknown[];
}

export interface ValidatedExecutablePluginDraft {
  package: ValidatedDownloadedActionPackage & { format: "executable-plugin" };
  contractTests: PluginContractTestRun;
}

export interface ScaffoldExecutablePluginDraftOptions {
  pluginDir: string;
  id: string;
  name?: string;
  kind?: "action" | "provider-projector" | "provider-executor";
  /**
   * Implementation language. TypeScript drafts carry source only and the host
   * compiles them; Python runs its source directly and declares no build.
   */
  language?: "ts" | "python";
}

export interface ScaffoldedExecutablePluginDraft {
  pluginDir: string;
  manifestPath: string;
  cardPath: string;
  contractTestPath: string;
  contractTests: PluginContractTestRun;
}

export interface CheckoutExecutablePluginDraftOptions {
  id: string;
  pluginDir: string;
}

/**
 * Copy one attested active package to a separate agent-editable draft. This
 * keeps exploratory edits from invalidating the running package receipt.
 */
export async function checkoutExecutablePluginDraft(
  options: CheckoutExecutablePluginDraftOptions,
): Promise<{ pluginDir: string; id: string; version: string }> {
  // One rule, in one place. A local copy of the pattern is a rule that can be right here and wrong
  // at activation, which is where an id mistake used to surface -- as a regex, in a schema error,
  // in a file the author had not opened.
  const id = pluginIdSchema.parse(options.id);
  const targetDir = resolve(options.pluginDir);
  const pkg = await requestLocalPluginHost<
    ValidatedDownloadedActionPackage & {
      version: string;
    }
  >(`/api/v1/local/plugins/${encodeURIComponent(id)}/package`);
  if (pkg.id !== id) {
    throw new Error(`Host returned plugin ${pkg.id} for ${id}.`);
  }

  await mkdirAsync(dirname(targetDir), { recursive: true });
  try {
    await mkdirAsync(targetDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Plugin draft directory already exists: ${targetDir}`);
    }
    throw error;
  }
  try {
    await writeFileAsync(
      join(targetDir, "manifest.json"),
      `${JSON.stringify(pkg.manifest, null, 2)}\n`,
    );
    for (const [relativePath, encoded] of Object.entries(pkg.files)) {
      const destination = join(targetDir, relativePath);
      await mkdirAsync(dirname(destination), { recursive: true });
      await writeFileAsync(destination, Buffer.from(encoded, "base64"));
    }
    return { pluginDir: targetDir, id, version: pkg.version };
  } catch (error) {
    await rm(targetDir, { recursive: true, force: true });
    throw error;
  }
}

function jsonDocument(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function defaultPluginName(id: string): string {
  return id
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

/**
 * Create a complete, editable local plugin package for an agent. The generated
 * Card, manifest, stdio handler and declarative contract are validated before
 * the directory is handed back. Existing paths are never merged or replaced.
 */
export async function scaffoldExecutablePluginDraft(
  options: ScaffoldExecutablePluginDraftOptions,
): Promise<ScaffoldedExecutablePluginDraft> {
  const pluginDir = resolve(options.pluginDir);
  const id = options.id.trim();
  const name = options.name?.trim() || defaultPluginName(id);
  const kind = options.kind ?? "action";
  if (
    kind !== "action" &&
    kind !== "provider-projector" &&
    kind !== "provider-executor"
  ) {
    throw new Error(`Unsupported plugin kind ${String(kind)}.`);
  }
  const language = options.language ?? "ts";
  if (language !== "ts" && language !== "python") {
    throw new Error(
      `Unsupported plugin language ${String(language)}; use ts or python.`,
    );
  }

  const functionKind = kind;
  const cardKind = kind === "action" ? "action-card" : "model-card";
  const outputSlot = kind === "action" ? "result" : "request";
  // An action returns rendered text; a projector returns the prompt it composed.
  const valueKey = kind === "action" ? "text" : "prompt";
  const cardPath = `cards/${id}.json`;
  const contractTestPath = `contract-tests/${id}.json`;
  const manifest = {
    apiVersion: "clash.plugin/v1",
    id,
    version: "0.1.0",
    name,
    description: `Agent-editable ${kind} plugin.`,
    runtime:
      language === "python"
        ? // Python runs its source directly, so there is nothing to build.
          {
            kind: "local",
            transport: "stdio",
            language: "python",
            entrypoint: "handler.py",
          }
        : // TypeScript is compiled by the host before validation, contract tests, and
          // activation, so the draft carries source only and never a stale bundle.
          {
            kind: "local",
            transport: "stdio",
            language: "node",
            entrypoint: "dist/stdio.mjs",
            build: { source: "src/stdio.ts" },
          },
    contributes: {
      cards: [{ id, kind: cardKind, path: cardPath }],
      functions: [{ id, kind: functionKind }],
    },
    contractTests: [contractTestPath],
  };
  const card =
    kind === "action"
      ? {
          apiVersion: "clash.card/v1",
          kind: "action-card",
          spec: {
            id,
            name,
            description:
              "Edit this Card to define the user-facing inputs and output.",
            parameters: [],
            outputType: "text",
            input: {
              requiresPrompt: true,
              inputMode: {},
              promptModalities: ["text"],
            },
            functionExportId: id,
          },
        }
      : {
          apiVersion: "clash.card/v1",
          kind: "model-card",
          spec: {
            id,
            aliases: [],
            name,
            provider: "fal",
            kind: "video",
            description:
              "Replace the placeholder upstream route and extend this Card.",
            parameters: [],
            defaultParams: {},
            defaultAspectRatio: "16:9",
            input: {
              requiresPrompt: true,
              inputMode: {},
              promptModalities: ["text"],
            },
            providerImplementations: [
              {
                providerId: "fal",
                upstreamId: `${id}:default`,
                upstreamModel: "replace-me",
                apiShape: "custom",
                projectorExportId: id,
              },
            ],
          },
        };
  const expectedValue =
    kind === "action"
      ? { text: "Describe the result" }
      : { prompt: "Describe the result" };
  const contractTest = {
    apiVersion: "clash.plugin.contract-test/v1",
    id: `${id}-basic`,
    target: { exportId: id, kind: functionKind },
    input: { values: { prompt: "Describe the result" }, references: [] },
    expect: {
      status: "completed",
      outputs: [
        {
          slot: kind === "action" ? "result" : "request",
          kind: "value",
          value: expectedValue,
        },
      ],
    },
  };

  // Reject malformed ids or generated contracts before touching the target.
  validateExecutablePluginPackage(
    manifest,
    { [cardPath]: card },
    { [contractTestPath]: contractTest },
  );

  await mkdirAsync(dirname(pluginDir), { recursive: true });
  try {
    await mkdirAsync(pluginDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Plugin draft directory already exists: ${pluginDir}`);
    }
    throw error;
  }

  try {
    await mkdirAsync(join(pluginDir, "cards"));
    await mkdirAsync(join(pluginDir, "contract-tests"));
    await writeFileAsync(
      join(pluginDir, "manifest.json"),
      jsonDocument(manifest),
    );
    await writeFileAsync(join(pluginDir, cardPath), jsonDocument(card));
    await writeFileAsync(
      join(pluginDir, contractTestPath),
      jsonDocument(contractTest),
    );
    if (language === "python") {
      // Python is the case with nothing to build, so the draft ships the program the
      // plugin runtime executes.
      await writeFileAsync(
        join(pluginDir, "handler.py"),
        [
          "import json",
          "import sys",
          "",
          `EXPORT_ID = ${JSON.stringify(id)}`,
          "",
          "for line in sys.stdin:",
          "    invocation = json.loads(line)",
          '    if invocation.get("protocol") != "clash.plugin.invoke/v1":',
          "        continue",
          '    prompt = (invocation.get("input") or {}).get("values", {}).get("prompt") or ""',
          '    if (invocation.get("target") or {}).get("exportId") == EXPORT_ID:',
          "        result = {",
          '            "protocol": "clash.plugin.result/v1",',
          '            "invocationId": invocation["invocationId"],',
          '            "status": "completed",',
          `            "outputs": [{"slot": ${JSON.stringify(outputSlot)}, "kind": "value", "value": {${JSON.stringify(valueKey)}: prompt}}],`,
          "        }",
          "    else:",
          "        result = {",
          '            "protocol": "clash.plugin.result/v1",',
          '            "invocationId": invocation["invocationId"],',
          '            "status": "failed",',
          '            "error": {"code": "UNKNOWN_EXPORT", "message": "Unknown export", "retryable": False},',
          "        }",
          '    sys.stdout.write(json.dumps(result) + "\\n")',
          "    sys.stdout.flush()",
          "",
        ].join("\n"),
      );
    } else {
      // TypeScript drafts carry source only. The host compiles it before validation,
      // contract tests, and activation, so an edited draft can never be checked
      // against a stale bundle.
      await mkdirAsync(join(pluginDir, "src"), { recursive: true });
      await writeFileAsync(
        join(pluginDir, "src", "stdio.ts"),
        [
          'import { createInterface } from "node:readline";',
          "",
          `const exportId = ${JSON.stringify(id)};`,
          "",
          'createInterface({ input: process.stdin }).on("line", (line) => {',
          "  const invocation = JSON.parse(line);",
          '  if (invocation.protocol !== "clash.plugin.invoke/v1") return;',
          '  const prompt = typeof invocation.input?.values?.prompt === "string"',
          "    ? invocation.input.values.prompt",
          '    : "";',
          "  const result = invocation.target?.exportId === exportId",
          "    ? {",
          '        protocol: "clash.plugin.result/v1",',
          "        invocationId: invocation.invocationId,",
          '        status: "completed",',
          `        outputs: [{ slot: ${JSON.stringify(outputSlot)}, kind: "value", value: { ${valueKey}: prompt } }],`,
          "      }",
          "    : {",
          '        protocol: "clash.plugin.result/v1",',
          "        invocationId: invocation.invocationId,",
          '        status: "failed",',
          '        error: { code: "UNKNOWN_EXPORT", message: "Unknown export", retryable: false },',
          "      };",
          "  process.stdout.write(`${JSON.stringify(result)}\\n`);",
          "});",
          "",
        ].join("\n"),
      );
    }
    await writeFileAsync(
      join(pluginDir, "AGENTS.md"),
      [
        "# Executable Plugin Authoring",
        "",
        "This directory is intentionally agent-editable.",
        "",
        "- Keep `manifest.json`, every Card, and every contract on the versioned Clash v1 schemas.",
        "- Declare Cards, Providers, bindings, functions, and host tools under `manifest.json#contributes`.",
        "- Keep provider wire-shape translation in the handler; keep user-facing fields in the Card.",
        "- Read account credentials and settings only from the Host-scoped `context.store`; never accept them from invocation values.",
        "- Use the SDK's typed `context.reference`, `context.upload`, and output shapes for Clash-owned assets.",
        "- Provider HTTP belongs to the plugin and uses its runtime's normal HTTP client directly.",
        "- Run `clash plugin validate .` after edits.",
        "- Bump `manifest.json` version for code or schema changes, then run `clash plugin activate .`.",
        "",
      ].join("\n"),
    );

    const validated = await validateExecutablePluginDraft(pluginDir);
    return {
      pluginDir,
      manifestPath: join(pluginDir, "manifest.json"),
      cardPath: join(pluginDir, cardPath),
      contractTestPath: join(pluginDir, contractTestPath),
      contractTests: validated.contractTests,
    };
  } catch (error) {
    await rm(pluginDir, { recursive: true, force: true });
    throw error;
  }
}

async function collectPluginDraftFiles(
  root: string,
  directory: string,
  output: Record<string, string>,
): Promise<void> {
  for (const entry of await readdirAsync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const absolutePath = join(directory, entry.name);
    const relativePath = absolutePath
      .slice(root.length + 1)
      .split("\\")
      .join("/");
    if (!isSafePluginRelativePath(relativePath)) {
      throw new Error(`Refusing suspicious draft path: ${relativePath}`);
    }
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(
        `Executable plugin drafts cannot contain symbolic links: ${relativePath}`,
      );
    }
    if (metadata.isDirectory()) {
      await collectPluginDraftFiles(root, absolutePath, output);
      continue;
    }
    if (!metadata.isFile() || relativePath === "manifest.json") continue;
    output[relativePath] = (await readFileAsync(absolutePath)).toString(
      "base64",
    );
  }
}

/** Load and strictly validate an agent-edited unpacked plugin directory. */
export async function packageExecutablePluginDraft(
  pluginDir: string,
): Promise<ValidatedDownloadedActionPackage & { format: "executable-plugin" }> {
  const manifest = JSON.parse(
    await readFileAsync(join(pluginDir, "manifest.json"), "utf8"),
  ) as {
    id?: unknown;
  };
  if (typeof manifest.id !== "string") {
    throw new Error("Executable plugin draft manifest id is required.");
  }
  const files: Record<string, string> = {};
  await collectPluginDraftFiles(pluginDir, pluginDir, files);
  const validated = validateDownloadedActionPackage({
    id: manifest.id,
    manifest,
    files,
  });
  if (validated.format !== "executable-plugin") {
    throw new Error(
      "Agent draft activation requires a clash.plugin/v1 package.",
    );
  }
  return validated as ValidatedDownloadedActionPackage & {
    format: "executable-plugin";
  };
}

/** Validate Cards/manifest and execute every declared contract without mutating active state. */
export async function validateExecutablePluginDraft(
  pluginDir: string,
): Promise<ValidatedExecutablePluginDraft> {
  // Compile before packaging, so the manifest, the content hash, and the contract
  // tests all describe the source that is actually present. Leaving this to the
  // author meant an edited `src/` could report `valid: true` while every check ran
  // against the previous bundle.
  await buildDeclaredPluginEntrypoint(pluginDir);
  const pkg = await packageExecutablePluginDraft(pluginDir);
  const validated = await requestLocalPluginHost<{
    contractTests?: PluginContractTestRun;
  }>("/api/v1/local/plugins/validate", {
    method: "POST",
    body: JSON.stringify(pkg),
  });
  const contractTests = validated.contractTests ?? { passed: 0 };
  return { package: pkg, contractTests };
}

/** Read the draft manifest and compile its entrypoint when one is declared derived. */
async function buildDeclaredPluginEntrypoint(pluginDir: string): Promise<void> {
  let runtime: unknown;
  try {
    const manifest = JSON.parse(
      await readFileAsync(join(pluginDir, "manifest.json"), "utf8"),
    ) as { runtime?: unknown; spec?: { runtime?: unknown } };
    runtime = manifest.runtime ?? manifest.spec?.runtime;
  } catch {
    // A malformed or missing manifest is reported by validation itself, with a much
    // better message than anything this step could produce.
    return;
  }
  if (!runtime || typeof runtime !== "object") return;
  await buildPluginEntrypointIfDeclared(
    pluginDir,
    runtime as { kind?: string },
  );
}

export interface ActivateExecutablePluginDraftOptions {
  pluginDir: string;
}

/**
 * Agent self-evolution gate: validate and test a draft, ask for any capability
 * increase, then atomically replace the active package with rollback retained.
 */
export async function activateExecutablePluginDraft(
  options: ActivateExecutablePluginDraftOptions,
): Promise<
  ActivatedDownloadedActionPackage & {
    contractTests: PluginContractTestRun;
  }
> {
  await buildDeclaredPluginEntrypoint(options.pluginDir);
  const pkg = await packageExecutablePluginDraft(options.pluginDir);
  const activated =
    await requestLocalPluginHost<ActivatedDownloadedActionPackage>(
      "/api/v1/local/plugins/activate",
      {
        method: "POST",
        body: JSON.stringify(pkg),
      },
    );
  return {
    ...activated,
    contractTests: activated.contractTests ?? { passed: 0 },
  };
}

/** Ask the local-api host to validate and atomically activate a package. */
export async function activateDownloadedActionPackage(
  input: unknown,
  _legacyRoot?: string,
): Promise<ActivatedDownloadedActionPackage> {
  const pkg = validateDownloadedActionPackage(input);
  if (pkg.format !== "executable-plugin") {
    throw new Error(
      "Legacy local action packages are no longer supported by local-api.",
    );
  }
  return requestLocalPluginHost<ActivatedDownloadedActionPackage>(
    "/api/v1/local/plugins/activate",
    { method: "POST", body: JSON.stringify(pkg) },
  );
}

/** Ask the local-api host to restore the newest retained package version. */
export async function rollbackDownloadedActionPackage(
  id: string,
): Promise<{ targetDir: string; version: string }> {
  return requestLocalPluginHost<{ targetDir: string; version: string }>(
    `/api/v1/local/plugins/${encodeURIComponent(pluginIdSchema.parse(id))}/rollback`,
    { method: "POST" },
  );
}

export const pluginCommand = new Command("plugin").description(
  "Create, validate, activate, and manage plugins",
);

pluginCommand
  // `create`, not `init`. The directory must not already exist, so this makes a new thing rather
  // than initialising the one you are standing in -- the distinction `npm init` and `npm create`
  // draw, and `cargo init` and `cargo new` after them.
  .command("create")
  .description(
    "Create a complete agent-editable plugin draft with a Card, handler, and contract",
  )
  .argument(
    "<directory>",
    "New plugin draft directory (must not already exist)",
  )
  .requiredOption("--id <id>", "Stable plugin and export id")
  .option("--name <name>", "User-facing plugin and Card name")
  .option(
    "--kind <kind>",
    "action, provider-projector, or provider-executor",
    "action",
  )
  .option("--lang <language>", "ts or python", "ts")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    try {
      assertDraftOutsideManagedStorage(directory);
      if (options.lang !== "ts" && options.lang !== "python") {
        throw new Error(
          `Unsupported --lang ${String(options.lang)}; expected ts or python.`,
        );
      }
      const created = await scaffoldExecutablePluginDraft({
        pluginDir: resolve(directory),
        id: options.id,
        name: options.name,
        kind: options.kind,
        language: options.lang,
      });
      const result = {
        created: true,
        path: created.pluginDir,
        manifest: created.manifestPath,
        card: created.cardPath,
        contract: created.contractTestPath,
        contractTests: created.contractTests,
      };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Created ${options.id} at ${created.pluginDir}; ` +
            `${created.contractTests.passed} contract test(s) passed.`,
        );
        console.log(
          `Edit the Card and handler, then run: clash plugin activate ${created.pluginDir}`,
        );
      }
    } catch (error) {
      console.error(
        `Plugin draft creation failed: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  });

pluginCommand
  .command("checkout")
  .description(
    "Copy an attested active plugin to a separate agent-editable draft",
  )
  .argument("<id>", "Active executable plugin id")
  .argument("<directory>", "New draft directory (must not already exist)")
  .option("--json", "Output as JSON")
  .action(async (id: string, directory: string, options) => {
    try {
      assertDraftOutsideManagedStorage(directory);
      const checkedOut = await checkoutExecutablePluginDraft({
        id,
        pluginDir: resolve(directory),
      });
      const result = { checkedOut: true, ...checkedOut };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Checked out ${checkedOut.id}@${checkedOut.version} to ${checkedOut.pluginDir}.`,
        );
        console.log(
          `Edit it, then run: clash plugin validate ${checkedOut.pluginDir}`,
        );
      }
    } catch (error) {
      console.error(`Plugin checkout failed: ${(error as Error).message}`);
      process.exit(1);
    }
  });

pluginCommand
  .command("validate")
  .description(
    "Validate an agent-edited executable plugin draft and run all declared contracts",
  )
  .argument("<directory>", "Unpacked plugin draft directory")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    const pluginDir = resolve(directory);
    try {
      assertDraftOutsideManagedStorage(pluginDir);
      const validated = await validateExecutablePluginDraft(pluginDir);
      const result = {
        valid: true,
        id: validated.package.id,
        version: validated.package.manifest.version ?? "0.0.0",
        path: pluginDir,
        contractTests: validated.contractTests,
      };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Validated ${result.id}@${result.version}: ` +
            `${result.contractTests.passed} contract test(s) passed.`,
        );
      }
    } catch (error) {
      console.error(
        `Plugin draft validation failed: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  });

pluginCommand
  .command("activate")
  .description(
    "Validate, contract-test, and atomically activate a plugin draft",
  )
  .argument("<directory>", "Unpacked plugin draft directory")
  .option("--json", "Output as JSON")
  .action(async (directory: string, options) => {
    const pluginDir = resolve(directory);
    try {
      assertDraftOutsideManagedStorage(pluginDir);
      const activated = await activateExecutablePluginDraft({
        pluginDir,
      });
      const result = {
        activated: true,
        id: activated.id,
        version: activated.version,
        path: activated.targetDir,
        rollbackPath: activated.rollbackDir,
        contractTests: activated.contractTests,
      };
      if (isJsonMode(options)) printJson(result);
      else {
        console.log(
          `Activated ${result.id}@${result.version}; ` +
            `${result.contractTests.passed} contract test(s) passed. The local host will hot-reload it.`,
        );
      }
    } catch (error) {
      console.error(
        `Plugin draft activation failed: ${(error as Error).message}`,
      );
      process.exit(1);
    }
  });

// ─── install ──────────────────────────────────────────

pluginCommand
  .command("install")
  .description(
    "Install an action. Two modes:\n" +
      "  clash plugin install <id>                                  activate through the local host\n" +
      "  clash plugin install --project <id> --repo owner/repo      register a project-level worker action",
  )
  .argument("[id]", "Action id to fetch from the server registry")
  .option(
    "--project <id>",
    "Project ID (for --repo / --url Loro register flow)",
  )
  .option(
    "--repo <owner/repo>",
    "GitHub repo (e.g. user/style-transfer-action)",
  )
  .option(
    "--url <workerUrl>",
    "Direct CF Worker URL for author-deployed actions",
  )
  .option("--json", "Output as JSON")
  .action(async (id: string | undefined, options) => {
    // Fetch the package, validate it client-side, then hand it to local-api.
    // Only local-api owns the live actions directory and plugin subprocesses.
    if (id && !options.repo && !options.url) {
      await installFromRegistry(id, options);
      return;
    }
    // If a project-level register was explicitly requested, ensure
    // --project is supplied (commander can't enforce a conditional
    // requirement, hence the manual check).
    if ((options.repo || options.url) && !options.project) {
      console.error("--project <id> is required when using --repo or --url");
      process.exit(1);
    }
    if (!id && !options.repo && !options.url) {
      console.error(
        "Provide an action id (e.g. `clash plugin install grid-split`)\n" +
          "or --repo / --url for the project-level register flow.",
      );
      process.exit(1);
    }

    let manifest: any;

    if (options.url) {
      // Mode A: Direct worker URL — fetch manifest from the worker
      try {
        const resp = await fetch(options.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "manifest" }),
        });
        if (resp.ok) {
          manifest = await resp.json();
        }
      } catch {
        // Worker doesn't support manifest endpoint — require manual info
      }

      if (!manifest) {
        console.error(
          "Could not fetch manifest from worker URL. Provide --repo to fetch action.json from GitHub.",
        );
        process.exit(1);
      }

      manifest.runtime = "worker";
      manifest.workerUrl = options.url;
    } else if (options.repo) {
      // Fetch action.json from GitHub
      const [owner, repo] = options.repo.includes("/")
        ? options.repo.split("/")
        : [null, null];
      if (!owner || !repo) {
        console.error("Invalid repo format. Use: owner/repo");
        process.exit(1);
      }

      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/action.json`;
      const resp = await fetch(rawUrl);
      if (!resp.ok) {
        console.error(
          `Failed to fetch action.json from ${rawUrl} (${resp.status})`,
        );
        process.exit(1);
      }
      manifest = await resp.json();
    } else {
      console.error("Provide --repo or --url");
      process.exit(1);
    }

    // Validate required fields
    const parsedManifest = CustomActionDefinitionSchema.safeParse(manifest);
    if (!parsedManifest.success) {
      console.error(`Invalid action manifest: ${parsedManifest.error.message}`);
      process.exit(1);
    }
    manifest = parsedManifest.data;

    const definition = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description || "",
      parameters: manifest.parameters || [],
      outputType: manifest.outputType || "image",
      icon: manifest.icon || "",
      color: manifest.color || "",
      runtime: manifest.runtime || "worker",
      version: manifest.version || "0.0.0",
      author: manifest.author || "",
      repository: manifest.repository || options.repo || "",
      workerUrl: manifest.workerUrl || options.url || "",
      secrets: manifest.secrets || [],
      model: manifest.model,
      pluginBinding: manifest.pluginBinding,
      tags: manifest.tags || [],
    };
    const registered = await sendProjectCommand<{
      error?: string;
      registered?: boolean;
    }>(options.project, {
      action: "register_custom_action",
      actionId: manifest.id,
      definition,
    });
    if (registered.error) throw new Error(registered.error);

    if (isJsonMode(options)) {
      printJson({
        installed: true,
        actionId: manifest.id,
        runtime: manifest.runtime,
      });
    } else {
      console.log(`Installed action: ${manifest.name} (${manifest.id})`);
      console.log(`  Runtime:  ${manifest.runtime || "worker"}`);
      console.log(`  Output:   ${manifest.outputType}`);
      if (manifest.workerUrl) console.log(`  Worker:   ${manifest.workerUrl}`);
      if (manifest.secrets?.length) {
        console.log(
          `  Requires: ${manifest.secrets.map((s: any) => s.id).join(", ")}`,
        );
        console.log(customActionSecretHint(manifest.runtime));
      }
    }
  });

// ─── list ─────────────────────────────────────────────

pluginCommand
  .command("list")
  .description(
    "List actions. Without --local, lists actions registered in a project " +
      "(requires --project). With --local, lists packages installed under $CLASH_HOME/actions/.",
  )
  .option("--project <id>", "Project ID (omit when using --local)")
  .option(
    "--local",
    "List packages installed locally under $CLASH_HOME/actions/",
  )
  .option("--json", "Output as JSON")
  .action(async (options) => {
    if (options.local) {
      const installed = await requestLocalPluginHost<
        Array<{
          id: string;
          name?: string;
          version?: string;
          targetDir: string;
          drifted: boolean;
        }>
      >("/api/v1/local/plugins");
      if (isJsonMode(options)) {
        printJson(installed);
      } else if (installed.length === 0) {
        console.log("No local plugins are active in the local host.");
        console.log("Install one with: clash plugin install <id>");
      } else {
        for (const a of installed) {
          const version = a.version ? `@${a.version}` : "";
          const drift = a.drifted
            ? "  ⚠ differs from its activation receipt"
            : "";
          console.log(
            `  🖥  ${(a.name ?? a.id).padEnd(25)} ${a.id}${version}${drift}`,
          );
        }
        if (installed.some((a) => a.drifted)) {
          console.log(
            "\nReactivate a drifted plugin before editing it: clash plugin activate <dir>",
          );
        }
        console.log(`\n${installed.length} local plugin(s)`);
      }
      return;
    }

    if (!options.project) {
      console.error(
        "--project <id> is required (or pass --local to list local installs)",
      );
      process.exit(1);
    }
    const listed = await sendProjectCommand<{
      error?: string;
      actions?: Record<string, unknown>;
    }>(options.project, { action: "list_custom_actions" });
    if (listed.error) throw new Error(listed.error);
    const actions = Object.values(listed.actions ?? {});

    if (isJsonMode(options)) {
      printJson(actions);
    } else if (actions.length === 0) {
      console.log(
        "No actions installed. Use `clash plugin install` to add one.",
      );
    } else {
      for (const a of actions) {
        const action = a as { runtime?: string; name?: string; id?: string };
        const runtime = action.runtime === "worker" ? "☁️" : "🖥";
        console.log(`  ${runtime} ${action.name?.padEnd(25)} ${action.id}`);
      }
      console.log(`\n${actions.length} action(s)`);
    }
  });

// ─── uninstall ────────────────────────────────────────
//
// local-api owns live plugin storage and moves removed packages to its trash.

pluginCommand
  .command("uninstall")
  .description("Remove a locally-installed plugin package from the local host")
  .argument("<id>", "Action id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    if (!options.yes) {
      const ok = await confirm(`Remove ${id} from the local host? [y/N] `);
      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
    }

    let removed: { id: string; removed: boolean; trashDir?: string };
    try {
      removed = await requestLocalPluginHost(
        `/api/v1/local/plugins/${encodeURIComponent(pluginIdSchema.parse(id))}`,
        { method: "DELETE" },
      );
    } catch (e) {
      console.error(`Failed to remove ${id}: ${(e as Error).message}`);
      process.exit(1);
    }

    if (isJsonMode(options)) {
      printJson({ uninstalled: removed.removed, ...removed });
    } else {
      console.log(
        removed.removed ? `Uninstalled ${id}.` : `${id} is not installed.`,
      );
    }
  });

pluginCommand
  .command("rollback")
  .description("Restore the newest retained local action/plugin version")
  .argument("<id>", "Action or plugin id")
  .option("-y, --yes", "Skip confirmation prompt")
  .option("--json", "Output as JSON")
  .action(async (id: string, options) => {
    if (!options.yes) {
      const ok = await confirm(
        `Roll back ${id} to its newest retained version? [y/N] `,
      );
      if (!ok) {
        console.log("Aborted.");
        process.exit(1);
      }
    }
    try {
      const restored = await rollbackDownloadedActionPackage(id);
      if (isJsonMode(options)) printJson({ rolledBack: true, id, ...restored });
      else console.log(`Rolled back ${id} to ${restored.version}.`);
    } catch (error) {
      console.error(`Failed to roll back ${id}: ${(error as Error).message}`);
      process.exit(1);
    }
  });

// ─── remove ───────────────────────────────────────────

pluginCommand
  .command("remove")
  .description("Remove an action from a project")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--action <id>", "Action ID to remove")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const removed = await sendProjectCommand<{
      error?: string;
      removed?: boolean;
    }>(options.project, {
      action: "unregister_custom_action",
      actionId: options.action,
    });
    if (removed.error) throw new Error(removed.error);

    if (isJsonMode(options)) {
      printJson({
        removed: removed.removed === true,
        actionId: options.action,
      });
    } else {
      console.log(`Removed action: ${options.action}`);
    }
  });

// ─── search ───────────────────────────────────────────

pluginCommand
  .command("search")
  .description("Search community actions from the awesome-list registry")
  .argument("<query>", "Search query")
  .option("--tag <tag>", "Filter by tag")
  .option("--json", "Output as JSON")
  .action(async (query: string, options) => {
    try {
      const resp = await fetch(REGISTRY_URL);
      if (!resp.ok) {
        console.error(
          `Failed to fetch registry (${resp.status}). Check your network.`,
        );
        process.exit(1);
      }

      const registry = (await resp.json()) as {
        actions: Array<{
          id: string;
          name: string;
          description?: string;
          repository?: string;
          runtime?: string;
          outputType?: string;
          tags?: string[];
          author?: string;
        }>;
      };

      let results = registry.actions;

      // Filter by tag
      if (options.tag) {
        results = results.filter((a) =>
          a.tags?.some((t) => t.toLowerCase() === options.tag.toLowerCase()),
        );
      }

      // Search by query
      const q = query.toLowerCase();
      results = results.filter(
        (a) =>
          a.name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q) ||
          (a.description || "").toLowerCase().includes(q) ||
          (a.tags || []).some((t) => t.toLowerCase().includes(q)),
      );

      if (isJsonMode(options)) {
        printJson(results);
      } else if (results.length === 0) {
        console.log(`No actions found for "${query}".`);
      } else {
        for (const a of results) {
          const runtime = a.runtime === "worker" ? "☁️" : "🖥";
          console.log(`  ${runtime} ${a.name}`);
          console.log(
            `    ${a.id} · ${a.outputType || "image"} · ${a.author || "unknown"}`,
          );
          if (a.description) console.log(`    ${a.description}`);
          if (a.repository) console.log(`    → ${a.repository}`);
          console.log();
        }
        console.log(`${results.length} result(s)`);
      }
    } catch (e) {
      console.error("Failed to search registry:", e);
      process.exit(1);
    }
  });

// ─── helpers (registry-install flow) ──────────────────

/**
 * Fetch a package from the server registry and ask local-api to activate it.
 *
 * If the same version is already active, report an idempotent no-op.
 */
async function installFromRegistry(
  id: string,
  options: { json?: boolean },
): Promise<void> {
  const apiKey = requireApiKey();
  const serverUrl = getServerUrl();
  const url = `${serverUrl}/api/v1/actions/${encodeURIComponent(id)}/package`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    console.error(
      `Failed to reach server ${serverUrl}: ${(e as Error).message}`,
    );
    process.exit(1);
  }
  if (resp.status === 404) {
    const marketplaceInstall = await tryInstallLocalMarketplaceAction({
      packageId: id,
      serverUrl,
      apiKey,
    }).catch((error) => {
      console.error(
        `Failed to install local marketplace action: ${(error as Error).message}`,
      );
      process.exit(1);
    });
    if (marketplaceInstall) {
      if (isJsonMode(options)) {
        printJson(marketplaceInstall);
      } else {
        const verb = marketplaceInstall.installed
          ? "Installed"
          : "Already installed";
        console.log(
          `${verb} ${marketplaceInstall.actionId} from ${marketplaceInstall.packageId}.`,
        );
        console.log(`Path: ${marketplaceInstall.targetDir}`);
      }
      return;
    }
    console.error(`Unknown action: ${id}`);
    process.exit(1);
  }
  if (!resp.ok) {
    console.error(
      `Server returned ${resp.status} ${resp.statusText} for ${url}`,
    );
    const body = await resp.text().catch(() => "");
    if (body) console.error(body);
    process.exit(1);
  }

  let pkg: ValidatedDownloadedActionPackage;
  try {
    pkg = validateDownloadedActionPackage(await resp.json());
  } catch (error) {
    console.error(`Invalid action package: ${(error as Error).message}`);
    process.exit(1);
  }
  if (pkg.id !== id) {
    console.error(
      `Server returned a package with mismatched id (${pkg.id} != ${id})`,
    );
    process.exit(1);
  }

  const newVersion = pkg.manifest.version ?? "0.0.0";
  let activated: ActivatedDownloadedActionPackage;
  try {
    activated = await activateDownloadedActionPackage(pkg);
  } catch (error) {
    if (/version .* is already active/i.test((error as Error).message)) {
      if (isJsonMode(options)) {
        printJson({
          installed: false,
          id,
          version: newVersion,
          reason: "already-installed",
        });
      } else {
        console.log(`${id}@${newVersion} is already active.`);
      }
      return;
    }
    throw error;
  }

  if (isJsonMode(options)) {
    printJson({
      installed: true,
      id,
      version: newVersion,
      path: activated.targetDir,
      files: Object.keys(pkg.files),
      rollbackPath: activated.rollbackDir,
    });
  } else {
    console.log(`Installed ${id}@${newVersion} to ${activated.targetDir}.`);
    console.log("The local host will hot-reload it.");
  }
}

/** Tiny readline-based y/N prompt — avoids pulling in a dep for this. */
async function confirm(question: string): Promise<boolean> {
  // If stdin isn't a TTY (e.g. piped automation), require -y explicitly
  // rather than silently defaulting to "yes".
  if (!process.stdin.isTTY) return false;
  process.stdout.write(question);
  return new Promise<boolean>((resolve) => {
    const onData = (chunk: Buffer) => {
      const ans = chunk.toString("utf-8").trim().toLowerCase();
      process.stdin.removeListener("data", onData);
      process.stdin.pause();
      resolve(ans === "y" || ans === "yes");
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}
