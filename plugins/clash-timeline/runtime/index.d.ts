export { T as TimelineAdapter, a as TimelineCommandRunner, b as TimelineEntity, c as TimelineProjectionWriter, d as TimelineToolInput, e as buildTimelineCliArgs, f as createClashTimelineRunner, g as createTimelineAdapter, t as timelineWorkspaceCwd } from './adapter-2K0QanFc.js';
import { T as TimelineAppContract } from './server-BjBB4niA.js';
export { a as TIMELINE_APP_CONTRACT, b as TIMELINE_PLUGIN_SURFACE_BINDINGS, c as TIMELINE_PLUGIN_TOOL_NAMES, d as TimelinePluginToolName, e as TimelineToolErrorPayload, f as createTimelinePluginServer, r as registerTimelinePluginMcp, s as serveTimelinePluginStdio, t as timelineToolErrorPayload } from './server-BjBB4niA.js';
import '@modelcontextprotocol/sdk/server/mcp.js';
import '@clash/shared-mcp';
import '@clash/shared-types/timeline-contract';

declare const TIMELINE_APP_RESOURCE_URI = "ui://clash/timeline";
declare const TIMELINE_APP_MIME_TYPE = "text/html;profile=mcp-app";

declare function createTimelineAppHtml(bundledJavascript: string, appContract?: TimelineAppContract): string;

declare function isDirectExecution(moduleUrl: string, argvEntry?: string, cwd?: string): boolean;

export { TIMELINE_APP_MIME_TYPE, TIMELINE_APP_RESOURCE_URI, createTimelineAppHtml, isDirectExecution };
