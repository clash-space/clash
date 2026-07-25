import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { a as DirectorAdapter } from './adapter-CzOWT90T.js';
export { D as DIRECTOR_PLUGIN_TOOL_NAMES } from './adapter-CzOWT90T.js';

declare function registerDirectorPluginMcp(server: Pick<McpServer, "registerTool" | "registerResource">, adapter: DirectorAdapter, bundledAppJavascript: string): void;
declare function createDirectorPluginServer(options?: {
    adapter?: DirectorAdapter;
    bundledAppJavascript?: string;
}): McpServer;
declare function serveDirectorPluginStdio(options?: {
    adapter?: DirectorAdapter;
}): Promise<void>;

export { createDirectorPluginServer, registerDirectorPluginMcp, serveDirectorPluginStdio };
