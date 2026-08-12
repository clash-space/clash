export { D as DIRECTOR_PLUGIN_TOOL_NAMES, a as DirectorAdapter, b as DirectorEntity, c as DirectorPluginToolName, d as DirectorProjectionWriter, e as DirectorToolInput, f as buildDirectorCliArgs, g as createDirectorAdapter, h as directorWorkspaceCwd } from './adapter-BJBHIdFm.js';
export { DirectorToolErrorPayload, createDirectorPluginServer, directorToolErrorPayload, registerDirectorPluginMcp, serveDirectorPluginStdio } from './server.js';
import '@clash/shared-runtime/project-host-client';
import '@modelcontextprotocol/sdk/server/mcp.js';
import '@clash/shared-mcp';

declare const DIRECTOR_APP_RESOURCE_URI = "ui://clash/director";
declare const DIRECTOR_APP_MIME_TYPE = "text/html;profile=mcp-app";
declare function createDirectorAppHtml(bundledJavascript: string): string;

declare function isDirectExecution(moduleUrl: string, argvEntry?: string, cwd?: string): boolean;

export { DIRECTOR_APP_MIME_TYPE, DIRECTOR_APP_RESOURCE_URI, createDirectorAppHtml, isDirectExecution };
