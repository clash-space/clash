import { Command } from "commander";
import WebSocket from "ws";
import {
  LoroSyncClient, Canvas,
} from "@clash/shared-types";
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
      const canvas = new Canvas(client.doc, () => {});  // broadcast via subscribeLocalUpdates
      const result = canvas.executeGeneration(
        options.node,
        () => crypto.randomUUID().slice(0, 8),
      );

      if (result.error) {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }

      if (isJsonMode(options)) {
        printJson({
          executed: true,
          badge_node_id: options.node,
          asset_node_id: result.assetNodeId,
          type: result.assetNodeType,
          status: "pending",
        });
      } else {
        console.log(`Executed action-badge: ${options.node}`);
        console.log(`Created pending asset: ${result.assetNodeId} (${result.assetNodeType})`);
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
