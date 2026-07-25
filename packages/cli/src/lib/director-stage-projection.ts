import { join } from "node:path";
import {
  DirectorStageStateSchema,
  type DirectorStageState,
} from "@clash/shared-types";
import {
  hashProjectionContent,
  resolveProjectionFilePathInsideCwd,
} from "./projection-cas";

export type ParseDirectorStageApplyResult =
  | { ok: true; state: DirectorStageState }
  | { ok: false; error: string };

function directorStageFileSlug(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "main";
}

export function resolveDirectorStageFilePath(options: {
  cwd: string;
  file?: string;
  stage?: string;
}): string {
  const filePath = options.file ?? join(
    options.cwd,
    "director-stages",
    `${directorStageFileSlug(options.stage ?? "main")}.director-stage.json`,
  );
  return resolveProjectionFilePathInsideCwd({ filePath, cwd: options.cwd });
}

export function directorStageCanonicalJson(state: unknown): string {
  const parsed = DirectorStageStateSchema.parse(state);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parseDirectorStageFileForApply(raw: string): ParseDirectorStageApplyResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? `Invalid JSON: ${error.message}` : "Invalid JSON",
    };
  }
  const parsed = DirectorStageStateSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return { ok: false, error: `${path}${issue?.message ?? "Invalid Director Stage state"}` };
  }
  return { ok: true, state: parsed.data };
}

export function directorStageHash(state: unknown): string {
  return hashProjectionContent(directorStageCanonicalJson(state));
}
