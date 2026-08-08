import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  isCompatibleHost,
  isLocalHostDiscoveryRecord,
  type LocalHostDiscoveryRecord,
} from "./index.js";
import type { ClashRuntimeProfile } from "./local-paths.js";

export interface LocalDaemonLaunchResult {
  pid: number;
  stop?: () => Promise<void>;
}

export interface DetachedLocalDaemonOptions {
  entryPath: string;
  dataDir: string;
  runDir: string;
  cliEntryPath: string;
  env?: NodeJS.ProcessEnv;
  daemonEnv?: NodeJS.ProcessEnv;
  nodePath?: string;
  spawnProcess?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => Pick<ChildProcess, "pid" | "unref">;
}

export interface LocalDaemonBootstrap {
  ensureDaemon(): Promise<LocalHostDiscoveryRecord>;
  close(): Promise<void>;
}

export interface LocalDaemonBootstrapOptions {
  runDir: string;
  profile: ClashRuntimeProfile;
  pidExists?: (pid: number) => boolean;
  probe?: (record: LocalHostDiscoveryRecord) => Promise<boolean>;
  launch: () => Promise<LocalDaemonLaunchResult>;
  startupTimeoutMs?: number;
  lockTimeoutMs?: number;
  pollIntervalMs?: number;
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

export function launchDetachedLocalDaemon(
  options: DetachedLocalDaemonOptions,
): LocalDaemonLaunchResult {
  const spawnProcess = options.spawnProcess ?? spawn;
  const child = spawnProcess(options.nodePath ?? process.execPath, [options.entryPath], {
    detached: true,
    env: {
      ...(options.env ?? process.env),
      ...(options.daemonEnv ?? {}),
      CLASH_LOCAL_DATA_DIR: options.dataDir,
      CLASH_HOST_RUN_DIR: options.runDir,
      CLASH_CLI_ENTRY_PATH: options.cliEntryPath,
      CLASH_LOCAL_API_WRAPPER_ENTRY: "1",
      PORT: "0",
    },
    stdio: "ignore",
  });
  if (!child.pid) throw new Error("Failed to start Clash daemon process");
  const pid = child.pid;
  child.unref();
  return {
    pid,
    stop: async () => {
      if (!processExists(pid)) return;
      try {
        process.kill(pid, "SIGTERM");
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "ESRCH")) {
          throw error;
        }
      }
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultHealthProbe(record: LocalHostDiscoveryRecord): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", record.endpoint), {
      signal: AbortSignal.timeout(1_000),
    });
    if (!response.ok) return false;
    const body = await response.json() as {
      ok?: unknown;
      mode?: unknown;
      host?: {
        hostId?: unknown;
        pid?: unknown;
        profile?: unknown;
        protocolVersion?: unknown;
      };
    };
    return body.ok === true
      && body.mode === "local"
      && body.host?.hostId === record.hostId
      && body.host.pid === record.pid
      && body.host.profile === (record.profile ?? "prod")
      && body.host.protocolVersion === record.protocolVersion;
  } catch {
    return false;
  }
}

type LocalDaemonInspection =
  | { status: "absent" }
  | { status: "healthy"; record: LocalHostDiscoveryRecord }
  | { status: "unhealthy"; record: LocalHostDiscoveryRecord };

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    const hostname = url.hostname.toLowerCase();
    return (url.protocol === "http:" || url.protocol === "https:")
      && (hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1");
  } catch {
    return false;
  }
}

async function inspectLocalDaemon(options: {
  runDir: string;
  profile: ClashRuntimeProfile;
  pidExists: (pid: number) => boolean;
  probe: (record: LocalHostDiscoveryRecord) => Promise<boolean>;
}): Promise<LocalDaemonInspection> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(options.runDir, "host.json"), "utf8"));
  } catch (error) {
    if (isMissingFile(error) || error instanceof SyntaxError) return { status: "absent" };
    throw error;
  }
  if (!isLocalHostDiscoveryRecord(value)) return { status: "absent" };
  if (!options.pidExists(value.pid)) return { status: "absent" };
  if ((value.profile ?? "prod") !== options.profile
    || !isCompatibleHost(value, LOCAL_HOST_PROTOCOL_VERSION)
    || !isLoopbackEndpoint(value.endpoint)) {
    return { status: "unhealthy", record: value };
  }
  return await options.probe(value)
    ? { status: "healthy", record: value }
    : { status: "unhealthy", record: value };
}

