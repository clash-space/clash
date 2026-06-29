import { z } from "zod";
import { tool } from "ai";
import type { LoroDoc } from "loro-crdt";
import type { BroadcastFn } from "@clash/shared-types";
import { Canvas, MODEL_CARDS } from "@clash/shared-types";
import {
  NodeType,
  ALL_NODE_TYPES,
  CONTENT_NODE_TYPES,
  GENERATION_NODE_TYPES,
  Status,
  isGenerationNode,
} from "../../domain/canvas";
import type { Env } from "../../config";
import type { GenerationParams } from "../generation";
import { startGeneration } from "../../generation/start";
import { getAssetById } from "../../services/assets";
import { log } from "../../logger";

/**
 * Phase 0 attribution: the supervisor knows which actor is acting and
 * threads it into every canvas tool call so the nodes it creates carry
 * `data.actorType` / `data.actorUserId` / `data.actorAgentId`. For the
 * built-in in-API supervisor this is `{ actorType: 'user', actorUserId }`;
 * for ACP agent sessions (Test Director / Generator / …) the room WS layer
 * supplies `{ actorType: 'agent', actorUserId: owner_id, actorAgentId: cm_id }`.
 *
 * Optional only because tests / call sites pre-Phase-0 don't have it yet;
 * any tool that creates a generation node falls back to {actorType:'user',
 * actorUserId:''} when missing, which NodeProcessor will then reject —
 * surfacing the bug at the point of creation instead of swallowing it.
 */
export interface CanvasToolActor {
  actorType: "user" | "agent";
  actorUserId: string;
  actorAgentId?: string;
}

/**
 * Create canvas tools that operate on the Loro CRDT document.
 */
