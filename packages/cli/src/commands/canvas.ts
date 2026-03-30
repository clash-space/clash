import { Command } from "commander";
import WebSocket from "ws";
import {
  LoroSyncClient, buildPendingAssetNode,
  ACTION_TYPE, MODEL_CARDS, resolveAspectRatio,
  insertNode, insertEdge, listNodes, listEdges,
} from "@clash/shared-types";
import type { NodeInfo } from "@clash/shared-types";
import { autoInsertNode, NEEDS_LAYOUT_POSITION } from "@clash/shared-layout";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";

/**
 * Create a connected LoroSyncClient for the given project.
 */
async function connectToProject(projectId: string): Promise<LoroSyncClient> {
  const apiKey = requireApiKey();
  const serverUrl = getServerUrl();
  const wsUrl = serverUrl.replace(/^http/, "ws");

  const client = new LoroSyncClient({
    serverUrl: wsUrl,
    projectId,
    token: apiKey,
    clientType: "cli",
    WebSocket: WebSocket as any,
  });

  await client.connect();
  return client;
}

export const canvasCommand = new Command("canvas")
  .description("Canvas node operations (via Loro CRDT sync)");

// ─── list ─────────────────────────────────────────────────

canvasCommand
  .command("list")
  .description("List canvas nodes")
  .requiredOption("--project <id>", "Project ID")
  .option("--type <type>", "Filter by node type")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      const nodes = client.listNodes(options.type);
      if (isJsonMode(options)) {
        printJson(nodes);
      } else if (nodes.length === 0) {
        console.log("No nodes found.");
      } else {
        for (const node of nodes) {
          const label = (node.data.label as string) || "";
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${label}`);
        }
        console.log(`\n${nodes.length} node(s)`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── get ──────────────────────────────────────────────────

canvasCommand
  .command("get")
  .description("Get a specific node")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      const node = client.readNode(options.node);
      if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      if (isJsonMode(options)) {
        printJson(node);
      } else {
        console.log(`ID:       ${node.id}`);
        console.log(`Type:     ${node.type}`);
        console.log(`Label:    ${(node.data.label as string) || "(none)"}`);
        console.log(`Status:   ${(node.data.status as string) || "(none)"}`);
        console.log(`Position: (${node.position.x}, ${node.position.y})`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── add ──────────────────────────────────────────────────

canvasCommand
  .command("add")
  .description("Add a text, group, or action-badge node")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--type <type>", "Node type: text, group, image_gen, video_gen")
  .requiredOption("--label <label>", "Node label")
  .option("--content <content>", "Text/prompt content")
  .option("--parent <id>", "Parent group ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      const nodeId = crypto.randomUUID().slice(0, 8);
      const data: Record<string, unknown> = { label: options.label };
      if (options.content) { data.content = options.content; data.prompt = options.content; }

      const result = client.createNode(nodeId, options.type, data, null, options.parent ?? null);
      if (isJsonMode(options)) {
        printJson(result);
      } else {
        console.log(`Created node: ${result.node_id} (${options.type})`);
        if (result.asset_id) console.log(`Asset ID:    ${result.asset_id}`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── execute ──────────────────────────────────────────────
// Mirrors ActionBadge's handleExecute: validates the action-badge node,
// resolves prompt, creates a pending image/video asset node + edge,
// then NodeProcessor detects and submits the generation task.

canvasCommand
  .command("execute")
  .description("Execute an action-badge node to trigger generation (same as clicking Execute in UI)")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "ActionBadge node ID to execute")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      // 1. Read and validate the ActionBadge node
      const badge = client.readNode(options.node);
      if (!badge) {
        console.error(`Error: Node not found: ${options.node}`);
        process.exit(1);
      }
      if (badge.type !== "action-badge") {
        console.error(`Error: Node ${options.node} is type '${badge.type}', not 'action-badge'. Only action-badge nodes can be executed.`);
        process.exit(1);
      }

      const actionType = badge.data.actionType as string;
      if (actionType !== ACTION_TYPE.ImageGen && actionType !== ACTION_TYPE.VideoGen) {
        console.error(`Error: Node ${options.node} has unknown actionType '${actionType}'.`);
        process.exit(1);
      }

      // 2. Resolve prompt (same priority as ActionBadge UI)
      let prompt = (badge.data.content as string) || "";

      // Fallback: check connected prompt/text nodes via edges
      if (!prompt) {
        const allNodes = client.listNodes();
        const allEdges = listEdges(client.doc);
        const incomingEdges = allEdges.filter((e) => e.target === options.node);
        for (const edge of incomingEdges) {
          const source = allNodes.find((n) => n.id === edge.source);
          if (source && (source.type === "text" || source.type === "prompt") && source.data.content) {
            prompt = source.data.content as string;
            break;
          }
        }
      }

      // Fallback: data.prompt (legacy)
      if (!prompt) {
        prompt = (badge.data.prompt as string) || "";
      }

      if (!prompt.trim()) {
        console.error("Error: No prompt found. Edit the node content or connect a text/prompt node first.");
        process.exit(1);
      }

      // 3. Resolve model (fallback to default if badge doesn't specify)
      const isVideo = actionType === ACTION_TYPE.VideoGen;
      const kind = isVideo ? "video" : "image";
      let modelId = (badge.data.modelId as string) || (badge.data.model as string) || "";
      if (!modelId) {
        const defaultCard = MODEL_CARDS.find((c: any) => c.kind === kind);
        modelId = defaultCard?.id || "";
      }
      const modelCard = modelId ? MODEL_CARDS.find((c: any) => c.id === modelId) : null;
      const modelParams = (badge.data.modelParams as Record<string, any>) || { ...(modelCard?.defaultParams ?? {}) };
      const referenceMode = (badge.data.referenceMode as string) || modelCard?.input?.referenceMode || "none";

      // 4. Validate reference image requirement
      if (actionType === ACTION_TYPE.VideoGen || actionType === ACTION_TYPE.ImageGen) {
        const refRequired = modelCard?.input?.referenceImage === "required";
        if (refRequired) {
          const allNodes = client.listNodes();
          const allEdges = listEdges(client.doc);
          const incomingEdges = allEdges.filter((e) => e.target === options.node);
          const imageNodes = incomingEdges
            .map((e) => allNodes.find((n) => n.id === e.source))
            .filter((n): n is NodeInfo => !!n && n.type === "image" && !!n.data.src);

          if (imageNodes.length === 0) {
            console.error("Error: Selected model requires a reference image. Connect an image node first.");
            process.exit(1);
          }
        }
      }

      // 5. Build pending asset node (same as ActionBadge handleExecute)
      const assetNodeId = crypto.randomUUID().slice(0, 8);
      const pending = buildPendingAssetNode({
        nodeId: assetNodeId,
        prompt,
        modelId,
        modelParams: modelParams as Record<string, string | number | boolean>,
        actionType: actionType as typeof ACTION_TYPE.ImageGen | typeof ACTION_TYPE.VideoGen,
      });

      // Collect reference images from connected image nodes
      const allNodes = client.listNodes();
      const allEdges = listEdges(client.doc);
      const incomingEdges = allEdges.filter((e) => e.target === options.node);
      const refUrls = incomingEdges
        .map((e) => allNodes.find((n) => n.id === e.source))
        .filter((n): n is NodeInfo => !!n && n.type === "image" && !!n.data.src)
        .map((n) => n.data.src as string);

      if (refUrls.length > 0) {
        pending.data.referenceImageUrls = refUrls;
      }

      // 6. Insert pending asset node with auto-layout
      const existingLayout = listNodes(client.doc).map((n: any) => ({
        id: n.id, type: n.type, position: n.position, parentId: n.parent_id ?? undefined, data: n.data,
      }));
      const edgesLayout = listEdges(client.doc);
      const virtual = { id: assetNodeId, type: pending.type, position: NEEDS_LAYOUT_POSITION, data: pending.data };
      const layout = autoInsertNode(assetNodeId, [...existingLayout, virtual], edgesLayout);

      const noop = (_d: Uint8Array) => {};
      insertNode(client.doc, noop, assetNodeId, pending.type, pending.data, null, layout.position);

      // 7. Add edge from ActionBadge → pending asset node
      const edgeId = `${options.node}-${assetNodeId}`;
      insertEdge(client.doc, noop, edgeId, options.node, assetNodeId, "default");

      if (isJsonMode(options)) {
        printJson({
          executed: true,
          badge_node_id: options.node,
          asset_node_id: assetNodeId,
          type: pending.type,
          status: "pending",
          model: modelId,
          prompt,
        });
      } else {
        console.log(`Executed action-badge: ${options.node}`);
        console.log(`Created pending ${kind}: ${assetNodeId}`);
        console.log(`Model:  ${modelId}`);
        console.log(`Prompt: ${prompt.length > 60 ? prompt.slice(0, 57) + "..." : prompt}`);
        console.log(`NodeProcessor will auto-submit generation task.`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── update ───────────────────────────────────────────────

canvasCommand
  .command("update")
  .description("Update a node's data")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID")
  .option("--label <label>", "New label")
  .option("--content <content>", "New content")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      const updates: Record<string, unknown> = {};
      if (options.label) updates.label = options.label;
      if (options.content) updates.content = options.content;
      if (Object.keys(updates).length === 0) {
        console.error("Provide at least one field to update (--label, --content)");
        process.exit(1);
      }
      const ok = client.updateNode(options.node, updates);
      if (!ok) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      if (isJsonMode(options)) printJson({ updated: true, nodeId: options.node });
      else console.log(`Updated node: ${options.node}`);
    } finally {
      await client.disconnect();
    }
  });

// ─── delete ───────────────────────────────────────────────

canvasCommand
  .command("delete")
  .description("Delete a node")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      const ok = client.deleteNode(options.node);
      if (!ok) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      if (isJsonMode(options)) printJson({ deleted: true, nodeId: options.node });
      else console.log(`Deleted node: ${options.node}`);
    } finally {
      await client.disconnect();
    }
  });

// ─── search ───────────────────────────────────────────────

canvasCommand
  .command("search")
  .description("Search nodes by content")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--query <query>", "Search query")
  .option("--type <types>", "Comma-separated node types to filter")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const client = await connectToProject(options.project);
    try {
      const nodeTypes = options.type?.split(",") ?? null;
      const nodes = client.searchNodes(options.query, nodeTypes);
      if (isJsonMode(options)) {
        printJson(nodes);
      } else if (nodes.length === 0) {
        console.log(`No nodes matching '${options.query}'.`);
      } else {
        for (const node of nodes) {
          const label = (node.data.label as string) || "";
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${label}`);
        }
        console.log(`\n${nodes.length} result(s)`);
      }
    } finally {
      await client.disconnect();
    }
  });
