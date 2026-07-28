export { T as TIMELINE_PLUGIN_TOOL_NAMES, a as TimelineAdapter, b as TimelineCommandRunner, c as TimelineEntity, d as TimelinePluginToolName, e as TimelineProjectionWriter, f as TimelineToolInput, g as buildTimelineCliArgs, h as createClashTimelineRunner, i as createTimelineAdapter, t as timelineWorkspaceCwd } from './adapter-DSKpN3gP.js';
export { createTimelinePluginServer, registerTimelinePluginMcp, serveTimelinePluginStdio } from './server.js';
import '@modelcontextprotocol/sdk/server/mcp.js';

declare const TIMELINE_APP_RESOURCE_URI = "ui://clash/timeline";
declare const TIMELINE_APP_MIME_TYPE = "text/html;profile=mcp-app";
declare function createTimelineAppHtml(bundledJavascript: string): string;

declare function isDirectExecution(moduleUrl: string, argvEntry?: string, cwd?: string): boolean;

export { TIMELINE_APP_MIME_TYPE, TIMELINE_APP_RESOURCE_URI, createTimelineAppHtml, isDirectExecution };
