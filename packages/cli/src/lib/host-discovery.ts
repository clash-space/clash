import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  isLocalHostDiscoveryRecord,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";
import { resolveClashRoot } from "./clash-home";
import { resolveClashProfile, type ClashRuntimeProfile } from "@clash/shared-runtime/local-paths";

export type HostDiscoveryStatus =
  | { status: "active"; record: LocalHostDiscoveryRecord }
  | { status: "inactive" };

export interface HostDiscoveryStatusOptions {
  runDir?: string;
  profile?: ClashRuntimeProfile;
  pidExists?: (pid: number) => boolean;
}

export function getDefaultHostDiscoveryRunDir(): string {
  return join(resolveClashRoot(), "run");
}

export function getHostDiscoveryPath(runDir = getDefaultHostDiscoveryRunDir()): string {
  return join(runDir, "host.json");
}

export async function getHostDiscoveryStatus(
  options: HostDiscoveryStatusOptions = {},
): Promise<HostDiscoveryStatus> {
  const filePath = getHostDiscoveryPath(options.runDir);
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
  const profile = options.profile ?? resolveClashProfile();
  if ((parsed.profile ?? "prod") !== profile) return { status: "inactive" };

  const pidExists = options.pidExists ?? defaultPidExists;
  if (!pidExists(parsed.pid)) {
    await removeHostDiscovery(parsed.hostId, { runDir: options.runDir });
    return { status: "inactive" };
  }

  return { status: "active", record: parsed };
}

export async function removeHostDiscovery(
  hostId: string,
  options: { runDir?: string } = {},
): Promise<void> {
  const filePath = getHostDiscoveryPath(options.runDir);
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
