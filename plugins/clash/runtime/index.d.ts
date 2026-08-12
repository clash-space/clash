import { ProjectHostClient } from '@clash/shared-runtime/project-host-client';
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
    startedBy: "cli" | "plugin";
}) => Promise<LocalDaemonLaunchResult>;
interface PluginHostRuntimeLayout {
    source: boolean;
    localApiEntry: string;
    cliEntry: string;
    agentBundleRoot: string;
    builtinPluginRoot: string;
    nodeArgs?: readonly string[];
    daemonEnv?: NodeJS.ProcessEnv;
}
declare function resolvePluginHostRuntimeLayout(options?: {
    moduleUrl?: string;
    env?: NodeJS.ProcessEnv;
    tsxCliPath?: string;
}): PluginHostRuntimeLayout;
declare function readActivePluginHost(runDir: string, profile?: ClashRuntimeProfile): Promise<PluginHostRecord | undefined>;
declare function createPluginHostManager(options?: {
    runDir?: string;
    dataDir?: string;
    env?: NodeJS.ProcessEnv;
    startedBy?: "cli" | "plugin";
    probeHost?: (record: LocalHostDiscoveryRecord) => Promise<boolean>;
    startHost?: StartHost;
}): PluginHostManager;

/**
 * Build the MCP peer client for local-api. This module deliberately contains
 * no CLI import and no child-process transport: CLI and MCP share the typed
 * ProjectHost client, not each other's presentation layer.
 */
declare function createMcpProjectHostClient(options?: {
    runDir?: string;
    env?: NodeJS.ProcessEnv;
    fetch?: typeof globalThis.fetch;
    hostManager?: Pick<PluginHostManager, "ensureHost">;
}): ProjectHostClient;

type ClashPluginAppBundles = {
    studio: string;
    canvas: string;
    timeline: string;
    director: string;
};
type ClashPluginServerOptions = {
    client?: ProjectHostClient;
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

export { type ClashPluginAppBundles, type ClashPluginServerOptions, type PluginHostManager, type PluginHostRecord, type PluginHostRuntimeLayout, createClashPluginRuntime, createClashPluginServer, createMcpProjectHostClient, createPluginHostManager, isDirectExecution, readActivePluginHost, resolvePluginHostRuntimeLayout, serveClashPluginStdio };
