import { LocalHostDiscoveryRecord } from '@clash/shared-runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

type PluginHostRecord = LocalHostDiscoveryRecord & {
    agentCliPath: string;
};
type OwnedPluginHost = {
    record: PluginHostRecord;
    close(): Promise<void>;
};
interface PluginHostManager {
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
declare function readActivePluginHost(runDir: string): Promise<PluginHostRecord | undefined>;
declare function createPluginHostManager(options?: {
    ownerClientId?: string;
    runDir?: string;
    dataDir?: string;
    env?: NodeJS.ProcessEnv;
    readHost?: () => Promise<PluginHostRecord | undefined>;
    startHost?: StartHost;
}): PluginHostManager;

type HostCliRunner = (args: string[], cwd?: string) => Promise<unknown>;
declare function createHostCliRunner(options?: {
    runDir?: string;
    env?: NodeJS.ProcessEnv;
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

export { type ClashPluginAppBundles, type ClashPluginServerOptions, type HostCliRunner, type OwnedPluginHost, type PluginHostManager, type PluginHostRecord, createClashPluginRuntime, createClashPluginServer, createHostCliRunner, createPluginHostManager, isDirectExecution, readActivePluginHost, serveClashPluginStdio };
