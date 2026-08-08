import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  createLocalDaemonBootstrap,
  launchDetachedLocalDaemon,
  type LocalDaemonLaunchResult,
} from "@clash/shared-runtime/local-daemon";
import {
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
  resolveClashProfile,
  type ClashRuntimeProfile,
} from "@clash/shared-runtime/local-paths";
import {
  LOCAL_HOST_PROTOCOL_VERSION,
  isCompatibleHost,
  isLocalHostDiscoveryRecord,
  type LocalHostDiscoveryRecord,
} from "@clash/shared-runtime";
import { readFile } from "node:fs/promises";

export type PluginHostRecord = LocalHostDiscoveryRecord;

export interface PluginHostManager {
  ensureHost(): Promise<PluginHostRecord>;
  /** Releases this client bootstrap only. The shared daemon remains running. */
  close(): Promise<void>;
}

type StartHost = (context: {
  runDir: string;
  dataDir: string;
  env: NodeJS.ProcessEnv;
}) => Promise<LocalDaemonLaunchResult>;

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM");
  }
}

function isUsableHost(value: unknown, profile: ClashRuntimeProfile): value is PluginHostRecord {
  return isLocalHostDiscoveryRecord(value)
    && (value.profile ?? "prod") === profile
    && isCompatibleHost(value, LOCAL_HOST_PROTOCOL_VERSION)
    && processExists(value.pid);
}

export async function readActivePluginHost(
  runDir: string,
  profile: ClashRuntimeProfile = resolveClashProfile(),
): Promise<PluginHostRecord | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(runDir, "host.json"), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
  return isUsableHost(value, profile) ? value : undefined;
}

async function startBundledHost(context: Parameters<StartHost>[0]): Promise<LocalDaemonLaunchResult> {
  const localApiEntry = fileURLToPath(new URL("./local-api.cjs", import.meta.url));
  const cliEntry = fileURLToPath(new URL("./clash-cli.cjs", import.meta.url));
  const pluginRoot = dirname(dirname(localApiEntry));
  return launchDetachedLocalDaemon({
    entryPath: localApiEntry,
    cliEntryPath: cliEntry,
    dataDir: context.dataDir,
    runDir: context.runDir,
    env: context.env,
    daemonEnv: {
      CLASH_DAEMON_STARTED_BY: "plugin",
      CLASH_NODE_EXEC_PATH: process.execPath,
      CLASH_AGENT_BUNDLE_ROOT: join(dirname(localApiEntry), "agents"),
      CLASH_BUILTIN_PLUGIN_ROOT: pluginRoot,
    },
  });
}

export function createPluginHostManager(options: {
  runDir?: string;
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  probeHost?: (record: LocalHostDiscoveryRecord) => Promise<boolean>;
  startHost?: StartHost;
} = {}): PluginHostManager {
  const env = options.env ?? process.env;
  const profile = resolveClashProfile(env);
  const dataDir = options.dataDir ?? defaultLocalApiDataDir(env);
  const clashHome = clashHomeForLocalDataDir(dataDir);
  const runDir = options.runDir ?? join(clashHome, "run");
  const startHost = options.startHost ?? startBundledHost;
  const bootstrap = createLocalDaemonBootstrap({
    runDir,
    profile,
    probe: options.probeHost,
    launch: () => startHost({ runDir, dataDir, env }),
  });

  return {
    ensureHost: () => bootstrap.ensureDaemon(),
    close: () => bootstrap.close(),
  };
}
