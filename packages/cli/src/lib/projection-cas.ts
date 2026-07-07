import { createHash } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

export type ProjectionCasResult =
  | { ok: true }
  | { ok: false; error: string };

export function hashProjectionContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function resolveProjectionLockPath(filePath: string): string {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  return join(dirname(filePath), `${base}.lock.json`);
}

export function assertProjectionLockFilePath(options: {
  label: string;
  lockFilePath?: string | null;
  filePath?: string | null;
  cwd?: string;
  force?: boolean;
  readCommand: string;
  writeVerb: string;
}): ProjectionCasResult {
  if (options.force || !options.lockFilePath || !options.filePath) return { ok: true };
  const lockPath = normalizeProjectionPathForCompare(options.lockFilePath, options.cwd);
  const applyPath = normalizeProjectionPathForCompare(options.filePath, options.cwd);
  if (lockPath === applyPath) return { ok: true };
  return {
    ok: false,
    error:
      `Projection file path does not match ${options.label} CAS lock. ` +
      `${options.writeVerb} file is ${options.filePath}, but lock was pulled for ${options.lockFilePath}. ` +
      `Run \`${options.readCommand}\` for this file, or pass --force to intentionally overwrite.`,
  };
}

export function normalizeProjectionPathForCompare(path: string, cwd?: string): string {
  if (isAbsolute(path)) return resolve(path);
  return resolve(cwd ?? process.cwd(), path);
}
