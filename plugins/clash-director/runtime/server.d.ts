import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClashStaleRecovery } from '@clash/shared-mcp';
import { a as DirectorAdapter } from './adapter-BJBHIdFm.js';
export { D as DIRECTOR_PLUGIN_TOOL_NAMES } from './adapter-BJBHIdFm.js';
import '@clash/shared-runtime/project-host-client';

type DirectorToolErrorPayload = {
    code: string;
    message: string;
    recovery?: ClashStaleRecovery;
};
declare function directorToolErrorPayload(error: unknown): DirectorToolErrorPayload;
declare function registerDirectorPluginMcp(server: Pick<McpServer, "registerTool" | "registerResource">, adapter: DirectorAdapter, bundledAppJavascript: string, options?: {
    appSurfaces?: boolean;
}): void;
declare function createDirectorPluginServer(options?: {
    adapter?: DirectorAdapter;
    bundledAppJavascript?: string;
}): McpServer;
declare function serveDirectorPluginStdio(options?: {
    adapter?: DirectorAdapter;
}): Promise<void>;

export { type DirectorToolErrorPayload, createDirectorPluginServer, directorToolErrorPayload, registerDirectorPluginMcp, serveDirectorPluginStdio };
