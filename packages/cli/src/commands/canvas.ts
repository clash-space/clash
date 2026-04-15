import { Command } from "commander";
import WebSocket from "ws";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import {
  LoroSyncClient, Canvas,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";
import { isDaemonRunning, sendCommand, startDaemon, getSocketPath } from "../lib/daemon";
import { apiFetch } from "../lib/api";

/**
 * Create a one-shot connected LoroSyncClient (fallback when no daemon).
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

/**
 * Run a command via daemon if running, otherwise fall back to one-shot connection.
 */
async function runCommand(projectId: string, cmd: object): Promise<any> {
  if (isDaemonRunning(projectId)) {
    return sendCommand(projectId, cmd);
  }
  return null; // caller should fall back
}

export const canvasCommand = new Command("canvas")
  .description(`Canvas node operations (via Loro CRDT sync)

Node types: text, group, image, video, image_gen, video_gen

Daemon mode (recommended for multi-command sessions):
  clash canvas connect --project <id>     # start persistent connection
  clash canvas list --project <id> --json # uses daemon automatically
  clash canvas disconnect --project <id>  # stop (auto-exits after 10min idle)`);

// ─── connect ─────────────────────────────────────────────

canvasCommand
  .command("connect")
  .description("Start persistent connection to a project (daemon mode)")
  .requiredOption("--project <id>", "Project ID")
  .action(async (options) => {
    if (isDaemonRunning(options.project)) {
      console.log(JSON.stringify({ status: "already_running", socket: getSocketPath(options.project) }));
      return;
    }
    const apiKey = requireApiKey();
    const serverUrl = getServerUrl();
    await startDaemon(options.project, serverUrl, apiKey);
  });

// ─── disconnect ──────────────────────────────────────────

canvasCommand
  .command("disconnect")
  .description("Stop persistent connection")
  .requiredOption("--project <id>", "Project ID")
  .action(async (options) => {
    if (!isDaemonRunning(options.project)) {
      console.log("No daemon running.");
      return;
    }
    const result = await sendCommand(options.project, { action: "disconnect" });
    console.log(JSON.stringify(result));
  });

// ─── list ─────────────────────────────────────────────────

canvasCommand
  .command("list")
  .description("List canvas nodes")
  .requiredOption("--project <id>", "Project ID")
  .option("--type <type>", "Filter by node type")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const daemonResult = await runCommand(options.project, { action: "list", type: options.type });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult.nodes); }
      else {
        for (const node of daemonResult.nodes) {
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${(node.data?.label as string) || ""}`);
        }
        console.log(`\n${daemonResult.nodes.length} node(s)`);
      }
      return;
    }

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

/** Cache dir: ~/.clash/cache/assets (cross-platform, persistent) */
const ASSET_CACHE_DIR = join(homedir(), ".clash", "cache", "assets");

/**
 * Download media asset with caching. Returns file path, or null on failure.
 * Skips download if file already exists in cache.
 */
async function downloadAsset(src: string): Promise<string | null> {
  try {
    const fileName = src.replace(/[/\\:]/g, "_");
    mkdirSync(ASSET_CACHE_DIR, { recursive: true });
    const filePath = join(ASSET_CACHE_DIR, fileName);

    // Check cache
    if (existsSync(filePath)) return filePath;

    // Get signed URL
    const signRes = await apiFetch(`/assets/sign?key=${encodeURIComponent(src)}`);
    if (!signRes.ok) return null;
    const { url: signedPath } = (await signRes.json()) as { url: string };

    // Download
    const fullUrl = `${getServerUrl()}${signedPath}`;
    const res = await fetch(fullUrl);
    if (!res.ok) return null;

    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()));
    return filePath;
  } catch {
    return null;
  }
}

function printNodeInfo(n: any) {
  console.log(`ID:       ${n.id}`);
  console.log(`Type:     ${n.type}`);
  console.log(`Label:    ${(n.data?.label as string) || "(none)"}`);
  console.log(`Status:   ${(n.data?.status as string) || "(none)"}`);
  console.log(`Position: (${n.position.x}, ${n.position.y})`);
  if (n.data?.content) console.log(`Content:  ${n.data.content}`);
  if (n.data?.description) console.log(`Desc:     ${n.data.description}`);
}

canvasCommand
  .command("get")
  .description("Get a specific node. For media nodes, downloads the asset to a temp file.")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "Node ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    let node: any = null;

    const daemonResult = await runCommand(options.project, { action: "get", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      node = daemonResult.node;
    } else {
      const client = await connectToProject(options.project);
      try {
        node = client.readNode(options.node);
        if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      } finally {
        await client.disconnect();
      }
    }

    // For media nodes, download the asset
    const src = node.data?.src as string | undefined;
    const isMedia = ["image", "video", "audio"].includes(node.type);
    let assetPath: string | null = null;
    if (isMedia && src) {
      assetPath = await downloadAsset(src);
    }

    if (isJsonMode(options)) {
      printJson({ ...node, ...(assetPath ? { assetPath } : {}) });
    } else {
      printNodeInfo(node);
      if (assetPath) {
        console.log(`Asset:    ${assetPath}`);
        console.log(`\nTo view this ${node.type}, open or read the file at the path above.`);
      }
    }
  });

// ─── add ──────────────────────────────────────────────────

canvasCommand
  .command("add")
  .description("Add a text, group, or action-badge node")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--type <type>", "Node type: text, group, image_gen, video_gen")
  .requiredOption("--label <label>", "Node label")
  .option("--content <content>", "Text content")
  .option("--parent <id>", "Parent group ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const daemonResult = await runCommand(options.project, {
      action: "add", type: options.type, label: options.label,
      content: options.content, parentId: options.parent,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else {
        console.log(`Created node: ${daemonResult.node_id} (${options.type})`);
        if (daemonResult.asset_id) console.log(`Asset ID:    ${daemonResult.asset_id}`);
      }
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const nodeId = crypto.randomUUID().slice(0, 8);
      const data: Record<string, unknown> = { label: options.label };
      if (options.content) { data.content = options.content; }

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

canvasCommand
  .command("execute")
  .description("Execute an action-badge node to trigger generation")
  .requiredOption("--project <id>", "Project ID")
  .requiredOption("--node <id>", "ActionBadge node ID to execute")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const daemonResult = await runCommand(options.project, { action: "execute", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else {
        console.log(`Executed action-badge: ${options.node}`);
        console.log(`Created pending asset: ${daemonResult.assetNodeId} (${daemonResult.assetNodeType})`);
      }
      return;
    }

    const client = await connectToProject(options.project);
    try {
      const canvas = new Canvas(client.doc, () => {});
      const result = canvas.executeGeneration(options.node, () => crypto.randomUUID().slice(0, 8));

      if (result.error) { console.error(`Error: ${result.error}`); process.exit(1); }

      if (isJsonMode(options)) {
        printJson({ executed: true, assetNodeId: result.assetNodeId, assetNodeType: result.assetNodeType });
      } else {
        console.log(`Executed action-badge: ${options.node}`);
        console.log(`Created pending asset: ${result.assetNodeId} (${result.assetNodeType})`);
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
    const daemonResult = await runCommand(options.project, {
      action: "update", nodeId: options.node, label: options.label, content: options.content,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else console.log(`Updated node: ${options.node}`);
      return;
    }

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
    const daemonResult = await runCommand(options.project, { action: "delete", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else console.log(`Deleted node: ${options.node}`);
      return;
    }

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
    const daemonResult = await runCommand(options.project, {
      action: "search", query: options.query, types: options.type?.split(",") ?? null,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult.nodes); }
      else {
        for (const node of daemonResult.nodes) {
          console.log(`${node.id}  ${node.type.padEnd(14)}  ${(node.data?.label as string) || ""}`);
        }
        console.log(`\n${daemonResult.nodes.length} result(s)`);
      }
      return;
    }

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
