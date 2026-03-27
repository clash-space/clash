import { z } from "zod";
import { tool } from "ai";
import type { LoroDoc } from "loro-crdt";
import type { BroadcastFn } from "../backends/canvas";
import * as canvasBackend from "../backends/canvas";
import {
  NodeType,
  ALL_NODE_TYPES,
  CONTENT_NODE_TYPES,
  GENERATION_NODE_TYPES,
  Status,
  isGenerationNode,
  ACTION_TYPE,
} from "../../domain/canvas";
import { MODEL_CARDS, buildPendingAssetNode } from "@clash/shared-types";

/**
 * Create canvas tools that operate on the Loro CRDT document.
 */
export function createCanvasTools(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  sendMessage: (msg: Record<string, unknown>) => void,
  generateId: () => string,
  getWorkspaceGroupId: () => string | undefined
) {
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
        const nodes = canvasBackend.listNodes(doc);
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
    description: "Read a specific node's detailed data.",
    inputSchema: z.object({
      node_id: z.string().describe("Target node ID"),
    }),
    execute: async (args) => {
      const { node_id } = args;
      try {
        const node = canvasBackend.readNode(doc, node_id);
        if (!node) return `Node ${node_id} not found.`;
        const data = node.data || {};
        const name = (data.label as string) || (data.name as string) || node.id;
        const description = (data.description as string) || (data.content as string) || "";
        return description ? `${name}: ${description} type: ${node.type}` : name;
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

        const result = canvasBackend.createNode(doc, broadcast, nodeId, node_type, data, position, resolvedParent);
        if (result.error) return `Error: ${result.error}`;
        return `Created node ${result.node_id}`;
      } catch (e) {
        return `Error creating node: ${e}`;
      }
    },
  });

  const createGenerationNode = tool({
    description: "Create a new image or video generation node on the canvas. Pass the generation prompt directly. Returns nodeId and assetId.",
    inputSchema: z.object({
      node_type: z.enum(GENERATION_NODE_TYPES).describe("Generation node type: image_gen or video_gen"),
      label: z.string().describe("Display label"),
      prompt: z.string().describe("The generation prompt — detailed description of what to generate"),
      model_name: z.string().optional().describe("Model ID from list_models (e.g. 'flux-2-pro')"),
      position: z.object({ x: z.number(), y: z.number() }).optional().describe("Canvas coordinates"),
      parent_id: z.string().optional().describe("Parent group; defaults to current workspace"),
    }),
    execute: async (args) => {
      const { node_type, label, prompt, model_name, position, parent_id } = args;
      try {
        const resolvedParent = parent_id ?? getWorkspaceGroupId() ?? null;
        const nodeId = generateId();
        const assetId = generateId();

        // Resolve model defaults from MODEL_CARDS
        const kind = node_type === NodeType.ImageGen ? "image" : "video";
        const modelCard = model_name
          ? MODEL_CARDS.find(c => c.id === model_name)
          : MODEL_CARDS.find(c => c.kind === kind);
        const modelId = modelCard?.id || model_name || "";

        const data: Record<string, unknown> = {
          label,
          content: prompt,  // ActionBadge reads data.content for the prompt
          prompt,            // Also set prompt for NodeProcessor/legacy
          actionType: node_type === NodeType.ImageGen ? "image-gen" : "video-gen",
          modelId,
          model: modelId,
          modelParams: { ...(modelCard?.defaultParams ?? {}) },
          referenceMode: modelCard?.input?.referenceMode ?? "none",
        };

        const result = canvasBackend.createNode(doc, broadcast, nodeId, node_type, data, position, resolvedParent, assetId);
        if (result.error) return `Error: ${result.error}`;
        return result.asset_id
          ? `Created generation node ${result.node_id} with assetId ${result.asset_id}`
          : `Created generation node ${result.node_id}`;
      } catch (e) {
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
          const result = canvasBackend.getNodeStatus(doc, node_id);

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
        const node = canvasBackend.readNode(doc, node_id);
        if (!node) return `Error: Node ${node_id} not found`;
        if (!isGenerationNode(node)) {
          return `Error: Node ${node_id} is not a generation node (type: ${node.type})`;
        }

        const data = node.data || {};
        // ActionBadge stores prompt in data.content, fallback to data.prompt
        const prompt = (data.content as string) || (data.prompt as string) || "";
        if (!prompt) return `Error: Node ${node_id} has no prompt. Set prompt first.`;

        const actionType = (data.actionType as string) || ACTION_TYPE.ImageGen;
        const modelId = (data.modelId as string) || (data.model as string) || "";
        const modelParams = (data.modelParams as Record<string, string | number | boolean>) || {};

        const assetNodeId = generateId();
        const pendingNode = buildPendingAssetNode({
          nodeId: assetNodeId,
          prompt,
          modelId,
          modelParams,
          actionType: actionType as typeof ACTION_TYPE.ImageGen | typeof ACTION_TYPE.VideoGen,
          label: data.label as string | undefined,
          referenceImageUrls: data.referenceImageUrls as string[] | undefined,
          referenceMode: (data.referenceMode as string) || undefined,
        });

        // Insert the pending asset node into Loro
        canvasBackend.insertNode(
          doc, broadcast, pendingNode.id, pendingNode.type,
          pendingNode.data, node.parent_id ?? null, { x: 0, y: 0 }
        );

        // Add edge from action-badge to the pending asset node
        const edgeId = `${node_id}-${assetNodeId}`;
        canvasBackend.insertEdge(doc, broadcast, edgeId, node_id, assetNodeId, "default");

        return `Started generation: created pending ${pendingNode.type} node ${pendingNode.id}`;
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
        const node = canvasBackend.readNode(doc, node_id);
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
        const nodes = canvasBackend.searchNodes(doc, query, node_types);
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
      "List available model cards for image, video, or audio generation. " +
      "Use this first to choose a model and its parameters before creating generation nodes.",
    inputSchema: z.object({
      kind: z
        .enum(["image", "video", "audio", "image_gen", "video_gen", "audio_gen"])
        .optional()
        .describe(
          "Optional asset kind to filter models. Accepts image/video/audio or image_gen/video_gen/audio_gen."
        ),
    }),
    execute: async (args) => {
      const normalizedKind = args.kind?.replace("_gen", "") as
        | "image"
        | "video"
        | "audio"
        | undefined;
      const cards = normalizedKind
        ? MODEL_CARDS.filter((c) => c.kind === normalizedKind)
        : MODEL_CARDS;
      return cards;
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
  };
}
