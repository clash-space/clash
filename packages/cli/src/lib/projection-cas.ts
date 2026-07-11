import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type ProjectionCasResult =
  | { ok: true }
  | { ok: false; error: string };

export function hashProjectionContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function assertProjectionFilePathInsideCwd(options: {
  filePath: string;
  cwd: string;
  writeVerb: string;
}): ProjectionCasResult {
  return assertProjectionPathInsideCwd({
    path: options.filePath,
    cwd: options.cwd,
    subject: "Projection file path",
    valueLabel: `${options.writeVerb} file`,
  });
}

export function assertAgentFilePathInsideCwd(options: {
  filePath: string;
  cwd: string;
  writeVerb: string;
}): ProjectionCasResult {
  return assertProjectionPathInsideCwd({
    path: options.filePath,
    cwd: options.cwd,
    subject: "Agent file path",
    valueLabel: `${options.writeVerb} file`,
  });
}

function assertProjectionPathInsideCwd(options: {
  path: string;
  cwd: string;
  subject: string;
  valueLabel: string;
}): ProjectionCasResult {
  const cwd = resolve(options.cwd);
  const filePath = normalizeProjectionPathForCompare(options.path, cwd);
  const relativePath = relative(cwd, filePath);
  const escapes = relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
  const inside = relativePath === "" || !escapes;
  if (!inside) {
    return {
      ok: false,
      error:
        `${options.subject} must stay inside the current project cwd. ` +
        `${options.valueLabel} is ${options.path}, cwd is ${options.cwd}.`,
    };
  }
  const realPathResult = assertExistingProjectionPathRealpathInsideCwd({
    filePath,
    cwd,
    originalPath: options.path,
    originalCwd: options.cwd,
    subject: options.subject,
    valueLabel: options.valueLabel,
  });
  if (!realPathResult.ok) return realPathResult;
  return { ok: true };
}

function assertExistingProjectionPathRealpathInsideCwd(options: {
  filePath: string;
  cwd: string;
  originalPath: string;
  originalCwd: string;
  subject: string;
  valueLabel: string;
}): ProjectionCasResult {
  let cwdRealPath: string;
  try {
    cwdRealPath = realpathSync.native(options.cwd);
  } catch {
    return { ok: true };
  }
  const existingPath = nearestExistingPath(options.filePath);
  if (!existingPath) return { ok: true };
  let existingRealPath: string;
  try {
    existingRealPath = realpathSync.native(existingPath);
  } catch {
    return { ok: true };
  }
  const realRelativePath = relative(cwdRealPath, existingRealPath);
  const escapes =
    realRelativePath === ".." ||
    realRelativePath.startsWith(`..${sep}`) ||
    isAbsolute(realRelativePath);
  if (!escapes) return { ok: true };
  return {
    ok: false,
    error:
      `${options.subject} must not traverse a symlink outside the current project cwd. ` +
      `${options.valueLabel} is ${options.originalPath}, cwd is ${options.originalCwd}.`,
  };
}

function nearestExistingPath(filePath: string): string | null {
  let candidate = filePath;
  while (!existsSync(candidate)) {
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
  return candidate;
}

export function resolveProjectionFilePathInsideCwd(options: {
  filePath: string;
  cwd: string;
}): string {
  const filePath = normalizeProjectionPathForCompare(options.filePath, options.cwd);
  const result = assertProjectionFilePathInsideCwd({
    filePath,
    cwd: options.cwd,
    writeVerb: "Projection",
  });
  if (!result.ok) throw new Error(result.error);
  return filePath;
}

export function resolveAgentFilePathInsideCwd(options: {
  filePath: string;
  cwd: string;
  writeVerb?: string;
}): string {
  const filePath = normalizeProjectionPathForCompare(options.filePath, options.cwd);
  const result = assertAgentFilePathInsideCwd({
    filePath,
    cwd: options.cwd,
    writeVerb: options.writeVerb ?? "Agent file",
  });
  if (!result.ok) throw new Error(result.error);
  return filePath;
}

export function normalizeProjectionPathForCompare(path: string, cwd?: string): string {
  if (isAbsolute(path)) return resolve(path);
  return resolve(cwd ?? process.cwd(), path);
}
