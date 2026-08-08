export { D as DIRECTOR_PLUGIN_TOOL_NAMES, a as DirectorAdapter, b as DirectorCommandRunner, c as DirectorEntity, d as DirectorPluginToolName, e as DirectorProjectionWriter, f as DirectorToolInput, g as buildDirectorCliArgs, h as createClashDirectorRunner, i as createDirectorAdapter, j as directorWorkspaceCwd } from './adapter-sbJuaJaM.js';
export { DirectorToolErrorPayload, createDirectorPluginServer, directorToolErrorPayload, registerDirectorPluginMcp, serveDirectorPluginStdio } from './server.js';
import '@modelcontextprotocol/sdk/server/mcp.js';
import '@clash/shared-mcp';

declare const DIRECTOR_APP_RESOURCE_URI = "ui://clash/director";
declare const DIRECTOR_APP_MIME_TYPE = "text/html;profile=mcp-app";
declare function createDirectorAppHtml(bundledJavascript: string): string;

declare function isDirectExecution(moduleUrl: string, argvEntry?: string, cwd?: string): boolean;

export { DIRECTOR_APP_MIME_TYPE, DIRECTOR_APP_RESOURCE_URI, createDirectorAppHtml, isDirectExecution };