async function acquireStartupLock(options: {
  runDir: string;
  pidExists: (pid: number) => boolean;
  lockTimeoutMs: number;
  pollIntervalMs: number;
}): Promise<() => Promise<void>> {
  await mkdir(options.runDir, { recursive: true });
  const lockPath = join(options.runDir, "daemon-start.lock");
  const token = randomUUID();
  const deadline = Date.now() + options.lockTimeoutMs;

  while (Date.now() < deadline) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: Date.now() }), "utf8");
      return async () => {
        await handle.close().catch(() => undefined);
        try {
          const current = JSON.parse(await readFile(lockPath, "utf8")) as { token?: unknown };
          if (current.token === token) await rm(lockPath, { force: true });
        } catch (error) {
          if (!isMissingFile(error)) throw error;
        }
      };
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) {
        throw error;
      }
    }

    try {
      const lock = JSON.parse(await readFile(lockPath, "utf8")) as {
        pid?: unknown;
        createdAt?: unknown;
      };
      const stale = typeof lock.pid !== "number"
        || !options.pidExists(lock.pid)
        || typeof lock.createdAt !== "number"
        || Date.now() - lock.createdAt > options.lockTimeoutMs * 2;
      if (stale) {
        await rm(lockPath, { force: true });
        continue;
      }
    } catch (error) {
      if (isMissingFile(error)) continue;
      if (error instanceof SyntaxError) {
        await rm(lockPath, { force: true });
        continue;
      }
    }
    await delay(options.pollIntervalMs);
  }
  throw new Error("Timed out coordinating Clash daemon startup");
}

export function createLocalDaemonBootstrap(
  options: LocalDaemonBootstrapOptions,
): LocalDaemonBootstrap {
  const pidExists = options.pidExists ?? processExists;
  const probe = options.probe ?? defaultHealthProbe;
  const startupTimeoutMs = options.startupTimeoutMs ?? 10_000;
  const lockTimeoutMs = options.lockTimeoutMs ?? 15_000;
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const inspectDaemon = () => inspectLocalDaemon({
    runDir: options.runDir,
    profile: options.profile,
    pidExists,
    probe,
  });
  let ensuring: Promise<LocalHostDiscoveryRecord> | undefined;
  let closed = false;

  const establish = async (): Promise<LocalHostDiscoveryRecord> => {
    if (closed) throw new Error("Clash daemon bootstrap is closed");
    const active = await inspectDaemon();
    if (active.status === "healthy") return active.record;
    if (active.status === "unhealthy") {
      throw new Error(
        `Clash daemon process ${active.record.pid} is alive but unhealthy at ${active.record.endpoint}; `
        + "refusing to start a second project-state writer",
      );
    }

    const release = await acquireStartupLock({
      runDir: options.runDir,
      pidExists,
      lockTimeoutMs,
      pollIntervalMs,
    });
    let launched: LocalDaemonLaunchResult | undefined;
    try {
      const activeAfterLock = await inspectDaemon();
      if (activeAfterLock.status === "healthy") return activeAfterLock.record;
      if (activeAfterLock.status === "unhealthy") {
        throw new Error(
          `Clash daemon process ${activeAfterLock.record.pid} is alive but unhealthy at ${activeAfterLock.record.endpoint}; `
          + "refusing to start a second project-state writer",
        );
      }
      launched = await options.launch();
      const deadline = Date.now() + startupTimeoutMs;
      while (Date.now() < deadline) {
        const ready = await inspectDaemon();
        if (ready.status === "healthy") return ready.record;
        if (ready.status === "unhealthy" && ready.record.pid !== launched.pid) {
          throw new Error(
            `A different Clash daemon process ${ready.record.pid} became unhealthy during startup`,
          );
        }
        if (!pidExists(launched.pid)) {
          throw new Error("Clash daemon exited before becoming ready");
        }
        await delay(pollIntervalMs);
      }
      throw new Error("Timed out waiting for Clash daemon readiness");
    } catch (error) {
      await launched?.stop?.().catch(() => undefined);
      throw error;
    } finally {
      await release();
    }
  };

  return {
    ensureDaemon: () => {
      if (ensuring) return ensuring;
      const attempt = establish();
      ensuring = attempt;
      void attempt.then(
        () => { if (ensuring === attempt) ensuring = undefined; },
        () => { if (ensuring === attempt) ensuring = undefined; },
      );
      return ensuring;
    },
    close: async () => {
      closed = true;
      await ensuring?.catch(() => undefined);
    },
  };
}
