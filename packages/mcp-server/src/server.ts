import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import {
  CANVAS_MCP_TOOL_NAMES,
  canvasToolVisibility,
  type CanvasMcpToolName,
  type CanvasToolInput,
} from "./canvas-contract";
import {
  createClashCliRunner,
  invokeCanvasTool,
  type CanvasCliRunner,
} from "./canvas-gateway";
import {
  CANVAS_APP_MIME_TYPE,
  CANVAS_APP_RESOURCE_URI,
  createCanvasAppHtml,
} from "./canvas-app";
import {
  createStudioAppHtml,
  STUDIO_APP_MIME_TYPE,
  STUDIO_APP_RESOURCE_URI,
} from "./studio-app";
import {
  CLASH_CLI_NAMESPACES,
  CLASH_CLI_NAMESPACE_TOOL_NAMES,
  buildCliNamespaceArgs,
} from "./cli-contract";

const scope = {
  cwd: z.string().min(1).optional().describe("Absolute project workspace path containing .clash/project.toml"),
  projectId: z.string().min(1).optional().describe("Project ID; defaults to the cwd .clash/project.toml marker"),
  canvasId: z.string().min(1).optional().describe("Canvas ID; defaults to main"),
};

const toolDefinitions: Record<CanvasMcpToolName, {
  title: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
  annotations?: Record<string, boolean>;
}> = {
  clash_canvas_open: {
    title: "Open Clash Canvas",
    description: "Open the interactive Clash Canvas App for a project Canvas.",
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_canvas_snapshot: {
    title: "Refresh Canvas snapshot",
    description: "Read the full node and edge snapshot used by the Canvas App.",
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_canvas_list: {
    title: "List Canvas nodes",
    description: "Run the same node listing as clash canvas list.",
    inputSchema: { ...scope, type: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_edges: {
    title: "List Canvas edges",
    description: "Run the same graph edge read as clash canvas edges.",
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_canvas_get: {
    title: "Read Canvas node",
    description: "Read one node, including immutability and asset metadata.",
    inputSchema: { ...scope, nodeId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_search: {
    title: "Search Canvas nodes",
    description: "Search Canvas node labels and content.",
    inputSchema: { ...scope, query: z.string().min(1), types: z.array(z.string()).optional() },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_add: {
    title: "Add Canvas node",
    description: "Create the same text, group, or generation Action node as clash canvas add.",
    inputSchema: {
      ...scope,
      type: z.string().min(1), label: z.string().min(1),
      content: z.string().optional(), prompt: z.string().optional(), parentId: z.string().optional(),
      modelId: z.string().optional(), actionId: z.string().optional(), refs: z.array(z.string()).optional(),
      params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
  },
  clash_canvas_execute: {
    title: "Execute Canvas node",
    description: "Execute a generation Action or Timeline render node.",
    inputSchema: { ...scope, nodeId: z.string().min(1) },
  },
  clash_canvas_update: {
    title: "Update Canvas node",
    description: "Update mutable node data with the same guards as clash canvas update.",
    inputSchema: {
      ...scope, nodeId: z.string().min(1), label: z.string().optional(), content: z.string().optional(),
      assetId: z.string().optional(),
      data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
  },
  clash_canvas_move: {
    title: "Move Canvas node",
    description: "Persist an absolute node position; used by CLI and Canvas App dragging.",
    inputSchema: { ...scope, nodeId: z.string().min(1), x: z.number().finite(), y: z.number().finite() },
    annotations: { idempotentHint: true },
  },
  clash_canvas_copy: {
    title: "Copy Canvas node",
    description: "Create a mutable copy while preserving downstream references.",
    inputSchema: { ...scope, nodeId: z.string().min(1), newNodeId: z.string().optional() },
  },
  clash_canvas_replace_asset: {
    title: "Replace Canvas media asset",
    description: "Create a copy-on-write media node bound to a replacement immutable asset.",
    inputSchema: {
      ...scope, nodeId: z.string().min(1), assetId: z.string().min(1),
      newNodeId: z.string().optional(), label: z.string().optional(),
    },
  },
  clash_canvas_delete_plan: {
    title: "Plan Canvas node deletion",
    description: "Read the graph-aware deletion plan before deleting nodes.",
    inputSchema: { ...scope, nodeIds: z.array(z.string().min(1)).min(1) },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_delete_batch: {
    title: "Delete Canvas node batch",
    description: "Apply a previously read graph-aware Canvas deletion.",
    inputSchema: { ...scope, nodeIds: z.array(z.string().min(1)).min(1) },
    annotations: { destructiveHint: true },
  },
  clash_canvas_delete: {
    title: "Delete Canvas node",
    description: "Delete one Canvas node using the same graph guards as the CLI.",
    inputSchema: { ...scope, nodeId: z.string().min(1) },
    annotations: { destructiveHint: true },
  },
};

function contentSummary(name: CanvasMcpToolName, value: unknown): string {
  if (name === "clash_canvas_open") {
    const count = Array.isArray((value as { nodes?: unknown[] })?.nodes)
      ? (value as { nodes: unknown[] }).nodes.length
      : 0;
    return `Opened Clash Canvas with ${count} node${count === 1 ? "" : "s"}.`;
  }
  if (name === "clash_canvas_snapshot") return "Canvas App snapshot refreshed.";
  return JSON.stringify(value);
}

export function registerClashCanvasMcp(
  server: Pick<McpServer, "registerTool" | "registerResource">,
  runner: CanvasCliRunner,
  bundledAppJavascript: string,
  bundledStudioAppJavascript = bundledAppJavascript,
  options: { appSurfaces?: boolean } = {},
): void {
  const appSurfaces = options.appSurfaces ?? false;
  for (const name of CANVAS_MCP_TOOL_NAMES) {
    if (!appSurfaces && (name === "clash_canvas_open" || name === "clash_canvas_snapshot")) continue;
    const definition = toolDefinitions[name];
    registerAppTool(server, name, {
      title: definition.title,
      description: definition.description,
      inputSchema: definition.inputSchema,
      annotations: definition.annotations,
      _meta: {
        ui: {
          ...(name === "clash_canvas_open"
            ? { resourceUri: CANVAS_APP_RESOURCE_URI }
            : {}),
          visibility: canvasToolVisibility(name),
        },
      },
    }, async (input) => {
      try {
        const value = await invokeCanvasTool(name, input as CanvasToolInput, runner);
        const structuredContent = Array.isArray(value) ? { items: value } : value as Record<string, unknown>;
        return {
          content: [{ type: "text" as const, text: contentSummary(name, value) }],
          structuredContent,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    });
  }

  if (appSurfaces) registerAppTool(server, "clash_studio_open", {
    title: "Open Clash Studio",
    description: "Open the local Clash host and project overview. Requires Clash Desktop or local-api to be running.",
    inputSchema: {
      cwd: z.string().min(1).optional().describe("Optional absolute workspace path used as CLI working directory"),
    },
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: STUDIO_APP_RESOURCE_URI, visibility: ["model", "app"] } },
  }, async (input) => {
    try {
      const cwd = typeof input.cwd === "string" ? input.cwd : undefined;
      const [host, projectsValue] = await Promise.all([
        runner(["host", "status", "--json"], cwd),
        runner(["projects", "list", "--json"], cwd),
      ]);
      const projects = Array.isArray(projectsValue)
        ? projectsValue
        : Array.isArray((projectsValue as { items?: unknown[] } | null)?.items)
          ? (projectsValue as { items: unknown[] }).items
          : [];
      const structuredContent = {
        cwd: cwd ?? process.env.CLASH_WORKSPACE_ROOT ?? process.cwd(),
        host,
        projects,
      };
      return {
        content: [{ type: "text" as const, text: `Opened Clash Studio with ${projects.length} project${projects.length === 1 ? "" : "s"}.` }],
        structuredContent,
      };
    } catch (error) {
      return {
        content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        isError: true,
      };
    }
  });

  for (const [index, name] of CLASH_CLI_NAMESPACE_TOOL_NAMES.entries()) {
    const namespace = CLASH_CLI_NAMESPACES[index];
    registerAppTool(server, name, {
      title: `Clash ${namespace}`,
      description: `Run any public clash ${namespace} CLI operation with an exact argv array. Use --json when the command supports it.`,
      inputSchema: {
        cwd: z.string().min(1).optional().describe("Optional absolute workspace path used as CLI working directory"),
        args: z.array(z.string()).max(128).default([]).describe(`Arguments after "clash ${namespace}"`),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    }, async (input) => {
      try {
        const value = await runner(
          buildCliNamespaceArgs(name, input),
          typeof input.cwd === "string" ? input.cwd : undefined,
        );
        return {
          content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }],
          structuredContent: Array.isArray(value) ? { items: value } : value as Record<string, unknown>,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text" as const, text: message }], isError: true };
      }
    });
  }

  if (appSurfaces) registerAppResource(server, "Clash Canvas", CANVAS_APP_RESOURCE_URI, {
    description: "Interactive Clash node Canvas",
  }, async () => ({
    contents: [{
      uri: CANVAS_APP_RESOURCE_URI,
      mimeType: CANVAS_APP_MIME_TYPE,
      text: createCanvasAppHtml(bundledAppJavascript),
      _meta: { ui: { csp: {} } },
    }],
  }));

  if (appSurfaces) registerAppResource(server, "Clash Studio", STUDIO_APP_RESOURCE_URI, {
    description: "Local Clash host and project overview",
  }, async () => ({
    contents: [{
      uri: STUDIO_APP_RESOURCE_URI,
      mimeType: STUDIO_APP_MIME_TYPE,
      text: createStudioAppHtml(bundledStudioAppJavascript),
      _meta: { ui: { csp: {} } },
    }],
  }));
}

export function createClashMcpServer(options: {
  runner?: CanvasCliRunner;
  bundledAppJavascript?: string;
  bundledStudioAppJavascript?: string;
  appSurfaces?: boolean;
} = {}): McpServer {
  const server = new McpServer({ name: "clash", version: "0.1.0" });
  const bundledAppJavascript = options.bundledAppJavascript ?? readFileSync(
    new URL("./canvas-app-client.js", import.meta.url),
    "utf8",
  );
  const bundledStudioAppJavascript = options.bundledStudioAppJavascript ?? options.bundledAppJavascript ?? readFileSync(
    new URL("./studio-app-client.js", import.meta.url),
    "utf8",
  );
  registerClashCanvasMcp(
    server,
    options.runner ?? createClashCliRunner(),
    bundledAppJavascript,
    bundledStudioAppJavascript,
    { appSurfaces: options.appSurfaces },
  );
  return server;
}

export async function serveClashMcpStdio(options: {
  command?: string;
  argsPrefix?: string[];
  cwd?: string;
} = {}): Promise<void> {
  const server = createClashMcpServer({
    runner: createClashCliRunner({ command: options.command, argsPrefix: options.argsPrefix, cwd: options.cwd }),
  });
  await server.connect(new StdioServerTransport());
}

export type ClashMcpHttpHandle = {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
};

export async function startClashMcpHttpServer(options: {
  host?: string;
  port?: number;
  command?: string;
  argsPrefix?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  runner?: CanvasCliRunner;
  bundledAppJavascript?: string;
  bundledStudioAppJavascript?: string;
} = {}): Promise<ClashMcpHttpHandle> {
  const [streamableModule, expressModule, typesModule, cryptoModule] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/streamableHttp.js"),
    import("@modelcontextprotocol/sdk/server/express.js"),
    import("@modelcontextprotocol/sdk/types.js"),
    import("node:crypto"),
  ]);
  const { StreamableHTTPServerTransport } = streamableModule;
  const { createMcpExpressApp } = expressModule;
  const { isInitializeRequest } = typesModule;
  const { randomUUID } = cryptoModule;
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();
  const app = createMcpExpressApp({ host });
  const runner = options.runner ?? createClashCliRunner({
    command: options.command,
    argsPrefix: options.argsPrefix,
    cwd: options.cwd,
    env: options.env,
  });

  app.get("/health", (_request: any, response: any) => {
    response.json({ status: "ok", transport: "streamable-http", endpoint: "/mcp" });
  });

  const route = async (request: any, response: any) => {
    const sessionId = request.headers["mcp-session-id"] as string | undefined;
    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId)!.transport.handleRequest(request, response, request.body);
      return;
    }
    if (!sessionId && isInitializeRequest(request.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id): void => {
          sessions.set(id, { transport, server });
        },
      });
      const server = createClashMcpServer({
        runner,
        bundledAppJavascript: options.bundledAppJavascript,
        bundledStudioAppJavascript: options.bundledStudioAppJavascript,
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(request, response, request.body);
      return;
    }
    const status = sessionId ? 404 : 400;
    response.status(status).json({
      jsonrpc: "2.0",
      error: { code: sessionId ? -32001 : -32000, message: sessionId ? "Session not found" : "Session ID required" },
      id: null,
    });
  };
  app.post("/mcp", route);
  app.get("/mcp", route);
  app.delete("/mcp", route);

  const httpServer = await new Promise<import("node:http").Server>((resolve, reject) => {
    const listening = app.listen(port, host, () => resolve(listening));
    listening.once("error", reject);
  });
  const address = httpServer.address() as AddressInfo;
  return {
    url: `http://${host}:${address.port}/mcp`,
    host,
    port: address.port,
    async close() {
      await Promise.all([...sessions.values()].map(async ({ transport, server }) => {
        await transport.close().catch(() => undefined);
        await server.close().catch(() => undefined);
      }));
      sessions.clear();
      await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()));
    },
  };
}
