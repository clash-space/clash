import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import {
  createTimelineAdapter,
  type TimelineAdapter,
} from "./adapter.js";
import {
  TIMELINE_PLUGIN_SURFACE_BINDINGS,
  TIMELINE_PLUGIN_TOOL_NAMES,
  type TimelinePluginToolName,
  type TimelineToolInput,
} from "./contract.js";
import {
  createTimelineAppHtml,
  TIMELINE_APP_MIME_TYPE,
  TIMELINE_APP_RESOURCE_URI,
} from "./app.js";
import {
  timelineOperationMetadata,
} from "./timeline-contract-adapter.js";
import { timelineMcpExecutor } from "./timeline-mcp-executors.js";

function structured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { items: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return { value };
}

export type TimelineToolErrorPayload = {
  code: string;
  message: string;
  retryTool?: TimelinePluginToolName;
  issues?: Array<{
    ruleId: string;
    path: Array<string | number>;
    message: string;
  }>;
};

export function timelineToolErrorPayload(error: unknown): TimelineToolErrorPayload {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const explicitError = rawMessage.match(
    /(?:^|[\r\n])\s*(?:Error:\s*)?([A-Z][A-Z0-9_]+:[^\r\n]*)/,
  )?.[1]?.trim();
  const message = explicitError ?? rawMessage;
  const explicitCode = message.match(/^([A-Z][A-Z0-9_]+):/)?.[1];
  const code = explicitCode
    ?? (/baseRevisionId is required|read .* before saving/i.test(message)
      ? "READ_REQUIRED"
      : /not found/i.test(message)
        ? "TIMELINE_NOT_FOUND"
        : /validation|Timeline item|\berror:/i.test(message)
          ? "TIMELINE_DSL_INVALID"
          : "TIMELINE_OPERATION_FAILED");
  const retryTool: TimelinePluginToolName | undefined =
    code === "STALE_TIMELINE" || code === "STALE_READ" || code === "READ_REQUIRED"
      ? "clash_timeline_get"
      : code === "TIMELINE_DSL_INVALID"
        ? "clash_timeline_schema"
        : code === "TIMELINE_NOT_FOUND"
          ? "clash_timeline_list"
          : undefined;
  const issues = error && typeof error === "object" && Array.isArray(
    (error as { issues?: unknown }).issues,
  )
    ? (error as TimelineToolErrorPayload).issues
    : undefined;
  return {
    code,
    message,
    ...(retryTool ? { retryTool } : {}),
    ...(issues ? { issues } : {}),
  };
}

export function registerTimelinePluginMcp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
  adapter: TimelineAdapter,
  bundledAppJavascript: string,
  options: { appSurfaces?: boolean } = {},
): void {
  const appSurfaces = options.appSurfaces ?? false;
  for (const name of TIMELINE_PLUGIN_TOOL_NAMES) {
    if (!appSurfaces && name === "clash_timeline_open") continue;
    const binding = TIMELINE_PLUGIN_SURFACE_BINDINGS[name];
    const executor = timelineMcpExecutor(binding.operationId);
    const operation = timelineOperationMetadata(name)!;
    registerAppTool(server, name, {
      title: executor.title,
      description: operation.description,
      inputSchema: executor.inputSchema,
      outputSchema: executor.outputSchema,
      annotations: { readOnlyHint: operation.readOnly },
      _meta: {
        "clash/timelineOperation": operation,
        ui: {
          ...(name === "clash_timeline_open"
            ? { resourceUri: TIMELINE_APP_RESOURCE_URI }
            : {}),
          visibility: ["model", "app"],
        },
      },
    }, async (input: unknown) => {
      try {
        const value = await executor.execute(input as TimelineToolInput, adapter);
        return {
          content: [{ type: "text" as const, text: executor.summary(value) }],
          structuredContent: structured(value),
        };
      } catch (error) {
        const structuredError = timelineToolErrorPayload(error);
        return {
          content: [{ type: "text" as const, text: structuredError.message }],
          structuredContent: { error: structuredError },
          isError: true,
        };
      }
    });
  }

  if (appSurfaces) registerAppResource(server, "Clash Timeline", TIMELINE_APP_RESOURCE_URI, {
    description: "Interactive Timeline editor backed by Clash read-proof and apply behavior",
  }, async () => ({
    contents: [{
      uri: TIMELINE_APP_RESOURCE_URI,
      mimeType: TIMELINE_APP_MIME_TYPE,
      text: createTimelineAppHtml(bundledAppJavascript),
      _meta: { ui: { csp: {} } },
    }],
  }));
}

export function createTimelinePluginServer(options: {
  adapter?: TimelineAdapter;
  bundledAppJavascript?: string;
} = {}): McpServer {
  const server = new McpServer({ name: "clash-timeline", version: "0.1.0" });
  const bundledAppJavascript = options.bundledAppJavascript ?? readFileSync(
    new URL("./app-client.js", import.meta.url),
    "utf8",
  );
  registerTimelinePluginMcp(
    server,
    options.adapter ?? createTimelineAdapter(),
    bundledAppJavascript,
  );
  return server;
}

export async function serveTimelinePluginStdio(options: {
  adapter?: TimelineAdapter;
} = {}): Promise<void> {
  const server = createTimelinePluginServer(options);
  await server.connect(new StdioServerTransport());
}
