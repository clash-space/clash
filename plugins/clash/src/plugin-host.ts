import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
} from "@clash/shared-runtime/local-paths";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  isCompatibleHost,
  isLocalHostDiscoveryRecord,
  shouldClientOwnShutdown,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";

export type PluginHostRecord = LocalHostDiscoveryRecord & { agentCliPath: string };

export type OwnedPluginHost = {
  record: PluginHostRecord;
  close(): Promise<void>;
};

export interface PluginHostManager {
  ensureHost(): Promise<PluginHostRecord>;
  ownsHost(): boolean;
  close(): Promise<void>;
}

type StartHost = (context: {
  ownerClientId: string;
  runDir: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
}) => Promise<OwnedPluginHost>;

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function isUsableHost(value: unknown): value is PluginHostRecord {
  return isLocalHostDiscoveryRecord(value)
    && isCompatibleHost(value, LOCAL_HOST_PROTOCOL_VERSION)
    && processExists(value.pid)
    && Boolean(value.agentCliPath?.trim());
}

export async function readActivePluginHost(runDir: string): Promise<PluginHostRecord | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(runDir, "host.json"), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return isUsableHost(value) ? value : undefined;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function acquireStartupLock(runDir: string): Promise<() => Promise<void>> {
  await mkdir(runDir, { recursive: true });
  const lockPath = join(runDir, "plugin-host-start.lock");
  const token = randomUUID();
  const deadline = Date.now() + 15_000;

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
          if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
            throw error;
          }
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
        || !processExists(lock.pid)
        || typeof lock.createdAt !== "number"
        || Date.now() - lock.createdAt > 30_000;
      if (stale) {
        await rm(lockPath, { force: true });
        continue;
      }
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        continue;
      }
    }
    await delay(50);
  }
  throw new Error("Timed out coordinating Clash plugin host startup");
}

async function waitForOwnedHost(options: {
  child: ChildProcess;
  ownerClientId: string;
  runDir: string;
  stderr: () => string;
}): Promise<PluginHostRecord> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (options.child.exitCode !== null) {
      throw new Error(`Bundled Clash local-api exited before startup.${options.stderr()}`);
    }
    const host = await readActivePluginHost(options.runDir);
    if (host?.ownerClientId === options.ownerClientId
      && host.launchMode === "plugin"
      && host.startedBy === "plugin") {
      return host;
    }
    await delay(50);
  }
  throw new Error(`Timed out starting the bundled Clash local-api.${options.stderr()}`);
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolveExit(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolveExit(true);
    };
    child.once("exit", onExit);
  });
}

async function removeOwnedDiscovery(runDir: string, hostId: string): Promise<void> {
  const file = join(runDir, "host.json");
  try {
    const current = JSON.parse(await readFile(file, "utf8")) as { hostId?: unknown };
    if (current.hostId === hostId) await rm(file, { force: true });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

async function startBundledHost(context: Parameters<StartHost>[0]): Promise<OwnedPluginHost> {
  const localApiEntry = fileURLToPath(new URL("./local-api.cjs", import.meta.url));
  const cliEntry = fileURLToPath(new URL("./clash-cli.cjs", import.meta.url));
  const pluginRoot = dirname(dirname(localApiEntry));
  let stderr = "";
  const child = spawn(process.execPath, [localApiEntry], {
    env: {
      ...context.env,
      CLASH_LOCAL_DATA_DIR: context.dataDir,
      CLASH_HOST_RUN_DIR: context.runDir,
      CLASH_PLUGIN_OWNER_CLIENT_ID: context.ownerClientId,
      CLASH_CLI_ENTRY_PATH: cliEntry,
      CLASH_NODE_EXEC_PATH: process.execPath,
      CLASH_AGENT_BUNDLE_ROOT: join(dirname(localApiEntry), "agents"),
      CLASH_BUILTIN_PLUGIN_ROOT: pluginRoot,
      PORT: "0",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8192);
  });

  let record: PluginHostRecord;
  try {
    record = await waitForOwnedHost({
      child,
      ownerClientId: context.ownerClientId,
      runDir: context.runDir,
      stderr: () => stderr ? `\n${stderr}` : "",
    });
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  let closed = false;
  return {
    record,
    close: async () => {
      if (closed) return;
      closed = true;
      if (child.exitCode === null) child.kill("SIGTERM");
      if (!(await waitForExit(child, 3_000)) && child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForExit(child, 1_000);
      }
      await removeOwnedDiscovery(context.runDir, record.hostId);
    },
  };
}

export function createPluginHostManager(options: {
  ownerClientId?: string;
  runDir?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  readHost?: () => Promise<PluginHostRecord | undefined>;
  startHost?: StartHost;
} = {}): PluginHostManager {
  const env = options.env ?? process.env;
  const dataDir = options.dataDir ?? defaultLocalApiDataDir(env);
  const clashHome = clashHomeForLocalDataDir(dataDir);
  const runDir = options.runDir ?? join(clashHome, "run");
  const ownerClientId = options.ownerClientId ?? `codex-plugin-${randomUUID()}`;
  const readHost = options.readHost ?? (() => readActivePluginHost(runDir));
  const startHost = options.startHost ?? startBundledHost;
  let owned: OwnedPluginHost | undefined;
  let ensuring: Promise<PluginHostRecord> | undefined;
  let closed = false;

  const establish = async (): Promise<PluginHostRecord> => {
    if (closed) throw new Error("Clash plugin host manager is closed");
    const active = await readHost();
    if (active) return active;
    const releaseStartupLock = await acquireStartupLock(runDir);
    try {
      const activeAfterLock = await readHost();
      if (activeAfterLock) return activeAfterLock;
      const started = await startHost({ ownerClientId, runDir, dataDir, env });
      if (!shouldClientOwnShutdown(started.record, {
        clientKind: "plugin",
        clientId: ownerClientId,
      })) {
        await started.close();
        throw new Error("Bundled Clash host did not publish plugin ownership");
      }
      if (closed) {
        await started.close();
        throw new Error("Clash plugin host manager closed during startup");
      }
      owned = started;
      return started.record;
    } finally {
      await releaseStartupLock();
    }
  };

  return {
    ensureHost: () => {
      ensuring ??= establish().catch((error) => {
        ensuring = undefined;
        throw error;
      });
      return ensuring;
    },
    ownsHost: () => Boolean(owned),
    close: async () => {
      if (closed) return;
      closed = true;
      await ensuring?.catch(() => undefined);
      await owned?.close();
      owned = undefined;
    },
  };
}
