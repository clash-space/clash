import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
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

const require = createRequire(import.meta.url);

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
  startedBy: "cli" | "plugin";
}) => Promise<LocalDaemonLaunchResult>;

export interface PluginHostRuntimeLayout {
  source: boolean;
  localApiEntry: string;
  cliEntry: string;
  agentBundleRoot: string;
  builtinPluginRoot: string;
  nodeArgs?: readonly string[];
  daemonEnv?: NodeJS.ProcessEnv;
}

export function resolvePluginHostRuntimeLayout(
  options: {
    moduleUrl?: string;
    env?: NodeJS.ProcessEnv;
    tsxCliPath?: string;
  } = {},
): PluginHostRuntimeLayout {
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  const env = options.env ?? process.env;
  const modulePath = fileURLToPath(moduleUrl);
  const moduleDir = dirname(modulePath);
  const source =
    env.CLASH_SOURCE_RUNTIME === "1" || basename(moduleDir) === "src";
  const builtinPluginRoot = dirname(moduleDir);
  if (!source) {
    return {
      source: false,
      localApiEntry: join(moduleDir, "local-api.cjs"),
      cliEntry: join(moduleDir, "clash-cli.cjs"),
      agentBundleRoot: join(moduleDir, "agents"),
      builtinPluginRoot,
    };
  }

  const repoRoot = resolve(builtinPluginRoot, "../..");
  const tsconfigPath = join(builtinPluginRoot, "tsconfig.dev.json");
  return {
    source: true,
    localApiEntry: join(moduleDir, "local-api-entry.ts"),
    cliEntry: join(repoRoot, "packages", "cli", "src", "index.ts"),
    agentBundleRoot: join(repoRoot, "packages", "cli", "assets", "agents"),
    builtinPluginRoot,
    nodeArgs: [
      options.tsxCliPath ?? require.resolve("tsx/cli"),
      "watch",
      "--tsconfig",
      tsconfigPath,
    ],
    daemonEnv: {
      CLASH_SOURCE_RUNTIME: "1",
      TSX_TSCONFIG_PATH: tsconfigPath,
    },
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "EPERM",
    );
  }
}

function isUsableHost(
  value: unknown,
  profile: ClashRuntimeProfile,
): value is PluginHostRecord {
  return (
    isLocalHostDiscoveryRecord(value) &&
    (value.profile ?? "prod") === profile &&
    isCompatibleHost(value, LOCAL_HOST_PROTOCOL_VERSION) &&
    processExists(value.pid)
  );
}

export async function readActivePluginHost(
  runDir: string,
  profile: ClashRuntimeProfile = resolveClashProfile(),
): Promise<PluginHostRecord | undefined> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(join(runDir, "host.json"), "utf8"));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return undefined;
    }
    throw error;
  }
  return isUsableHost(value, profile) ? value : undefined;
}

async function startBundledHost(
  context: Parameters<StartHost>[0],
): Promise<LocalDaemonLaunchResult> {
  const layout = resolvePluginHostRuntimeLayout({ env: context.env });
  return launchDetachedLocalDaemon({
    entryPath: layout.localApiEntry,
    nodeArgs: layout.nodeArgs,
    cliEntryPath: layout.cliEntry,
    dataDir: context.dataDir,
    runDir: context.runDir,
    env: context.env,
    daemonEnv: {
      CLASH_DAEMON_STARTED_BY: context.startedBy,
      CLASH_NODE_EXEC_PATH: process.execPath,
      CLASH_AGENT_BUNDLE_ROOT: layout.agentBundleRoot,
      CLASH_BUILTIN_PLUGIN_ROOT: layout.builtinPluginRoot,
      ...(layout.daemonEnv ?? {}),
    },
  });
}

export function createPluginHostManager(
  options: {
    runDir?: string;
    dataDir?: string;
    env?: NodeJS.ProcessEnv;
    startedBy?: "cli" | "plugin";
    probeHost?: (record: LocalHostDiscoveryRecord) => Promise<boolean>;
    startHost?: StartHost;
  } = {},
): PluginHostManager {
  const env = options.env ?? process.env;
  const profile = resolveClashProfile(env);
  const dataDir = options.dataDir ?? defaultLocalApiDataDir(env);
  const clashHome = clashHomeForLocalDataDir(dataDir);
  const runDir = options.runDir ?? join(clashHome, "run");
  const startHost = options.startHost ?? startBundledHost;
  const startedBy = options.startedBy ?? "plugin";
  const bootstrap = createLocalDaemonBootstrap({
    runDir,
    profile,
    probe: options.probeHost,
    launch: () => startHost({ runDir, dataDir, env, startedBy }),
  });

  return {
    ensureHost: () => bootstrap.ensureDaemon(),
    close: () => bootstrap.close(),
  };
}
