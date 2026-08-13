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
  createPersonalGlobalAssetHostClient,
  createProjectAssetHostClient,
  type PersonalGlobalAssetHostClient,
  type ProjectAssetHostClient,
} from "@clash/shared-runtime/project-asset-client";
import {
  createProjectHostClient,
  type ProjectHostClient,
} from "@clash/shared-runtime/project-host-client";
import {
  ASSET_MCP_TOOL_NAMES,
  type AssetMcpToolName,
  type AssetToolInput,
} from "./asset-contract";
import {
  createAssetProjectHostGateway,
  type AssetProjectHostGateway,
} from "./asset-gateway";
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

const assetScope = {
  cwd: scope.cwd,
  projectId: scope.projectId,
};

const assetToolDefinitions: Record<
  AssetMcpToolName,
  {
    title: string;
    description: string;
    inputSchema: Record<string, z.ZodTypeAny>;
    annotations?: Record<string, boolean>;
    metadata?: Record<string, unknown>;
  }
> = {
  clash_assets_list: {
    title: "List Project Assets",
    description: describeClashTool({
      useWhen: "you need candidate media identities in the selected Project",
      effect:
        "reads storage-neutral ResolvedAsset summaries without changing product state",
      returns: "the Project's ResolvedAsset list with stable Project Asset IDs",
      next: "read the selected Asset with get before trashing or restoring it",
    }),
    inputSchema: assetScope,
    annotations: { readOnlyHint: true },
  },
  clash_assets_get: {
    title: "Read Project Asset",
    description: describeClashTool({
      useWhen:
        "you have a Project Asset ID and need its current resolved state",
      effect:
        "reads one storage-neutral ResolvedAsset and records the Host observation internally",
      returns: "one ResolvedAsset; internal CAS receipts are never returned",
      next: "inspect its state and references before choosing trash, restore, or no mutation",
    }),
    inputSchema: { ...assetScope, assetId: z.string().trim().min(1) },
    annotations: { readOnlyHint: true },
    metadata: { "clash/readProof": { recordsObservation: true } },
  },
  clash_assets_references: {
    title: "List Project Asset references",
    description: describeClashTool({
      useWhen:
        "you need to know which Action inputs or outputs reference a Project Asset",
      effect:
        "reads authoritative ActionAssetBindings and records the Host observation internally",
      returns: "the Project Asset ID and its Action-level references",
      next: "do not trash an Asset with blocking input references; otherwise use the recorded observation",
    }),
    inputSchema: { ...assetScope, assetId: z.string().trim().min(1) },
    annotations: { readOnlyHint: true },
    metadata: { "clash/readProof": { recordsObservation: true } },
  },
  clash_assets_import_file: {
    title: "Import Project Asset file",
    description: describeClashTool({
      useWhen:
        "a local workspace media file should become an immutable Project Asset",
      effect:
        "uploads the file once through the Host's canonical multipart import-file route",
      returns: "the newly created Project-scoped ResolvedAsset",
      next: "use the returned Project Asset ID in Actions or read it before a lifecycle mutation",
    }),
    inputSchema: {
      ...assetScope,
      filePath: z
        .string()
        .trim()
        .min(1)
        .describe(
          "Absolute path or path relative to cwd/the selected Clash workspace",
        ),
      kind: z
        .enum(["image", "video", "audio", "model"])
        .optional()
        .describe(
          "Optional media kind; when omitted it is inferred from the file extension",
        ),
    },
  },
  clash_assets_admit: {
    title: "Admit Global Asset to Project",
    description: describeClashTool({
      useWhen:
        "a personal Global Asset should become an independently identified member of the selected Project",
      effect:
        "asks the Host to admit the Global Asset's immutable Resource and create one linked Project Asset",
      returns: "the newly admitted Project-scoped ResolvedAsset",
      next: "use the returned Project Asset ID in Project Actions",
    }),
    inputSchema: {
      ...assetScope,
      globalAssetId: z.string().trim().min(1),
    },
  },
  clash_assets_publish: {
    title: "Publish Project Asset to Global library",
    description: describeClashTool({
      useWhen:
        "an active Project Asset should become independently available in the personal Global library",
      effect:
        "asks the Host to publish the Project Asset's immutable Resource as one Global Asset",
      returns: "the newly published personal Global ResolvedAsset",
      next: "use the returned Global Asset ID for future Project admissions",
    }),
    inputSchema: {
      ...assetScope,
      projectAssetId: z.string().trim().min(1),
    },
  },
  clash_assets_trash: {
    title: "Trash Project Asset",
    description: describeClashTool({
      useWhen:
        "the user authorized logical deletion of an unreferenced Project Asset",
      effect:
        "logically trashes the Asset using the most recent internal Host observation",
      returns: "the updated storage-neutral ResolvedAsset",
      next: "read it back to confirm lifecycle state; resolve ASSET_IN_USE references instead of forcing deletion",
    }),
    inputSchema: { ...assetScope, assetId: z.string().trim().min(1) },
    annotations: { destructiveHint: true },
  },
  clash_assets_restore: {
    title: "Restore Project Asset",
    description: describeClashTool({
      useWhen: "a logically trashed Project Asset should return to active use",
      effect:
        "restores the Asset using the most recent internal Host observation",
      returns: "the restored storage-neutral ResolvedAsset",
      next: "read it back before any later lifecycle mutation",
    }),
    inputSchema: { ...assetScope, assetId: z.string().trim().min(1) },
  },
  clash_assets_global_list: {
    title: "List personal Global Assets",
    description: describeClashTool({
      useWhen:
        "you need reusable media identities from the personal Global library",
      effect:
        "reads storage-neutral Global ResolvedAsset summaries without requiring Project context",
      returns: "the personal Global library's ResolvedAsset list",
      next: "read the selected Global Asset or admit it into a Project",
    }),
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  clash_assets_global_get: {
    title: "Read personal Global Asset",
    description: describeClashTool({
      useWhen:
        "you have a Global Asset ID and need its current resolved library state",
      effect:
        "reads one storage-neutral Global ResolvedAsset without requiring Project context",
      returns: "one personal Global ResolvedAsset",
      next: "admit it into a Project when Project-local membership is needed",
    }),
    inputSchema: { globalAssetId: z.string().trim().min(1) },
    annotations: { readOnlyHint: true },
  },
  clash_assets_global_import_file: {
    title: "Import personal Global Asset file",
    description: describeClashTool({
      useWhen:
        "a local media file should become reusable outside any one Project",
      effect:
        "uploads the file once through the Host's canonical personal-library multipart route",
      returns: "the newly created personal Global ResolvedAsset",
      next: "admit the returned Global Asset into a Project when needed",
    }),
    inputSchema: {
      cwd: scope.cwd,
      filePath: z
        .string()
        .trim()
        .min(1)
        .describe("Absolute path or path relative to cwd"),
      kind: z
        .enum(["image", "video", "audio", "model"])
        .optional()
        .describe(
          "Optional media kind; when omitted it is inferred from the file extension",
        ),
    },
  },
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

function assetContentSummary(name: AssetMcpToolName, value: unknown): string {
  if (name === "clash_assets_list" || name === "clash_assets_global_list") {
    const count = Array.isArray(value) ? value.length : 0;
    const scope =
      name === "clash_assets_global_list" ? "Global Asset" : "Project Asset";
    return `Found ${count} ${scope}${count === 1 ? "" : "s"}.`;
  }
  if (name === "clash_assets_references") {
    const references = (value as { references?: unknown[] } | undefined)
      ?.references;
    const count = Array.isArray(references) ? references.length : 0;
    return `Found ${count} Project Asset reference${count === 1 ? "" : "s"}.`;
  }
  const id = (value as { id?: unknown } | undefined)?.id;
  return typeof id === "string"
    ? `${name.replace("clash_assets_", "")} ${id}.`
    : JSON.stringify(value);
}

function assetErrorResult(
  name: AssetMcpToolName,
  input: AssetToolInput,
  error: unknown,
) {
  const errorBody =
    error && typeof error === "object" && "body" in error
      ? (error as { body?: unknown }).body
      : undefined;
  const body =
    errorBody && typeof errorBody === "object" && !Array.isArray(errorBody)
      ? (errorBody as Record<string, unknown>)
      : undefined;
  const message =
    typeof body?.error === "string"
      ? body.error
      : error instanceof Error
        ? error.message
        : String(error);
  const code =
    typeof body?.code === "string"
      ? body.code
      : (/^([A-Z][A-Z0-9_]+):/.exec(message)?.[1] ??
        (message.startsWith("READ_REQUIRED")
          ? "READ_REQUIRED"
          : "PROJECT_ASSET_OPERATION_FAILED"));
  const retryTool =
    ["READ_REQUIRED", "STALE_READ", "INVALID_READ_PROOF"].includes(code) &&
    input.assetId?.trim()
      ? {
          name: "clash_assets_get",
          arguments: {
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.projectId ? { projectId: input.projectId } : {}),
            assetId: input.assetId.trim(),
          },
        }
      : undefined;
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: {
      error: {
        code,
        message,
        operation: name,
        ...(body?.projectAssetId
          ? { projectAssetId: body.projectAssetId }
          : {}),
        ...(body?.references ? { references: body.references } : {}),
        ...(retryTool ? { retryTool } : {}),
      },
    },
    isError: true,
  };
}

