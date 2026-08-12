import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { ClashMcpServer, describeClashTool } from "@clash/shared-mcp";
import { initializeClashWorkspace } from "@clash/shared-runtime";
import {
  createProjectHostClient,
  type ProjectHostClient,
} from "@clash/shared-runtime/project-host-client";
import {
  CANVAS_MCP_TOOL_NAMES,
  canvasToolVisibility,
  type CanvasMcpToolName,
  type CanvasToolInput,
} from "./canvas-contract";
import {
  createCanvasProjectHostGateway,
  type CanvasProjectHostGateway,
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

const scope = {
  cwd: z
    .string()
    .min(1)
    .optional()
    .describe("Absolute project workspace path containing .clash/project.toml"),
  projectId: z
    .string()
    .min(1)
    .optional()
    .describe("Project ID; defaults to the cwd .clash/project.toml marker"),
  canvasId: z
    .string()
    .min(1)
    .optional()
    .describe("Canvas ID; defaults to main"),
};

const toolDefinitions: Record<
  CanvasMcpToolName,
  {
    title: string;
    description: string;
    inputSchema: Record<string, z.ZodTypeAny>;
    annotations?: Record<string, boolean>;
  }
> = {
  clash_canvas_open: {
    title: "Open Clash Canvas",
    description: describeClashTool({
      useWhen: "a person needs the interactive Canvas surface",
      effect:
        "opens a read-only projection of the selected Canvas without changing product state",
      returns: "the current Canvas snapshot used by the app",
      next: "inspect the snapshot or choose a typed mutation from its advertised contract",
    }),
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_canvas_snapshot: {
    title: "Refresh Canvas snapshot",
    description: describeClashTool({
      useWhen: "the interactive Canvas projection needs fresh nodes and edges",
      effect: "reads current Canvas state without changing it",
      returns: "the complete app snapshot",
      next: "inspect the returned identities before choosing a mutation",
    }),
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_canvas_list: {
    title: "List Canvas nodes",
    description: describeClashTool({
      useWhen:
        "you need candidate Canvas nodes and do not yet have the exact node identity",
      effect:
        "reads node summaries, optionally filtered by type, without changing the Canvas",
      returns: "matching node summaries and their stable IDs",
      next: "read the chosen node before updating, copying, executing, or planning deletion",
    }),
    inputSchema: { ...scope, type: z.string().optional() },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_edges: {
    title: "List Canvas edges",
    description: describeClashTool({
      useWhen: "a decision depends on graph relationships between Canvas nodes",
      effect:
        "reads current dependency and reference edges without changing the Canvas",
      returns: "the Canvas edge set with source and target identities",
      next: "use those relationships to plan the smallest safe edit",
    }),
    inputSchema: scope,
    annotations: { readOnlyHint: true },
  },
  clash_canvas_get: {
    title: "Read Canvas node",
    description: describeClashTool({
      useWhen:
        "you have a node ID and need its complete current state before acting",
      effect:
        "reads the node, including immutability, asset, and execution metadata",
      returns: "the complete node and any locally readable asset information",
      next: "use the returned state and ID in the selected typed mutation or completion check",
    }),
    inputSchema: { ...scope, nodeId: z.string().min(1) },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_search: {
    title: "Search Canvas nodes",
    description: describeClashTool({
      useWhen:
        "you know descriptive text but not the exact Canvas node identity",
      effect: "searches node labels and content without changing product state",
      returns: "ranked matching node summaries and IDs",
      next: "read the intended match before mutating or executing it",
    }),
    inputSchema: {
      ...scope,
      query: z.string().min(1),
      types: z.array(z.string()).optional(),
    },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_add: {
    title: "Add Canvas node",
    description: describeClashTool({
      useWhen:
        "the creative outcome needs a new text, group, editable Remotion TSX component, or generation Action node",
      effect:
        "creates one persisted Canvas node; type 'remotion' stores a distinct remotion-component with a stable node ID and editable TSX content",
      returns: "the created node and its stable ID",
      next: "read the node; execute only generation Actions, while Remotion components are referenced by sourceNodeId from a Timeline and rendered through timeline render",
    }),
    inputSchema: {
      ...scope,
      type: z
        .string()
        .min(1)
        .describe(
          "Node type: text, group, remotion, image_gen, video_gen, audio_gen, or text_gen",
        ),
      label: z.string().min(1),
      content: z
        .string()
        .optional()
        .describe(
          "Text content, or for type 'remotion', a single-file default-exported Remotion TSX component",
        ),
      prompt: z.string().optional(),
      parentId: z.string().optional(),
      modelId: z.string().optional(),
      actionId: z.string().optional(),
      refs: z.array(z.string()).optional(),
      params: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    },
  },
  clash_canvas_execute: {
    title: "Execute Canvas node",
    description: describeClashTool({
      useWhen:
        "a persisted generation Action or Timeline render node should be submitted exactly once",
      effect:
        "submits the selected executable node; submission is not completion",
      returns: "the accepted submission state and any child node identity",
      next: "read the returned child or target until terminal state, and never duplicate an accepted submission",
    }),
    inputSchema: { ...scope, nodeId: z.string().min(1) },
  },
  clash_canvas_update: {
    title: "Update Canvas node",
    description: describeClashTool({
      useWhen:
        "an existing mutable Canvas node needs an in-place metadata or content edit",
      effect:
        "updates only supported mutable fields while preserving the node identity",
      returns: "the updated persisted node",
      next: "read it back and confirm the intended fields before further work",
    }),
    inputSchema: {
      ...scope,
      nodeId: z.string().min(1),
      label: z.string().optional(),
      content: z.string().optional(),
      assetId: z.string().optional(),
      data: z
        .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
        .optional(),
    },
  },
  clash_canvas_move: {
    title: "Move Canvas node",
    description: describeClashTool({
      useWhen: "an existing Canvas node needs a new absolute visual position",
      effect:
        "persists the supplied Canvas coordinates without changing node content",
      returns: "the moved node with its stored position",
      next: "read or inspect the layout if placement quality matters",
    }),
    inputSchema: {
      ...scope,
      nodeId: z.string().min(1),
      x: z.number().finite(),
      y: z.number().finite(),
    },
    annotations: { idempotentHint: true },
  },
  clash_canvas_copy: {
    title: "Copy Canvas node",
    description: describeClashTool({
      useWhen:
        "an immutable or reusable node needs an independently editable variant",
      effect:
        "creates a copy-on-write node while preserving the original and downstream references",
      returns: "the copied node and its new stable ID",
      next: "edit or replace assets on the returned copy rather than the original",
    }),
    inputSchema: {
      ...scope,
      nodeId: z.string().min(1),
      newNodeId: z.string().optional(),
    },
  },
  clash_canvas_replace_asset: {
    title: "Replace Canvas media asset",
    description: describeClashTool({
      useWhen:
        "a media node should point at a different immutable asset without mutating the source node",
      effect:
        "creates a copy-on-write media node bound to the replacement asset",
      returns: "the replacement node and its new stable ID",
      next: "read the returned node and verify its asset identity before using it downstream",
    }),
    inputSchema: {
      ...scope,
      nodeId: z.string().min(1),
      assetId: z.string().min(1),
      newNodeId: z.string().optional(),
      label: z.string().optional(),
    },
  },
  clash_canvas_delete_plan: {
    title: "Plan Canvas node deletion",
    description: describeClashTool({
      useWhen:
        "the user has requested deletion and graph impact must be understood first",
      effect:
        "computes the affected Canvas nodes and edges without deleting anything",
      returns: "a graph-aware deletion plan for the requested IDs",
      next: "show or verify the impact, then apply the exact batch only after deletion is authorized",
    }),
    inputSchema: { ...scope, nodeIds: z.array(z.string().min(1)).min(1) },
    annotations: { readOnlyHint: true },
  },
  clash_canvas_delete_batch: {
    title: "Delete Canvas node batch",
    description: describeClashTool({
      useWhen: "an authorized graph-aware deletion plan should now be applied",
      effect: "destructively deletes the exact requested Canvas node batch",
      returns: "the deleted identities and resulting graph state",
      next: "read the Canvas to confirm only the planned nodes were removed",
    }),
    inputSchema: { ...scope, nodeIds: z.array(z.string().min(1)).min(1) },
    annotations: { destructiveHint: true },
  },
  clash_canvas_delete: {
    title: "Delete Canvas node",
    description: describeClashTool({
      useWhen: "the user has authorized deletion of one confirmed Canvas node",
      effect: "destructively removes that node using graph safety guards",
      returns: "the deleted identity and resulting state",
      next: "read the Canvas to confirm the requested removal",
    }),
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
  gateway: CanvasProjectHostGateway,
  bundledAppJavascript: string,
  bundledStudioAppJavascript = bundledAppJavascript,
  options: { appSurfaces?: boolean } = {},
): void {
  const appSurfaces = options.appSurfaces ?? false;
  for (const name of CANVAS_MCP_TOOL_NAMES) {
    if (
      !appSurfaces &&
      (name === "clash_canvas_open" || name === "clash_canvas_snapshot")
    )
      continue;
    const definition = toolDefinitions[name];
    registerAppTool(
      server,
      name,
      {
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
      },
      async (input) => {
        try {
          const value = await gateway.invoke(name, input as CanvasToolInput);
          const structuredContent = Array.isArray(value)
            ? { items: value }
            : (value as Record<string, unknown>);
          return {
            content: [
              { type: "text" as const, text: contentSummary(name, value) },
            ],
            structuredContent,
          };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      },
    );
  }

  if (appSurfaces)
    registerAppTool(
      server,
      "clash_studio_open",
      {
        title: "Open Clash Studio",
        description: describeClashTool({
          useWhen:
            "a person needs the interactive local host and project overview",
          effect:
            "opens a read-only Studio projection and does not mutate project state",
          returns: "host status and visible project summaries",
          next: "select a project or use a typed product capability for further work",
        }),
        inputSchema: {
          cwd: z
            .string()
            .min(1)
            .optional()
            .describe(
              "Optional absolute workspace path used as CLI working directory",
            ),
        },
        annotations: { readOnlyHint: true },
        _meta: {
          ui: {
            resourceUri: STUDIO_APP_RESOURCE_URI,
            visibility: ["model", "app"],
          },
        },
      },
      async (input) => {
        try {
          const cwd = typeof input.cwd === "string" ? input.cwd : undefined;
          const nodes = await gateway.invoke("clash_canvas_list", { cwd });
          const projects: unknown[] = [];
          const structuredContent = {
            cwd: cwd ?? process.env.CLASH_WORKSPACE_ROOT ?? process.cwd(),
            host: { status: "active", transport: "project-host" },
            projects,
            nodes: Array.isArray(nodes) ? nodes : [],
          };
          return {
            content: [
              {
                type: "text" as const,
                text: `Opened Clash Studio with ${projects.length} project${projects.length === 1 ? "" : "s"}.`,
              },
            ],
            structuredContent,
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text" as const,
                text: error instanceof Error ? error.message : String(error),
              },
            ],
            isError: true,
          };
        }
      },
    );

  registerAppTool(
    server,
    "clash_workspace_init",
    {
      title: "Initialize Clash workspace",
      description: describeClashTool({
        useWhen: "the current workspace is not yet bound to a Clash project",
        effect:
          "creates the canonical binding once, reuses a compatible binding, and refuses to overwrite a conflicting project",
        returns:
          "the project ID, workspace ID, marker path, and whether the binding was reused",
        next: "use the advertised typed capability that directly matches the creative outcome",
      }),
      inputSchema: {
        cwd: z
          .string()
          .min(1)
          .describe("Absolute path of the workspace to initialize"),
        projectId: z
          .string()
          .min(1)
          .optional()
          .describe("Optional stable Clash project ID; generated when omitted"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (input) => {
      try {
        const initialized = await initializeClashWorkspace({
          cwd: input.cwd,
          ...(typeof input.projectId === "string"
            ? { projectId: input.projectId }
            : {}),
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `${initialized.reused ? "Reused" : "Created"} Clash workspace for project ${initialized.projectId}.`,
            },
          ],
          structuredContent: initialized,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: message }],
          isError: true,
        };
      }
    },
  );

  if (appSurfaces)
    registerAppResource(
      server,
      "Clash Canvas",
      CANVAS_APP_RESOURCE_URI,
      {
        description: "Interactive Clash node Canvas",
      },
      async () => ({
        contents: [
          {
            uri: CANVAS_APP_RESOURCE_URI,
            mimeType: CANVAS_APP_MIME_TYPE,
            text: createCanvasAppHtml(bundledAppJavascript),
            _meta: { ui: { csp: {} } },
          },
        ],
      }),
    );

  if (appSurfaces)
    registerAppResource(
      server,
      "Clash Studio",
      STUDIO_APP_RESOURCE_URI,
      {
        description: "Local Clash host and project overview",
      },
      async () => ({
        contents: [
          {
            uri: STUDIO_APP_RESOURCE_URI,
            mimeType: STUDIO_APP_MIME_TYPE,
            text: createStudioAppHtml(bundledStudioAppJavascript),
            _meta: { ui: { csp: {} } },
          },
        ],
      }),
    );
}

export function createClashMcpServer(
  options: {
    client?: ProjectHostClient;
    gateway?: CanvasProjectHostGateway;
    bundledAppJavascript?: string;
    bundledStudioAppJavascript?: string;
    appSurfaces?: boolean;
  } = {},
): McpServer {
  const server = new ClashMcpServer({
    name: "clash",
    version: process.env.CLASH_DISTRIBUTION_VERSION ?? "0.1.0",
  });
  const bundledAppJavascript =
    options.bundledAppJavascript ??
    readFileSync(new URL("./canvas-app-client.js", import.meta.url), "utf8");
  const bundledStudioAppJavascript =
    options.bundledStudioAppJavascript ??
    options.bundledAppJavascript ??
    readFileSync(new URL("./studio-app-client.js", import.meta.url), "utf8");
  registerClashCanvasMcp(
    server,
    options.gateway ?? createCanvasProjectHostGateway(
      options.client ?? createProjectHostClient(),
    ),
    bundledAppJavascript,
    bundledStudioAppJavascript,
    { appSurfaces: options.appSurfaces },
  );
  return server;
}