export function createCanvasTools(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  sendMessage: (msg: Record<string, unknown>) => void,
  generateId: () => string,
  getWorkspaceGroupId: () => string | undefined,
  env?: Env,
  projectId?: string,
  /**
   * Optional: re-establish the supervisor's WS to ProjectRoom if it's
   * dropped. Only wait_for_generation needs this — long polling against the
   * supervisor's local doc replica goes stale when the room WS dies, since
   * incremental updates from ProjectRoom (= "the workflow finished") never
   * arrive. Calling ensureRoomFresh before each poll forces re-snapshot.
   */
  ensureRoomFresh?: () => Promise<void>,
  actor?: CanvasToolActor,
) {
  const canvas = new Canvas(doc, broadcast);

  // Stamp attribution onto a `data` object. No-op when actor isn't
  // supplied (tests, pre-Phase-0 call sites) — downstream NodeProcessor
  // will refuse to dispatch and surface the missing-actor failure.
  const stampActor = (data: Record<string, unknown>): Record<string, unknown> => {
    if (!actor) return data;
    data.actorType = actor.actorType;
    data.actorUserId = actor.actorUserId;
    if (actor.actorAgentId) data.actorAgentId = actor.actorAgentId;
    return data;
  };

  const listCanvasNodes = tool({
    description: "List nodes on the canvas, optionally filtered by type or parent group. Returns a tree view.",
    inputSchema: z.object({
      node_type: z
        .enum(ALL_NODE_TYPES)
        .optional()
        .describe("Optional filter by node type"),
      parent_id: z.string().optional().describe("Optional filter by parent group"),
    }),
    execute: async (args) => {
      const node_type = args.node_type || undefined;
      const parent_id = args.parent_id || undefined;
      try {
        const nodes = canvas.listNodes();
        if (!nodes.length) return "No nodes found.";

        const children = new Map<string | null, typeof nodes>();
        for (const node of nodes) {
          const key = node.parent_id ?? null;
          if (!children.has(key)) children.set(key, []);
          children.get(key)!.push(node);
        }

        function displayLabel(node: (typeof nodes)[0]): string {
          const data = node.data || {};
          const name = (data.label as string) || (data.name as string) || "";
          const description = (data.description as string) || "";
          let base = `${node.id} (${node.type})`;
          if (name) base = `${base}: ${name}`;
          if (description) base = `${base} - ${description}`;
          if (node.type === NodeType.Group) base = `${base}/`;
          return base;
        }

        function renderTree(currentParent: string | null, indent = ""): [string[], boolean] {
          const lines: string[] = [];
          let hasMatch = false;
          const kids = (children.get(currentParent) || []).sort((a, b) => {
            const aG = a.type === NodeType.Group ? 0 : 1;
            const bG = b.type === NodeType.Group ? 0 : 1;
            return aG - bG || a.id.localeCompare(b.id);
          });

          for (const child of kids) {
            const childMatches = !node_type || child.type === node_type;
            if (child.type === NodeType.Group) {
              const [childLines, subtreeMatch] = renderTree(child.id, indent + "  ");
              if (childMatches || subtreeMatch) {
                lines.push(`${indent}- ${displayLabel(child)}`);
                lines.push(...childLines);
                hasMatch = true;
              }
            } else if (childMatches) {
              lines.push(`${indent}- ${displayLabel(child)}`);
              hasMatch = true;
            }
          }
          return [lines, hasMatch];
        }

        const [treeLines, hasAny] = renderTree(parent_id ?? null);
        if (!hasAny) return "No nodes found.";
        return ["Canvas nodes (tree):", ...treeLines].join("\n");
      } catch (e) {
        return `Error listing nodes: ${e}`;
      }
    },
  });

  const readCanvasNode = tool({
    description: "Read a specific node's detailed data. For image/video/audio nodes, returns the actual media content so you can see/hear it.",
    inputSchema: z.object({
      node_id: z.string().describe("Target node ID"),
    }),
    execute: async (args) => {
      const { node_id } = args;
      try {
        const node = canvas.readNode(node_id);
        if (!node) return `Node ${node_id} not found.`;
        const data = node.data || {};
        const name = (data.label as string) || (data.name as string) || node.id;
        const description = (data.description as string) || "";
        const content = (data.content as string) || "";
        const understanding = (data.understanding as string) || "";
        const assetId = typeof data.assetId === 'string' ? data.assetId : undefined;
        // Resolve src R2 key via the D1 asset row — node.data.src is no
        // longer maintained (was a stale legacy mirror).
        const src = assetId && env?.DB ? (await getAssetById(env.DB, assetId).catch(() => null))?.srcR2Key : undefined;
        const isImage = node.type === "image";

        const lines: string[] = [`Node ${node_id} (${node.type}): ${name}`];
        if (description) lines.push(`Description: ${description}`);
        if (content) lines.push(`Content: ${content}`);
        if (understanding) lines.push(`Visual understanding: ${understanding}`);
        if (src) lines.push(`Storage key: ${src}`);

        // For image nodes, fetch binary and embed a marker containing the data URI.
        // supervisor.ts prepareStep strips the marker and injects a follow-up user message
        // with the image as image_url content. This is the only way OpenAI Chat Completions
        // can surface tool-returned images to the model (tool-role message content is text-only).
        if (isImage && src && env?.R2_BUCKET) {
          try {
            const obj = await env.R2_BUCKET.get(src);
            if (obj) {
              const ct = obj.httpMetadata?.contentType || "image/png";
              const buf = await obj.arrayBuffer();
              const bytes = new Uint8Array(buf);
              const CHUNK = 8192;
              const chunks: string[] = [];
              for (let i = 0; i < bytes.length; i += CHUNK) {
                chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
              }
              const b64 = btoa(chunks.join(""));
              lines.push(`[[CANVAS_IMAGE:${ct}:${b64}]]`);
            }
          } catch (e) {
            log.warn("read_canvas_node: failed to read R2 object", { src, error: String(e) });
          }
        }
        return lines.join("\n");
      } catch (e) {
        return `Error reading node: ${e}`;
      }
    },
  });

  const createCanvasNode = tool({
    description: "Create a new text or group node on the canvas.",
    inputSchema: z.object({
      node_type: z.enum(CONTENT_NODE_TYPES).describe("Node type to create"),
      label: z.string().describe("Display label for the node"),
      content: z.string().optional().describe("Markdown/text content"),
      description: z.string().optional().describe("Optional description"),
      position: z.object({ x: z.number(), y: z.number() }).optional().describe("Canvas coordinates"),
      parent_id: z.string().optional().describe("Parent group; defaults to current workspace"),
    }),
    execute: async (args) => {
      const { node_type, label, content, description, position, parent_id } = args;
      try {
        const resolvedParent = parent_id ?? getWorkspaceGroupId() ?? null;
        const nodeId = generateId();
        const data: Record<string, unknown> = { label };
        if (content) data.content = content;
        if (description) data.description = description;
        stampActor(data);

        const result = canvas.createNode(nodeId, node_type, data, position, resolvedParent);
        if (result.error) return `Error: ${result.error}`;
        return `Created node ${result.node_id}`;
      } catch (e) {
        return `Error creating node: ${e}`;
      }
    },
  });

  const createGenerationNode = tool({
    description: "Create a new image, video, audio, or text generation node on the canvas. Pass the generation prompt directly. Returns nodeId and assetId.",
    inputSchema: z.object({
      node_type: z.enum(GENERATION_NODE_TYPES).describe("Generation node type: image_gen, video_gen, audio_gen, or text_gen"),
      label: z.string().describe("Display label"),
      prompt: z.string().describe("The generation prompt — detailed description of what to generate"),
      model_name: z.string().optional().describe("Model ID from list_models (e.g. 'flux-2-pro')"),
      position: z.object({ x: z.number(), y: z.number() }).optional().describe("Canvas coordinates"),
      parent_id: z.string().optional().describe("Parent group; defaults to current workspace"),
    }),
    execute: async (args) => {
      const { node_type, label, prompt, model_name, position, parent_id } = args;
      log.info("create_generation_node called", { node_type, label, prompt: prompt?.slice(0, 50), model_name });
      try {
        const resolvedParent = parent_id ?? getWorkspaceGroupId() ?? null;
        const nodeId = generateId();
        const assetId = generateId();

        // Resolve model defaults from MODEL_CARDS
        const kind =
          node_type === NodeType.ImageGen
            ? "image"
            : node_type === NodeType.VideoGen
              ? "video"
              : node_type === NodeType.AudioGen
                ? "audio"
                : "text";
        const modelCard = model_name
          ? MODEL_CARDS.find(c => c.id === model_name)
          : MODEL_CARDS.find(c => c.kind === kind);
        const modelId = modelCard?.id || model_name || "";

        log.info("create_generation_node creating node", { nodeId, assetId, modelId, resolvedParent });

        const data: Record<string, unknown> = {
          label,
          content: prompt,  // ActionBadge reads data.content for the prompt
          prompt,            // Also set prompt for NodeProcessor/legacy
          actionType:
            node_type === NodeType.ImageGen
              ? "image-gen"
              : node_type === NodeType.VideoGen
                ? "video-gen"
                : node_type === NodeType.AudioGen
                  ? "audio-gen"
                  : "text-gen",
          modelId,
          model: modelId,
          modelParams: { ...(modelCard?.defaultParams ?? {}) },
        };
        stampActor(data);

        const result = canvas.createNode(nodeId, node_type, data, position, resolvedParent, assetId);
        log.info("create_generation_node result", { node_id: result.node_id, asset_id: result.asset_id, error: result.error });
        if (result.error) return `Error: ${result.error}`;
        const response = result.asset_id
          ? `Created generation node ${result.node_id} with assetId ${result.asset_id}`
          : `Created generation node ${result.node_id}`;
        log.info("create_generation_node returning", { response });
        return response;
      } catch (e) {
        log.error("create_generation_node error", e);
        return `Error creating generation node: ${e}`;
      }
    },
  });

  const waitForGeneration = tool({
    description: "Wait for a generated asset node to be ready.",
    inputSchema: z.object({
      node_id: z.string().describe("ID of generated asset node or assetId"),
      timeout_seconds: z.number().describe("Max wait time in seconds"),
    }),
    execute: async (args) => {
      const { node_id, timeout_seconds } = args;
      const POLL_INTERVAL_MS = 3_000;
      try {
        const deadline = Date.now() + timeout_seconds * 1000;

        while (Date.now() < deadline) {
          // Re-sync our local doc with ProjectRoom before reading status.
          // If the room WS dropped while we were polling (common when
          // ProjectRoom hibernates/crashes), the workflow's "completed" /
          // "failed" update is broadcast to live browser clients but not
          // to a disconnected supervisor — and our local doc would
          // forever say pending. ensureRoomFresh is best-effort; failures
          // are logged but don't break the poll loop.
          if (ensureRoomFresh) {
            try { await ensureRoomFresh(); } catch (e) {
              log.warn("wait_for_generation ensureRoomFresh failed:", e);
            }
          }

          const result = canvas.getNodeStatus(node_id);

          if (result.status === Status.NodeNotFound) return `Node not found: ${node_id}`;
          if (result.status === Status.Completed) return "Task completed.";
          if (result.status === Status.Failed) return `Task failed: ${result.error}`;

          const remaining = deadline - Date.now();
          if (remaining <= 0) break;
          await new Promise((r) => setTimeout(r, Math.min(POLL_INTERVAL_MS, remaining)));
        }

        return "Task still generating. Please retry wait_for_generation after a moment.";
      } catch (e) {
        return `Error waiting for task: ${e}`;
      }
    },
  });

  const runGenerationNode = tool({
    description: "Start generation for an action-badge node. Creates a pending image/video asset node linked to the source. Must be called after create_generation_node.",
    inputSchema: z.object({
      node_id: z.string().describe("The action-badge generation node ID"),
    }),
    execute: async (args) => {
      const { node_id } = args;
      try {
        const result = canvas.executeGeneration(node_id, generateId);
        if (result.error) return `Error: ${result.error}`;
        return `Started generation: created pending ${result.assetNodeType} node ${result.assetNodeId}`;
      } catch (e) {
        return `Error starting generation: ${e}`;
      }
    },
  });

  const rerunGenerationNode = tool({
    description: "Rerun a generation node to regenerate the asset with a new assetId.",
    inputSchema: z.object({
      node_id: z.string().describe("Generation node ID to rerun"),
    }),
    execute: async (args) => {
      const { node_id } = args;
      try {
        const node = canvas.readNode(node_id);
        if (!node) return `Error: Node ${node_id} not found`;
        if (!isGenerationNode(node)) {
          return `Error: Node ${node_id} is not a generation node (type: ${node.type})`;
        }
        const newAssetId = generateId();
        sendMessage({ type: "rerun_generation", nodeId: node_id, assetId: newAssetId, nodeData: node.data });
        return `Triggered regeneration for node ${node_id} with new assetId: ${newAssetId}`;
      } catch (e) {
        return `Error rerunning generation node: ${e}`;
      }
    },
  });

  const searchCanvas = tool({
    description: "Search nodes by content or metadata.",
    inputSchema: z.object({
      query: z.string().describe("Search query"),
      node_types: z.array(z.string()).optional().describe("Filter by node types"),
    }),
    execute: async (args) => {
      const { query, node_types } = args;
      try {
        const nodes = canvas.searchNodes(query, node_types);
        if (!nodes.length) return `No nodes found matching '${query}'.`;
        const lines = [`Search results for '${query}':`];
        for (const node of nodes) {
          lines.push(`- ${node.id} (${node.type}): ${JSON.stringify(node.data)}`);
        }
        return lines.join("\n");
      } catch (e) {
        return `Error searching: ${e}`;
      }
    },
  });

  const listModels = tool({
    description:
      "List available model cards for image, video, audio, or text generation. " +
      "Use this first to choose a model and its parameters before creating generation nodes.",
    inputSchema: z.object({
      kind: z
        .enum(["image", "video", "audio", "text", "image_gen", "video_gen", "audio_gen", "text_gen"])
        .optional()
        .describe(
          "Optional asset kind to filter models. Accepts image/video/audio/text or image_gen/video_gen/audio_gen/text_gen."
        ),
    }),
    execute: async (args) => {
      const normalizedKind = args.kind?.replace("_gen", "") as
        | "image"
        | "video"
        | "audio"
        | "text"
        | undefined;
      const cards = normalizedKind
        ? MODEL_CARDS.filter((c) => c.kind === normalizedKind)
        : MODEL_CARDS;
      return cards;
    },
  });

  const understandAsset = tool({
    description:
      "Run comprehensive understanding on an image, video, or audio asset node. " +
      "Performs ASR transcription (audio/video) and visual analysis (image/video). " +
      "Results are stored in the node's understanding field.",
    inputSchema: z.object({
      node_id: z.string().describe("Target asset node ID (image, video, or audio)"),
      language: z.string().optional().describe("Language hint for ASR (e.g. 'zh', 'en')"),
    }),
    execute: async (args) => {
      const { node_id, language } = args;
      if (!env || !projectId) return "Error: understand_asset requires env and projectId";
      try {
        const node = canvas.readNode(node_id);
        if (!node) return `Error: Node ${node_id} not found`;

        const assetId = typeof node.data.assetId === 'string' ? node.data.assetId : undefined;
        if (!assetId || !env?.DB) return `Error: Node ${node_id} has no asset attached`;
        const asset = await getAssetById(env.DB, assetId).catch(() => null);
        const src = asset?.srcR2Key;
        if (!src) return `Error: Node ${node_id} asset ${assetId} not found in D1`;

        const nodeType = node.type;
        let mimeType = "image/png";
        if (nodeType === "video") mimeType = "video/mp4";
        else if (nodeType === "audio") mimeType = "audio/mp3";

        const taskId = generateId();

        const genParams: GenerationParams = {
          taskId,
          nodeId: node_id,
          type: "understand",
          projectId,
          r2Key: src,
          mimeType,
          language,
          // Attribution flows from the agent runtime calling this tool.
          // No actor → degenerate to "" (the workflow uses it for the
          // asset row owner; createAsset throws on "" so this fails fast).
          actorType: actor?.actorType ?? "user",
          actorUserId: actor?.actorUserId ?? "",
          actorAgentId: actor?.actorAgentId,
        };

        await startGeneration(env, taskId, genParams);
        return `Understanding task submitted for node ${node_id} (taskId: ${taskId}). Results will appear in node.data.understanding.`;
      } catch (e) {
        return `Error: ${e}`;
      }
    },
  });

  const listCustomActions = tool({
    description:
      "List custom marketplace actions installed in this project (e.g. grid-split, upscale). Each entry shows its id, name, description, output type, declared input modalities, and parameters. Use this BEFORE create_custom_action_node — the agent doesn't know which actions are available a priori.",
    inputSchema: z.object({}),
    execute: async () => {
      try {
        const actionsMap = doc.getMap("customActions");
        const entries: Array<Record<string, unknown>> = [];
        for (const [, raw] of actionsMap.entries()) {
          if (!raw || typeof raw !== "object") continue;
          entries.push(raw as Record<string, unknown>);
        }
        if (entries.length === 0) {
          return "No custom actions are registered in this project. The user needs to run a local agent (e.g. `python examples/grid_split.py`) that calls register_custom_actions before any can be used.";
        }
        return JSON.stringify(
          entries.map((a) => ({
            id: a.id,
            name: a.name,
            description: a.description,
            outputType: a.outputType,
            promptModalities: a.promptModalities ?? ["text"],
            parameters: a.parameters ?? [],
            runtime: a.runtime ?? "local",
          })),
          null,
          2,
        );
      } catch (e) {
        return `Error listing custom actions: ${e}`;
      }
    },
  });

  const createCustomActionNode = tool({
    description:
      "Create an action-badge that runs a custom marketplace action (one of the ids from list_custom_actions). The action-badge is the input node; after creation call run_generation_node to spawn its pending child + dispatch the task to the registered agent. Reference assets (e.g. a source image for grid-split) MUST be passed via `reference_ids` — those become canvas edges that the executor reads as inputs.",
    inputSchema: z.object({
      action_id: z
        .string()
        .describe("The custom action id (e.g. 'grid-split'). Must be one of the ids returned by list_custom_actions."),
      label: z.string().describe("Display label shown above the action-badge"),
      prompt: z
        .string()
        .describe(
          "Free-text prompt. Required by the current validation gate even when the action ignores text (the agent should pass a short descriptive string). For prompt-driven actions, write the actual instruction here.",
        ),
      reference_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Canvas node ids of upstream image/video/audio assets to wire as inputs. Each becomes an incoming edge to the new action-badge. Required for actions whose promptModalities include 'image'/'video'/'audio'.",
        ),
      params: z
        .record(z.union([z.string(), z.number(), z.boolean()]))
        .optional()
        .describe(
          "Custom action parameters (data.customActionParams). Schema is per-action — read it from list_custom_actions.parameters before populating.",
        ),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      parent_id: z.string().optional(),
    }),
    execute: async (args) => {
      const { action_id, label, prompt, reference_ids, params, position, parent_id } = args;
      try {
        // Look up the custom action definition so we know its outputType.
        const def = canvas.getCustomAction(action_id);
        if (!def) {
          return `Error: custom action '${action_id}' is not registered. Run list_custom_actions to see what's available.`;
        }
        const resolvedParent = parent_id ?? getWorkspaceGroupId() ?? null;
        const nodeId = generateId();
        const assetId = generateId();

        const data: Record<string, unknown> = {
          label,
          content: prompt,
          prompt,
          actionType: `custom:${action_id}`,
          customActionId: action_id,
          customActionParams: params ?? {},
          outputType: def.outputType,
        };
        stampActor(data);

        // ActionBadge reads refs from incoming edges (matching the web
        // UI). referenceImageOrder is what the prompt-editor chips use
        // for stable positional rendering.
        const refs = (reference_ids ?? []).filter((id) => !!id);
        if (refs.length > 0) data.referenceImageOrder = refs;

        // Map image_gen -> the right node type based on the action's
        // declared outputType. Custom actions can output any modality.
        const nodeType =
          def.outputType === "video"
            ? NodeType.VideoGen
            : def.outputType === "audio"
              ? NodeType.AudioGen
              : def.outputType === "text"
                ? NodeType.TextGen
                : NodeType.ImageGen;

        const result = canvas.createNode(nodeId, nodeType, data, position, resolvedParent, assetId);
        if (result.error) return `Error: ${result.error}`;

        // Wire each ref as an incoming edge to the new badge.
        for (const sourceNodeId of refs) {
          if (!canvas.readNode(sourceNodeId)) continue;
          canvas.insertEdge(`${sourceNodeId}-${nodeId}`, sourceNodeId, nodeId, "default");
        }

        return `Created custom action node ${result.node_id} (action=${action_id}, refs=${refs.length}). Call run_generation_node next to dispatch.`;
      } catch (e) {
        log.error("create_custom_action_node error", e);
        return `Error creating custom action node: ${e}`;
      }
    },
  });

  return {
    list_canvas_nodes: listCanvasNodes,
    read_canvas_node: readCanvasNode,
    create_canvas_node: createCanvasNode,
    create_generation_node: createGenerationNode,
    run_generation_node: runGenerationNode,
    wait_for_generation: waitForGeneration,
    rerun_generation_node: rerunGenerationNode,
    search_canvas: searchCanvas,
    list_models: listModels,
    list_custom_actions: listCustomActions,
    create_custom_action_node: createCustomActionNode,
    understand_asset: understandAsset,
  };
}
