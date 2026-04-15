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
import { log } from "../../logger";

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
) {
  const canvas = new Canvas(doc, broadcast);

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

  /** Generate a full public signed URL for an R2 storage key. */
  async function makePublicSignedUrl(storageKey: string): Promise<string | null> {
    if (!env?.JWT_SECRET || !env?.WORKER_PUBLIC_URL) return null;
    try {
      const SIGNED_URL_TTL = 3600;
      const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL;
      const keyData = new TextEncoder().encode(env.JWT_SECRET);
      const cryptoKey = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sigData = new TextEncoder().encode(`${storageKey}:${exp}`);
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, sigData);
      const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/[+/=]/g, c => c === "+" ? "-" : c === "/" ? "_" : "");
      return `${env.WORKER_PUBLIC_URL}/assets/${storageKey}?exp=${exp}&sig=${sigStr}`;
    } catch {
      return null;
    }
  }

  const readCanvasNode = tool({
    description: "Read a specific node's detailed data. For image/video/audio nodes, returns the actual media content so you can see/hear it.",
    inputSchema: z.object({
      node_id: z.string().describe("Target node ID"),
    }),
    execute: async (args) => {
      const { node_id } = args;
      try {
        const node = canvas.readNode(node_id);
        if (!node) return { text: `Node ${node_id} not found.`, mediaType: null, data: null, url: null };
        const data = node.data || {};
        const name = (data.label as string) || (data.name as string) || node.id;
        const description = (data.description as string) || (data.content as string) || "";
        const src = data.src as string | undefined;
        const text = `Node ${node_id} (${node.type}): ${name}${description ? " — " + description : ""}`;

        // For media nodes with R2 storage key, return image data + URL
        if (src && env?.R2_BUCKET && ["image", "video", "audio"].includes(node.type)) {
          try {
            const [obj, publicUrl] = await Promise.all([
              env.R2_BUCKET.get(src),
              makePublicSignedUrl(src),
            ]);
            if (obj) {
              const ct = obj.httpMetadata?.contentType || "application/octet-stream";
              const buf = await obj.arrayBuffer();
              const bytes = new Uint8Array(buf);
              const CHUNK = 8192;
              const chunks: string[] = [];
              for (let i = 0; i < bytes.length; i += CHUNK) {
                chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
              }
              const b64 = btoa(chunks.join(""));
              return { text, mediaType: ct, data: b64, url: publicUrl };
            }
          } catch (e) {
            log.warn("read_canvas_node: failed to fetch R2 object", { src, error: String(e) });
          }
        }

        return { text, mediaType: null, data: null, url: null };
      } catch (e) {
        return { text: `Error reading node: ${e}`, mediaType: null, data: null, url: null };
      }
    },
    toModelOutput({ output }) {
      if (output.data && output.mediaType) {
        // Prefer URL (cheaper tokens) with base64 fallback
        const parts: any[] = [{ type: "text" as const, text: output.text }];
        if (output.url) {
          parts.push({ type: "file" as const, url: output.url, mediaType: output.mediaType });
        } else {
          parts.push({ type: "media" as const, data: output.data, mediaType: output.mediaType });
        }
        return { type: "content" as const, value: parts };
      }
      return output.text;
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

        const result = canvas.createNode(nodeId, node_type, data, position, resolvedParent);
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
      log.info("create_generation_node called", { node_type, label, prompt: prompt?.slice(0, 50), model_name });
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

        log.info("create_generation_node creating node", { nodeId, assetId, modelId, resolvedParent });

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

        const src = node.data.src as string | undefined;
        if (!src) return `Error: Node ${node_id} has no asset (src is empty)`;

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
        };

        await env.GENERATION_WORKFLOW.create({ id: taskId, params: genParams });
        return `Understanding task submitted for node ${node_id} (taskId: ${taskId}). Results will appear in node.data.understanding.`;
      } catch (e) {
        return `Error: ${e}`;
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
    understand_asset: understandAsset,
  };
}
