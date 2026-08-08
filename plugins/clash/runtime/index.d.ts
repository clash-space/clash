import { LocalDaemonLaunchResult } from '@clash/shared-runtime/local-daemon';
import { ClashRuntimeProfile } from '@clash/shared-runtime/local-paths';
import { LocalHostDiscoveryRecord } from '@clash/shared-runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type PluginHostRecord = LocalHostDiscoveryRecord;
interface PluginHostManager {
    ensureHost(): Promise<PluginHostRecord>;
    /** Releases this client bootstrap only. The shared daemon remains running. */
    close(): Promise<void>;
}
type StartHost = (context: {
    runDir: string;
    dataDir: string;
    env: NodeJS.ProcessEnv;
}) => Promise<LocalDaemonLaunchResult>;
declare function readActivePluginHost(runDir: string, profile?: ClashRuntimeProfile): Promise<PluginHostRecord | undefined>;
declare function createPluginHostManager(options?: {
    runDir?: string;
    dataDir?: string;
    env?: NodeJS.ProcessEnv;
    probeHost?: (record: LocalHostDiscoveryRecord) => Promise<boolean>;
    startHost?: StartHost;
}): PluginHostManager;

type HostCliRunner = (args: string[], cwd?: string) => Promise<unknown>;
declare function createHostCliRunner(options?: {
    runDir?: string;
    env?: NodeJS.ProcessEnv;
    command?: string;
    bundledCliPath?: string;
    hostManager?: Pick<PluginHostManager, "ensureHost">;
}): HostCliRunner;

type ClashPluginAppBundles = {
    studio: string;
    canvas: string;
    timeline: string;
    director: string;
};
type ClashPluginServerOptions = {
    runner?: HostCliRunner;
    hostManager?: PluginHostManager;
    appBundles?: ClashPluginAppBundles;
};
declare function createClashPluginRuntime(options?: ClashPluginServerOptions): {
    server: McpServer;
    hostManager?: PluginHostManager;
    close(): Promise<void>;
    closeHost(): Promise<void>;
};
declare function createClashPluginServer(options?: ClashPluginServerOptions): McpServer;
declare function serveClashPluginStdio(options?: ClashPluginServerOptions): Promise<void>;

declare function isDirectExecution(moduleUrl: string, argvEntry?: string, cwd?: string): boolean;

export { type ClashPluginAppBundles, type ClashPluginServerOptions, type HostCliRunner, type PluginHostManager, type PluginHostRecord, createClashPluginRuntime, createClashPluginServer, createHostCliRunner, createPluginHostManager, isDirectExecution, readActivePluginHost, serveClashPluginStdio };
