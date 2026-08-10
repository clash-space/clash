import type { LocalHostDiscoveryRecord } from "@clash/shared-runtime";
import {
  createLocalDaemonBootstrap,
  launchDetachedLocalDaemon,
  type LocalDaemonLaunchResult,
} from "@clash/shared-runtime/local-daemon";
import {
  clashHomeForLocalDataDir,
  defaultLocalApiDataDir,
  resolveClashProfile,
} from "@clash/shared-runtime/local-paths";
import { join } from "node:path";

export async function ensureCliLocalDaemon(options: {
  env?: NodeJS.ProcessEnv;
  daemonEntryPath: string;
  cliEntryPath: string;
  agentBundleRoot?: string;
  builtinPluginRoot?: string;
  probeHost?: (record: LocalHostDiscoveryRecord) => Promise<boolean>;
  launch?: () => Promise<LocalDaemonLaunchResult>;
}): Promise<LocalHostDiscoveryRecord | undefined> {
  const env = options.env ?? process.env;
  if (env.CLASH_API_URL?.trim()) return undefined;

  const dataDir = defaultLocalApiDataDir(env);
  const runDir = join(clashHomeForLocalDataDir(dataDir), "run");
  const bootstrap = createLocalDaemonBootstrap({
    runDir,
    profile: resolveClashProfile(env),
    probe: options.probeHost,
    launch: options.launch ?? (async () => launchDetachedLocalDaemon({
      entryPath: options.daemonEntryPath,
      cliEntryPath: options.cliEntryPath,
      dataDir,
      runDir,
      env,
      daemonEnv: {
        CLASH_DAEMON_STARTED_BY: "cli",
        CLASH_NODE_EXEC_PATH: process.execPath,
        ...(options.agentBundleRoot ? { CLASH_AGENT_BUNDLE_ROOT: options.agentBundleRoot } : {}),
        ...(options.builtinPluginRoot ? { CLASH_BUILTIN_PLUGIN_ROOT: options.builtinPluginRoot } : {}),
      },
    })),
  });
  const record = await bootstrap.ensureDaemon();
  env.CLASH_API_URL = record.endpoint;
  return record;
}
