import { ProjectHostClient } from '@clash/shared-runtime/project-host-client';
import { LocalDaemonLaunchResult } from '@clash/shared-runtime/local-daemon';
import { ClashRuntimeProfile } from '@clash/shared-runtime/local-paths';
import { LocalHostDiscoveryRecord } from '@clash/shared-runtime';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { PluginMcpGateway } from '@clash/mcp-server';

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

interface OpenMaNativeTools {
    searchSkills(input: {
        query: string;
        limit: number;
    }): Promise<unknown>;
    readSkill(input: {
        skill: string;
    }): Promise<unknown>;
    readPluginFile(input: {
        plugin: string;
        path: string;
    }): Promise<unknown>;
    browserTabs(input: {
        action: "list" | "new" | "select" | "close";
        url?: string;
        tab_id?: string;
        index?: number;
    }): Promise<unknown>;
    browserNavigate(input: {
        url: string;
    }): Promise<unknown>;
    browserScreenshot(input: {
        full_page: boolean;
    }): Promise<{
        media_type: "image/png";
        data: string;
        tab_id: string;
        url: string;
    }>;
    browserClick(input: {
        selector: string;
    }): Promise<unknown>;
    browserType(input: {
        selector: string;
        text: string;
        submit: boolean;
    }): Promise<unknown>;
    browserGetText(input: {
        selector?: string;
        max_chars: number;
    }): Promise<string>;
    browserEval(input: {
        expression: string;
    }): Promise<unknown>;
    browserClose(): Promise<unknown>;
    listSessions(input: {
        query?: string;
        limit?: number;
    }): Promise<unknown>;
    readSession(input: {
        session_id: string;
        after_seq?: number;
        max_chars?: number;
        include_activity?: boolean;
    }): Promise<unknown>;
}

interface OpenMaPluginRoot {
    name: string;
    root: string;
}

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
    pluginGateway?: PluginMcpGateway;
};
type OpenMaPluginServerOptions = {
    client?: ProjectHostClient;
    hostManager?: PluginHostManager;
    tools?: OpenMaNativeTools;
    taskId?: string;
    pluginRoots?: readonly OpenMaPluginRoot[];
    workspace?: string;
    runBrowser?: (args: readonly string[]) => Promise<string>;
};
declare function createClashPluginRuntime(options?: ClashPluginServerOptions): {
    server: McpServer;
    hostManager?: PluginHostManager;
    close(): Promise<void>;
    closeHost(): Promise<void>;
};
declare function createClashPluginServer(options?: ClashPluginServerOptions): McpServer;
declare function serveClashPluginStdio(options?: ClashPluginServerOptions): Promise<void>;
declare function createOpenMaPluginRuntime(options?: OpenMaPluginServerOptions): {
    server: McpServer;
    hostManager?: PluginHostManager;
    close(): Promise<void>;
    closeHost(): Promise<void>;
};
declare function createOpenMaPluginServer(options?: OpenMaPluginServerOptions): McpServer;
declare function serveOpenMaPluginStdio(options?: OpenMaPluginServerOptions): Promise<void>;

declare function isDirectExecution(moduleUrl: string, argvEntry?: string, cwd?: string): boolean;

export { type ClashPluginAppBundles, type ClashPluginServerOptions, type OpenMaPluginServerOptions, type PluginHostManager, type PluginHostRecord, type PluginHostRuntimeLayout, createClashPluginRuntime, createClashPluginServer, createMcpProjectHostClient, createOpenMaPluginRuntime, createOpenMaPluginServer, createPluginHostManager, isDirectExecution, readActivePluginHost, resolvePluginHostRuntimeLayout, serveClashPluginStdio, serveOpenMaPluginStdio };
