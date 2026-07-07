import { createHash } from "node:crypto";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

export type ProjectionCasResult =
  | { ok: true }
  | { ok: false; error: string };

export type ProjectionLockEntity = {
  kind: string;
  id: string;
};

export type ProjectionLock = {
  schemaVersion: 1;
  kind: string;
  projectionKind: string;
  projectId?: string;
  entity: ProjectionLockEntity;
  filePath: string;
  contentHash: string;
  readToken?: string;
  hashAlgorithm: "sha256-64";
  pulledAt: string;
};

export function hashProjectionContent(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function resolveProjectionLockPath(filePath: string): string {
  const ext = extname(filePath);
  const base = basename(filePath, ext);
  return join(dirname(filePath), `${base}.lock.json`);
}

export function createProjectionLock<TExtra extends Record<string, unknown> = Record<string, never>>(options: {
  kind: string;
  projectionKind: string;
  projectId?: string;
  entity: ProjectionLockEntity;
  filePath: string;
  contentHash: string;
  readToken?: string;
  pulledAt?: string;
  extra?: TExtra;
}): ProjectionLock & TExtra {
  return {
    schemaVersion: 1,
    kind: options.kind,
    projectionKind: options.projectionKind,
    ...(options.projectId !== undefined ? { projectId: options.projectId } : {}),
    entity: options.entity,
    ...((options.extra ?? {}) as TExtra),
    filePath: options.filePath,
    contentHash: options.contentHash,
    ...(options.readToken !== undefined ? { readToken: options.readToken } : {}),
    hashAlgorithm: "sha256-64",
    pulledAt: options.pulledAt ?? new Date().toISOString(),
  } as ProjectionLock & TExtra;
}

export function parseProjectionLock(value: unknown, options: {
  kind: string;
  projectionKind: string;
  entityKind: string;
  entityId?: string;
}): ProjectionLock {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid projection lock file");
  }
  const lock = value as Partial<ProjectionLock>;
  if (
    lock.schemaVersion !== 1 ||
    lock.kind !== options.kind ||
    lock.projectionKind !== options.projectionKind ||
    typeof lock.filePath !== "string" ||
    typeof lock.contentHash !== "string" ||
    (lock.readToken !== undefined && typeof lock.readToken !== "string") ||
    lock.hashAlgorithm !== "sha256-64" ||
    typeof lock.pulledAt !== "string" ||
    !lock.entity ||
    typeof lock.entity !== "object" ||
    Array.isArray(lock.entity) ||
    lock.entity.kind !== options.entityKind ||
    typeof lock.entity.id !== "string" ||
    (options.entityId !== undefined && lock.entity.id !== options.entityId) ||
    (lock.projectId !== undefined && typeof lock.projectId !== "string")
  ) {
    throw new Error("Invalid projection lock file");
  }
  return lock as ProjectionLock;
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
