import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { a as TimelineAdapter } from './adapter-DSKpN3gP.js';

declare function registerTimelinePluginMcp(server: Pick<McpServer, "registerTool" | "registerResource">, adapter: TimelineAdapter, bundledAppJavascript: string): void;
declare function createTimelinePluginServer(options?: {
    adapter?: TimelineAdapter;
    bundledAppJavascript?: string;
}): McpServer;
declare function serveTimelinePluginStdio(options?: {
    adapter?: TimelineAdapter;
}): Promise<void>;

export { createTimelinePluginServer, registerTimelinePluginMcp, serveTimelinePluginStdio };
