import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  LOCAL_HOST_DATA_SCHEMA_VERSION,
  LOCAL_HOST_PROTOCOL_VERSION,
  LOCAL_HOST_RECORD_SCHEMA_VERSION,
  isLocalHostDiscoveryRecord,
  type HostLaunchMode,
  type HostStartedBy,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";
import {
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
} from "./local-paths.js";

export type HostDiscoveryState =
  | { status: "active"; record: LocalHostDiscoveryRecord }
  | { status: "inactive" };

export interface HostDiscoveryReadOptions {
  runDir?: string;
  pidExists?: (pid: number) => boolean;
}

export interface HostDiscoveryWriteOptions {
  runDir?: string;
}

export function getDefaultHostDiscoveryRunDir(
  env: Record<string, string | undefined> = process.env,
): string {
  return join(
    clashHomeForLocalDataDir(defaultLocalApiDataDir(env)),
    "run",
  );
}

export function getHostDiscoveryPath(runDir = getDefaultHostDiscoveryRunDir()): string {
  return join(runDir, "host.json");
}

export function createHostDiscoveryRecord(options: {
  endpoint: string;
  launchMode: HostLaunchMode;
  startedBy: HostStartedBy;
  agentCliPath?: string;
  ownerClientId?: string;
  pid?: number;
  hostId?: string;
  now?: Date;
}): LocalHostDiscoveryRecord {
  const now = (options.now ?? new Date()).toISOString();
  return {
    schemaVersion: LOCAL_HOST_RECORD_SCHEMA_VERSION,
    protocolVersion: LOCAL_HOST_PROTOCOL_VERSION,
    dataSchemaVersion: LOCAL_HOST_DATA_SCHEMA_VERSION,
    hostId: options.hostId ?? randomUUID(),
    endpoint: options.endpoint,
    pid: options.pid ?? process.pid,
    launchMode: options.launchMode,
    startedBy: options.startedBy,
    agentCliPath: options.agentCliPath,
    ownerClientId: options.ownerClientId,
    startedAt: now,
    updatedAt: now,
  };
}

export async function writeHostDiscovery(
  record: LocalHostDiscoveryRecord,
  options: HostDiscoveryWriteOptions = {},
): Promise<void> {
  if (!isLocalHostDiscoveryRecord(record)) {
    throw new Error("Invalid local host discovery record");
  }
  const runDir = options.runDir ?? getDefaultHostDiscoveryRunDir();
  await mkdir(runDir, { recursive: true });
  const finalPath = getHostDiscoveryPath(runDir);
  const tmpPath = join(runDir, `host.${record.hostId}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmpPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tmpPath, finalPath);
  await chmod(finalPath, 0o600).catch(() => undefined);
}

export async function readHostDiscovery(
  options: HostDiscoveryReadOptions = {},
): Promise<HostDiscoveryState> {
  const runDir = options.runDir ?? getDefaultHostDiscoveryRunDir();
  const filePath = getHostDiscoveryPath(runDir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isNotFound(error)) return { status: "inactive" };
    throw error;
  }

  if (!isLocalHostDiscoveryRecord(parsed)) {
    return { status: "inactive" };
  }

  const pidExists = options.pidExists ?? defaultPidExists;
  if (!pidExists(parsed.pid)) {
    await removeHostDiscovery(parsed.hostId, { runDir });
    return { status: "inactive" };
  }

  return { status: "active", record: parsed };
}

export async function removeHostDiscovery(
  hostId: string,
  options: HostDiscoveryWriteOptions = {},
): Promise<void> {
  const runDir = options.runDir ?? getDefaultHostDiscoveryRunDir();
  const filePath = getHostDiscoveryPath(runDir);
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (isNotFound(error)) return;
    throw error;
  }

  if (!isLocalHostDiscoveryRecord(parsed) || parsed.hostId !== hostId) return;
  await rm(filePath, { force: true });
}

function defaultPidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function isNotFound(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function canReadHostDiscovery(runDir?: string): Promise<boolean> {
  try {
    await access(getHostDiscoveryPath(runDir), constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
