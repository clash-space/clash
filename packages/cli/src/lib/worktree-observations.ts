import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

type WorktreeObservationState = {
  schemaVersion: 1;
  projectId: string;
  versions: Record<string, string>;
};

type WorktreeObservationIdentity = {
  workspaceRoot: string;
  projectId: string;
  entityKind: string;
  entityId: string;
};

type WorktreeObservationWrite = WorktreeObservationIdentity & {
  revision: string;
};

const WRITE_LOCK_RETRY_MS = 10;
const WRITE_LOCK_TIMEOUT_MS = 10_000;
const OWNERLESS_LOCK_GRACE_MS = WRITE_LOCK_TIMEOUT_MS;
const localWriteQueues = new Map<string, Promise<void>>();

export type RequiredWorktreeObservation =
  | { ok: true; revision: string }
  | { ok: false; code: "READ_REQUIRED"; error: string };

export function worktreeObservationPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".clash", "observed.json");
}

export async function readWorktreeObservation(
  options: WorktreeObservationIdentity,
): Promise<string | undefined> {
  const state = await readState(options.workspaceRoot);
  if (!state || state.projectId !== normalize(options.projectId, "project id")) return undefined;
  return state.versions[observationKey(options)];
}

export async function requireWorktreeObservation(
  options: WorktreeObservationIdentity,
): Promise<RequiredWorktreeObservation> {
  const revision = await readWorktreeObservation(options);
  if (revision) return { ok: true, revision };
  return {
    ok: false,
    code: "READ_REQUIRED",
    error: `Read ${normalize(options.entityKind, "entity kind")} ${normalize(options.entityId, "entity id")} before writing.`,
  };
}

export async function recordWorktreeObservation(
  options: WorktreeObservationWrite,
): Promise<void> {
  await withWriteLock(options.workspaceRoot, async () => {
    const projectId = normalize(options.projectId, "project id");
    const previous = await readState(options.workspaceRoot);
    const state: WorktreeObservationState = previous?.projectId === projectId
      ? previous
      : { schemaVersion: 1, projectId, versions: {} };
    state.versions[observationKey(options)] = normalize(options.revision, "revision");
    await writeState(options.workspaceRoot, state);
  });
}

export async function forgetWorktreeObservation(
  options: WorktreeObservationIdentity,
): Promise<void> {
  await withWriteLock(options.workspaceRoot, async () => {
    const projectId = normalize(options.projectId, "project id");
    const state = await readState(options.workspaceRoot);
    if (!state || state.projectId !== projectId) return;
    delete state.versions[observationKey(options)];
    await writeState(options.workspaceRoot, state);
  });
}

function observationKey(options: Pick<WorktreeObservationIdentity, "entityKind" | "entityId">): string {
  return `${normalize(options.entityKind, "entity kind")}:${normalize(options.entityId, "entity id")}`;
}

async function readState(workspaceRoot: string): Promise<WorktreeObservationState | undefined> {
  const filePath = resolveWorktreeObservationPath(workspaceRoot);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid worktree observation state at ${filePath}. Delete it and read the target again.`);
  }
  if (!isObservationState(parsed)) {
    throw new Error(`Invalid worktree observation state at ${filePath}. Delete it and read the target again.`);
  }
  return parsed;
}

async function writeState(workspaceRoot: string, state: WorktreeObservationState): Promise<void> {
  const filePath = resolveWorktreeObservationPath(workspaceRoot);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(tempPath, filePath);
}

async function withWriteLock<T>(workspaceRoot: string, operation: () => Promise<T>): Promise<T> {
  const filePath = resolveWorktreeObservationPath(workspaceRoot);
  const previousTurn = localWriteQueues.get(filePath) ?? Promise.resolve();
  let releaseTurn!: () => void;
  const currentTurn = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  const queueTail = previousTurn.then(() => currentTurn);
  localWriteQueues.set(filePath, queueTail);

  await previousTurn;
  try {
    return await withFilesystemWriteLock(filePath, operation);
  } finally {
    releaseTurn();
    if (localWriteQueues.get(filePath) === queueTail) {
      localWriteQueues.delete(filePath);
    }
  }
}

async function withFilesystemWriteLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${filePath}.lock`;
  const ownerPath = join(lockPath, "owner.json");
  const startedAt = Date.now();
  await mkdir(dirname(filePath), { recursive: true });

  while (true) {
    try {
      await mkdir(lockPath);
      const ownerTempPath = join(lockPath, `.owner.${process.pid}.${randomUUID()}.tmp`);
      try {
        await writeFile(ownerTempPath, `${JSON.stringify({ pid: process.pid })}\n`, "utf8");
        await rename(ownerTempPath, ownerPath);
      } catch (error) {
        await retireWriteLock(lockPath);
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (await canReclaimWriteLock(lockPath, ownerPath)) {
        await retireWriteLock(lockPath);
        continue;
      }
      if (Date.now() - startedAt >= WRITE_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out updating worktree observation state at ${filePath}.`);
      }
      await delay(WRITE_LOCK_RETRY_MS);
    }
  }

  try {
    return await operation();
  } finally {
    await retireWriteLock(lockPath);
  }
}

async function retireWriteLock(lockPath: string): Promise<void> {
  const retiredPath = `${lockPath}.retired.${process.pid}.${randomUUID()}`;
  try {
    await rename(lockPath, retiredPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await rm(retiredPath, { recursive: true, force: true });
}

function resolveWorktreeObservationPath(workspaceRoot: string): string {
  return resolveAgentFilePathInsideCwd({
    cwd: workspaceRoot,
    filePath: worktreeObservationPath(workspaceRoot),
    writeVerb: "Worktree observation",
  });
}

async function canReclaimWriteLock(lockPath: string, ownerPath: string): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(ownerPath, "utf8")) as { pid?: unknown };
    if (!Number.isInteger(parsed.pid) || (parsed.pid as number) <= 0) {
      return isOwnerlessLockStale(lockPath);
    }
    try {
      process.kill(parsed.pid as number, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  } catch {
    return isOwnerlessLockStale(lockPath);
  }
}

async function isOwnerlessLockStale(lockPath: string): Promise<boolean> {
  try {
    const lockStat = await stat(lockPath);
    return Date.now() - lockStat.mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isObservationState(value: unknown): value is WorktreeObservationState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.projectId !== "string") return false;
  if (!record.versions || typeof record.versions !== "object" || Array.isArray(record.versions)) return false;
  return Object.entries(record.versions).every(([key, revision]) => key.length > 0 && typeof revision === "string" && revision.length > 0);
}

function normalize(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
