import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ClashStaleRecovery } from '@clash/shared-mcp';
import { T as TimelineAdapter } from './adapter-Dl_WUYeZ.js';
import { TimelineDslTrackCategory, TIMELINE_OPERATION_REGISTRY } from '@clash/shared-types/timeline-contract';

type TimelineAgentOperationId = keyof typeof TIMELINE_OPERATION_REGISTRY.agent;
type TimelinePluginSurfaceBinding = {
    operationId: TimelineAgentOperationId;
};
declare const TIMELINE_PLUGIN_SURFACE_BINDINGS: Readonly<Record<string, TimelinePluginSurfaceBinding>>;
type TimelinePluginSurfaceToolName = `clash_timeline_${string}`;
declare const TIMELINE_PLUGIN_TOOL_NAMES: readonly TimelinePluginSurfaceToolName[];
/**
 * Narrow server-to-browser projection. The browser bundle deliberately does
 * not import shared-types; the MCP resource injects this generated payload.
 */
declare const TIMELINE_APP_CONTRACT: Readonly<{
    contractFingerprint: string;
    trackCategories: readonly Readonly<{
        id: "effect" | "text" | "visual" | "primary" | "audio";
        label: "Effects" | "Text / subtitle" | "Video / image" | "Primary video" | "Audio";
    }>[];
    defaultTrackCategory: TimelineDslTrackCategory;
    inspector: Readonly<{
        scope: "timing-only";
        editableItemFields: readonly ["from", "durationInFrames"];
    }>;
}>;
type TimelineAppContract = typeof TIMELINE_APP_CONTRACT;

type TimelineToolErrorPayload = {
    code: string;
    message: string;
    retryTool?: TimelinePluginSurfaceToolName;
    recovery?: ClashStaleRecovery;
    issues?: Array<{
        ruleId: string;
        path: Array<string | number>;
        message: string;
    }>;
};
declare function timelineToolErrorPayload(error: unknown): TimelineToolErrorPayload;
declare function registerTimelinePluginMcp(server: Pick<McpServer, "registerTool" | "registerResource">, adapter: TimelineAdapter, bundledAppJavascript: string, options?: {
    appSurfaces?: boolean;
}): void;
declare function createTimelinePluginServer(options?: {
    adapter?: TimelineAdapter;
    bundledAppJavascript?: string;
}): McpServer;
declare function serveTimelinePluginStdio(options?: {
    adapter?: TimelineAdapter;
}): Promise<void>;

export { type TimelineAppContract as T, TIMELINE_APP_CONTRACT as a, TIMELINE_PLUGIN_SURFACE_BINDINGS as b, TIMELINE_PLUGIN_TOOL_NAMES as c, type TimelinePluginSurfaceToolName as d, type TimelineToolErrorPayload as e, createTimelinePluginServer as f, registerTimelinePluginMcp as r, serveTimelinePluginStdio as s, timelineToolErrorPayload as t };
