import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { a as DirectorAdapter } from './adapter-CNijvpDJ.js';
export { D as DIRECTOR_PLUGIN_TOOL_NAMES } from './adapter-CNijvpDJ.js';

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

export { createDirectorPluginServer, registerDirectorPluginMcp, serveDirectorPluginStdio };