export function registerClashAssetMcp(
  server: Pick<McpServer, "registerTool">,
  gateway: AssetProjectHostGateway,
): void {
  for (const name of ASSET_MCP_TOOL_NAMES) {
    const definition = assetToolDefinitions[name];
    registerAppTool(
      server,
      name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema,
        annotations: definition.annotations,
        _meta: {
          ...(definition.metadata ?? {}),
          ui: { visibility: ["model"] },
        },
      },
      async (input) => {
        try {
          const value = await gateway.invoke(name, input as AssetToolInput);
          const structuredContent = Array.isArray(value)
            ? { items: value }
            : (value as Record<string, unknown>);
          return {
            content: [
              { type: "text" as const, text: assetContentSummary(name, value) },
            ],
            structuredContent,
          };
        } catch (error) {
          return assetErrorResult(name, input as AssetToolInput, error);
        }
      },
    );
  }
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
    assetClient?: ProjectAssetHostClient;
    globalAssetClient?: PersonalGlobalAssetHostClient;
    assetGateway?: AssetProjectHostGateway;
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
  registerClashAssetMcp(
    server,
    options.assetGateway ??
      createAssetProjectHostGateway(
        options.assetClient ??
          createProjectAssetHostClient({
            ...(options.client ? { hostClient: options.client } : {}),
          }),
        options.globalAssetClient ??
          createPersonalGlobalAssetHostClient({
            ...(options.client ? { hostClient: options.client } : {}),
          }),
      ),
  );
  registerClashCanvasMcp(
    server,
    options.gateway ??
      createCanvasProjectHostGateway(
        options.client ?? createProjectHostClient(),
      ),
    bundledAppJavascript,
    bundledStudioAppJavascript,
    { appSurfaces: options.appSurfaces },
  );
  return server;
}
