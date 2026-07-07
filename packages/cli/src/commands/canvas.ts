import { Command } from "commander";
import WebSocket from "ws";
import { chmodSync, writeFileSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  LoroSyncClient, Canvas,
  parsePromptParts, extractAssetRefs,
  createMediaAssetCowNodeData,
  isMediaNodeType,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";
import { isDaemonRunning, sendCommand, startDaemon, getSocketPath } from "../lib/daemon";
import { apiFetch, apiJson } from "../lib/api";
import { resolveClashRoot } from "../lib/clash-home";
import { resolveProjectContext } from "../lib/project-context";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import {
  canvasBatchDeleteReadToken,
  canvasEdgeReadToken,
  canvasEdgesReadToken,
  canvasNodeReadToken,
  canvasDownstreamTargets,
  validateCanvasBatchDelete,
  validateCanvasBatchDeleteReadProof,
  validateCanvasCheckpointPatch,
  validateCanvasDelete,
  validateCanvasContentPatch,
  validateCanvasMediaAssetPatch,
  validateCanvasReadProof,
  validateCanvasUpdateDataFields,
  type CanvasReadProofEdgeLike,
  type CanvasReadProofNodeLike,
} from "../lib/canvas-update-guardrails";
import { requireDestructiveConfirmation } from "../lib/destructive-guardrails";
import {
  assertTimelineCas,
  assertTimelineLockFilePath,
  assertTimelineNotMaterializedReferenced,
  createTimelineAppliedRevision,
  createTimelineLock,
  normalizeTimelineDslForYaml,
  parseTimelineFileForApply,
  parseTimelineLock,
  readLoroRevisionMetadata,
  resolveTimelineFilePath,
  resolveTimelineLockPath,
  timelineYamlFromNode,
  type TimelineAppliedRevision,
  type TimelineLock,
} from "../lib/timeline-projection";

export interface CanvasPresenceOptions {
  clientType: "cli" | "agent";
  userId?: string;
  userName?: string;
  agentName?: string;
}

export type CanvasActor = {
  actorType: "user" | "agent";
  actorUserId: string;
  actorAgentId?: string;
};

export function resolveCanvasPresenceOptions(
  env: Record<string, string | undefined> = process.env,
): CanvasPresenceOptions {
  const userId = env.CLASH_USER_ID?.trim();
  const userName = env.CLASH_USER_NAME?.trim();
  const agentMemberId = env.CLASH_AGENT_MEMBER_ID?.trim();
  const agentName = env.CLASH_AGENT_NAME?.trim() || agentMemberId;
  const base = {
    ...(userId ? { userId } : {}),
    ...(userName ? { userName } : {}),
  };
  if (agentMemberId) {
    return {
      ...base,
      clientType: "agent",
      ...(agentName ? { agentName } : {}),
    };
  }
  return { ...base, clientType: "cli" };
}

/**
 * Resolve the actor that's running this CLI invocation for Phase 0
 * attribution. There are two shapes:
 *
 *   - User-driven (default): the CLI was launched by a human with their
 *     own API token. Hit /api/v1/me to translate the token into a
 *     user id, then stamp `{actorType:'user', actorUserId:<user>}`.
 *   - Agent-driven: the CLI was launched by the bridge daemon as the
 *     subprocess of an ACP agent. Bridge stamps
 *     CLASH_AGENT_MEMBER_ID + CLASH_API_KEY into the env. The API token
 *     still resolves to the agent member's owner (because agent claims
 *     run under the user's bearer); we stamp `{actorType:'agent',
 *     actorAgentId:<cm>, actorUserId:<owner>}` so the resulting node
 *     attributes back to the human accountable for it.
 *
 * Both lookups go through the same /api/v1/me endpoint — agent-driven
 * just additionally carries the agent member id from the env.
 */
export async function resolveCanvasActor(): Promise<CanvasActor> {
  const me = await apiJson<{ id: string }>("/api/v1/me").catch((e) => {
    throw new Error(`Failed to resolve user from API key: ${e instanceof Error ? e.message : String(e)}`);
  });
  const agentMemberId = process.env.CLASH_AGENT_MEMBER_ID;
  if (agentMemberId) {
    return { actorType: "agent", actorUserId: me.id, actorAgentId: agentMemberId };
  }
  return { actorType: "user", actorUserId: me.id };
}

export async function resolveCanvasProjectId(options: {
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
} = {}): Promise<string> {
  try {
    const context = await resolveProjectContext(options);
    return context.projectId;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

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
    ...resolveCanvasPresenceOptions(),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectNodeOption(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function normalizeNodeIds(nodeIds: unknown): string[] {
  return [...new Set((Array.isArray(nodeIds) ? nodeIds : [])
    .map((nodeId) => String(nodeId ?? "").trim())
    .filter(Boolean))];
}

function listCanvasReadProofEdges(client: LoroSyncClient): CanvasReadProofEdgeLike[] {
  const edgesMap = client.doc.getMap("edges");
  const edges: CanvasReadProofEdgeLike[] = [];
  for (const [edgeId, rawEdge] of edgesMap.entries()) {
    if (!isRecord(rawEdge)) continue;
    const edge = rawEdge as Record<string, unknown>;
    edges.push({
      id: edgeId,
      ...edge,
    });
  }
  return edges;
}

function listCanvasEdgesWithReadTokens(client: LoroSyncClient): { edges: CanvasReadProofEdgeLike[]; readToken: string } {
  const baseEdges = listCanvasReadProofEdges(client);
  const edges = baseEdges.map((edge) => ({
    ...edge,
    readToken: canvasEdgeReadToken(edge),
  }));
  return { edges, readToken: canvasEdgesReadToken(baseEdges) };
}

function readCanvasBatchDeletePlan(client: LoroSyncClient, requestedNodeIds: string[]): {
  nodeIds: string[];
  nodes: CanvasReadProofNodeLike[];
  edges: CanvasReadProofEdgeLike[];
  readToken: string;
} {
  const nodeIds = normalizeNodeIds(requestedNodeIds);
  if (nodeIds.length === 0) throw new Error("delete batch requires at least one node id");
  const nodes: CanvasReadProofNodeLike[] = [];
  const missing: string[] = [];
  for (const nodeId of nodeIds) {
    const node = client.readNode(nodeId);
    if (!node) {
      missing.push(nodeId);
      continue;
    }
    nodes.push(node);
  }
  if (missing.length > 0) throw new Error(`Node(s) not found: ${missing.join(", ")}`);
  const edges = listCanvasReadProofEdges(client);
  return {
    nodeIds,
    nodes,
    edges,
    readToken: canvasBatchDeleteReadToken({ nodes, edges }),
  };
}

function canvasGuardrailEdgesFromReadProof(
  edges: CanvasReadProofEdgeLike[],
): Array<{ source: string; target: string }> {
  return edges
    .map((edge) => ({
      source: typeof edge.source === "string" ? edge.source : "",
      target: typeof edge.target === "string" ? edge.target : "",
    }))
    .filter((edge) => edge.source && edge.target);
}

export async function replaceCanvasAssetNode(options: {
  project?: string;
  nodeId: string;
  assetId: string;
  ifMatch?: string;
  newNode?: string;
  label?: string;
  force?: boolean;
}): Promise<Record<string, unknown>> {
  const projectId = await resolveCanvasProjectId({ project: options.project });
  const assetId = String(options.assetId ?? "").trim();
  if (!assetId) throw new Error("asset id is required");

  const daemonResult = await runCommand(projectId, {
    action: "asset_cow_replace",
    nodeId: options.nodeId,
    assetId,
    newNodeId: options.newNode,
    label: options.label,
    actorClientType: resolveCanvasPresenceOptions().clientType,
    ifMatch: options.ifMatch,
    force: options.force === true,
  });
  if (daemonResult) {
    if (daemonResult.error) throw new Error(daemonResult.error);
    return daemonResult;
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
    force: options.force === true,
    operation: "canvas media replacement",
    readCommand: "clash canvas get --json",
  });
  if (!hostWrite.ok) throw new Error(hostWrite.error);

  const client = await connectToProject(projectId);
  try {
    const node = client.readNode(options.nodeId);
    if (!node) throw new Error(`Node not found: ${options.nodeId}`);
    if (!isMediaNodeType(node.type)) {
      throw new Error(`Node ${options.nodeId} has type "${node.type}", expected image, video, or audio`);
    }
    const readProof = validateCanvasReadProof({
      operation: "update",
      actorClientType: resolveCanvasPresenceOptions().clientType,
      node,
      expectedReadToken: options.ifMatch,
      force: options.force === true,
    });
    if (!readProof.ok) throw new Error(readProof.error);

    const newNodeId = typeof options.newNode === "string" && options.newNode.trim()
      ? options.newNode.trim()
      : crypto.randomUUID().slice(0, 8);
    const sourceAssetId = typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
    const data = createMediaAssetCowNodeData({
      sourceNodeId: options.nodeId,
      sourceLabel: typeof node.data?.label === "string" ? node.data.label : undefined,
      sourceAssetId,
      assetId,
      label: typeof options.label === "string" ? options.label : undefined,
    });
    client.canvas.createLinkedNode({
      nodeId: newNodeId,
      nodeType: node.type,
      data,
      parentId: node.parent_id ?? null,
      sourceNodeId: options.nodeId,
      edgeId: `${options.nodeId}-${newNodeId}`,
      edgeType: "copy-on-write",
    });
    const newNode = client.readNode(newNodeId);
    return {
      replaced: true,
      copyOnWrite: true,
      sourceNodeId: options.nodeId,
      newNodeId,
      nodeId: newNodeId,
      sourceAssetId,
      assetId,
      lineageEdge: { source: options.nodeId, target: newNodeId, type: "copy-on-write" },
      ...(newNode ? { readToken: canvasNodeReadToken(newNode) } : {}),
      ...(options.force === true ? { forced: true } : {}),
    };
  } finally {
    await client.disconnect();
  }
}

export const canvasCommand = new Command("canvas")
  .description(`Canvas node operations (via Loro CRDT sync)

Node types: text, group, image, video, audio, image_gen, video_gen, audio_gen, text_gen

Daemon mode (recommended for multi-command sessions):
  clash init --project <id>       # one-time workspace setup
  clash canvas connect            # start persistent connection
  clash canvas list --json        # uses cwd marker automatically
  clash canvas disconnect         # stop (auto-exits after 10min idle)`);

// ─── connect ─────────────────────────────────────────────

canvasCommand
  .command("connect")
  .description("Start persistent connection to a project (daemon mode)")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    if (isDaemonRunning(projectId)) {
      console.log(JSON.stringify({ status: "already_running", socket: getSocketPath(projectId) }));
      return;
    }
    const apiKey = requireApiKey();
    const serverUrl = getServerUrl();
    await startDaemon(projectId, serverUrl, apiKey, resolveCanvasPresenceOptions());
  });

// ─── disconnect ──────────────────────────────────────────

canvasCommand
  .command("disconnect")
  .description("Stop persistent connection")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    if (!isDaemonRunning(projectId)) {
      console.log("No daemon running.");
      return;
    }
    const result = await sendCommand(projectId, { action: "disconnect" });
    console.log(JSON.stringify(result));
  });

// ─── list ─────────────────────────────────────────────────

canvasCommand
  .command("list")
  .description("List canvas nodes")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--type <type>", "Filter by node type")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const daemonResult = await runCommand(projectId, { action: "list", type: options.type });
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

    const client = await connectToProject(projectId);
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

canvasCommand
  .command("edges")
  .description("List canvas edges with read tokens for agent CAS")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const daemonResult = await runCommand(projectId, { action: "edges" });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      const edges = Array.isArray(daemonResult.edges) ? daemonResult.edges : [];
      const readToken = typeof daemonResult.readToken === "string" ? daemonResult.readToken : undefined;
      if (isJsonMode(options)) { printJson({ edges, ...(readToken ? { readToken } : {}) }); }
      else {
        for (const edge of edges) {
          console.log(`${edge.id}  ${edge.source} -> ${edge.target}`);
          if (edge.readToken) console.log(`  Read token: ${edge.readToken}`);
        }
        if (readToken) console.log(`\nGraph read token: ${readToken}`);
        console.log(`\n${edges.length} edge(s)`);
      }
      return;
    }

    const client = await connectToProject(projectId);
    try {
      const { edges, readToken } = listCanvasEdgesWithReadTokens(client);
      if (isJsonMode(options)) {
        printJson({ edges, readToken });
      } else if (edges.length === 0) {
        console.log("No edges found.");
        console.log(`Graph read token: ${readToken}`);
      } else {
        for (const edge of edges) {
          console.log(`${edge.id}  ${edge.source} -> ${edge.target}`);
          if (edge.readToken) console.log(`  Read token: ${edge.readToken}`);
        }
        console.log(`\nGraph read token: ${readToken}`);
        console.log(`\n${edges.length} edge(s)`);
      }
    } finally {
      await client.disconnect();
    }
  });

canvasCommand
  .command("delete-plan")
  .description("Read a graph-aware batch delete plan and CAS token")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--node <id>", "Node ID to include in the delete batch; repeat for multiple nodes", collectNodeOption, [] as string[])
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const nodeIds = normalizeNodeIds(options.node);
    if (nodeIds.length === 0) {
      console.error("Provide at least one --node <id>");
      process.exit(1);
    }

    const projectId = await resolveCanvasProjectId(options);
    const daemonResult = await runCommand(projectId, {
      action: "batch_delete_plan",
      nodeIds,
      actorClientType: resolveCanvasPresenceOptions().clientType,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) printJson(daemonResult);
      else {
        console.log(`Batch delete plan: ${daemonResult.nodeIds?.join(", ") ?? nodeIds.join(", ")}`);
        console.log(`Read token: ${daemonResult.readToken}`);
      }
      return;
    }

    const client = await connectToProject(projectId);
    try {
      const plan = readCanvasBatchDeletePlan(client, nodeIds);
      if (isJsonMode(options)) printJson(plan);
      else {
        console.log(`Batch delete plan: ${plan.nodeIds.join(", ")}`);
        console.log(`Read token: ${plan.readToken}`);
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await client.disconnect();
    }
  });

// ─── get ──────────────────────────────────────────────────

/** Cache dir: $CLASH_HOME/cache/assets, or ~/.clash/cache/assets by default. */
export function assetCacheDir(env: Record<string, string | undefined> = process.env): string {
  return join(resolveClashRoot(env), "cache", "assets");
}

export function resolveAssetDownloadUrl(signedUrl: string, serverUrl = getServerUrl()): string {
  return new URL(signedUrl, `${serverUrl.replace(/\/+$/, "")}/`).toString();
}

/**
 * Download media asset by D1 asset id. Returns file path, or null on failure.
 *
 * Caches by assetId (immutable identifier — same id always means the same
 * underlying R2 object), so repeat calls skip the metadata round-trip
 * entirely. Extension is sniffed from srcR2Key the first time so file viewers
 * pick the right type.
 */
export async function downloadAssetById(assetId: string): Promise<string | null> {
  try {
    const cacheDir = assetCacheDir();
    mkdirSync(cacheDir, { recursive: true });

    // Cache hit: any file starting with `${assetId}.` is the same asset.
    // Glob would be cleaner but readdirSync is dependency-free and fast for a tiny dir.
    const safeId = assetId.replace(/[/\\:]/g, "_");
    for (const name of readdirSync(cacheDir)) {
      if (name === safeId || name.startsWith(`${safeId}.`)) {
        const cachedPath = join(cacheDir, name);
        try { chmodSync(cachedPath, 0o444); } catch {}
        return cachedPath;
      }
    }

    const metaRes = await apiFetch(`/api/v1/assets/${encodeURIComponent(assetId)}`);
    if (!metaRes.ok) return null;
    const asset = (await metaRes.json()) as { srcR2Key: string; signedUrl: string };

    const ext = asset.srcR2Key.match(/\.[a-zA-Z0-9]+$/)?.[0] ?? "";
    const filePath = join(cacheDir, `${safeId}${ext}`);

    const fullUrl = resolveAssetDownloadUrl(asset.signedUrl);
    const res = await fetch(fullUrl);
    if (!res.ok) return null;

    writeFileSync(filePath, Buffer.from(await res.arrayBuffer()), { mode: 0o444 });
    try { chmodSync(filePath, 0o444); } catch {}
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
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--node <id>", "Node ID")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    let node: any = null;
    let readToken: string | null = null;

    const projectId = await resolveCanvasProjectId(options);
    const daemonResult = await runCommand(projectId, { action: "get", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      node = daemonResult.node;
      readToken = typeof daemonResult.readToken === "string" ? daemonResult.readToken : null;
    } else {
      const client = await connectToProject(projectId);
      try {
        node = client.readNode(options.node);
        if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      } finally {
        await client.disconnect();
      }
    }
    readToken = readToken ?? canvasNodeReadToken(node);

    // For media nodes, download the asset via D1 assetId.
    const assetId = typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
    const isMedia = ["image", "video", "audio"].includes(node.type);
    let assetPath: string | null = null;
    if (isMedia && assetId) {
      assetPath = await downloadAssetById(assetId);
    }

    if (isJsonMode(options)) {
      printJson({ ...node, readToken, ...(assetPath ? { assetPath } : {}) });
    } else {
      printNodeInfo(node);
      console.log(`Read token: ${readToken}`);
      if (assetPath) {
        console.log(`Asset:    ${assetPath}`);
        console.log(`\nTo view this ${node.type}, open or read the file at the path above.`);
      }
    }
  });

// ─── add ──────────────────────────────────────────────────
//
// One unified surface for every kind of `*_gen` action-badge node (image,
// video, audio, text) plus plain text/group. The shape mirrors what the
// web UI persists on a fresh action-badge:
//
//   prompt        — text, supports inline `@[label](node:<id>)` references
//                   to canvas asset nodes (same syntax the chat composer
//                   emits). The mentions are *not* a separate input
//                   modality — the system partitions them by the
//                   referenced asset's `kind` (image / video / audio).
//   model         — modelId (--model). Defaults per node type if omitted.
//   modelParams   — model-specific knobs (--param k=v, repeatable). The
//                   model card validates which keys are accepted.
//   references    — explicit asset/node references (--ref, repeatable).
//                   Same partitioning as prompt mentions; useful when
//                   you want the ref WITHOUT cluttering the prompt text.
//
// Refs (both from --ref and from prompt @-mentions) are resolved at
// CLI submit time:
//   1. If the value looks like a canvas node id and the project's canvas
//      has that node, take `node.data.assetId`.
//   2. Otherwise assume it's already an asset id.
//   3. Fetch `/api/v1/assets/:id` for each to discover `kind`, then
//      partition into referenceImageAssetIds / referenceVideoAssetIds /
//      referenceAudioAssetIds.

/** Build the dash-form actionType + default modelId map for *_gen nodes.
 *  These have to match what the web UI's ActionBadge writes on create,
 *  otherwise the agent's nodes look "different" and the executor's
 *  provider-routing breaks. */
const ACTION_TYPE_BY_NODE_TYPE: Record<string, string> = {
  image_gen: "image-gen",
  video_gen: "video-gen",
  audio_gen: "audio-gen",
  text_gen: "text-gen",
};
const DEFAULT_MODEL_BY_NODE_TYPE: Record<string, string> = {
  image_gen: "nano-banana-2",
  video_gen: "veo-3.1-fast",
  audio_gen: "gemini-3.1-flash-tts",
  text_gen: "gemini-3-flash",
};

/** Parse a `--param k=v` value into a tuple. Numbers and booleans
 *  pass through as their primitive types; everything else stays a
 *  string. Mirrors the modelParams shape declared in shared-types
 *  (`Record<string, string | number | boolean>`). */
function coerceParamValue(raw: string): string | number | boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  // Only treat as number if the entire string is numeric. `"123abc"`
  // stays a string; agents pass strings like "16:9" that would
  // otherwise be lost to the parseFloat short-circuit.
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * Resolve a list of `(nodeOrAssetIds)` to canvas node ids. References
 * on the canvas are expressed as **edges** — the web UI's ActionBadge
 * derives `refNodeIds` from incoming edges, not from any data field
 * the action-badge node carries. So the only thing we need from each
 * --ref or @-mention is the source node id; the kind partitioning
 * happens later, at execute time (`useSpawnPendingAsset.buildShape`),
 * when the pending asset node is being built and the model card is
 * known.
 *
 * Each input ref can be a canvas node id (kept as-is) or a bare asset
 * id (reverse-resolved by finding the node whose `data.assetId`
 * matches). Anything we can't resolve goes into `missing` so the CLI
 * can warn instead of silently dropping a reference.
 */
async function resolveReferences(
  projectId: string,
  refs: string[],
): Promise<{ refNodeIds: string[]; missing: string[] }> {
  const out = { refNodeIds: [] as string[], missing: [] as string[] };
  if (refs.length === 0) return out;

  // Cache the canvas listing once per `add` call. Daemon path is the
  // fast path; the one-shot LoroSyncClient fallback matters because
  // canvas daemons auto-exit after 10 minutes of idle — without it a
  // stale socket would silently drop every ref into `missing`.
  const nodesById = new Map<string, { id: string; data?: Record<string, unknown> }>();
  if (isDaemonRunning(projectId)) {
    const res = (await sendCommand(projectId, { action: "list" })) as
      | { nodes?: Array<{ id: string; data?: Record<string, unknown> }> }
      | null;
    for (const n of res?.nodes ?? []) nodesById.set(n.id, n);
  } else {
    const client = await connectToProject(projectId);
    try {
      for (const n of client.listNodes()) {
        nodesById.set(n.id, { id: n.id, data: n.data as Record<string, unknown> });
      }
    } finally {
      await client.disconnect();
    }
  }

  // Build a reverse index assetId → nodeId for the bare-asset-id path.
  const nodeIdByAssetId = new Map<string, string>();
  for (const [nid, n] of nodesById) {
    const aid = n.data?.assetId;
    if (typeof aid === "string") nodeIdByAssetId.set(aid, nid);
  }

  for (const ref of refs) {
    if (nodesById.has(ref)) {
      out.refNodeIds.push(ref);                       // direct node-id hit
    } else if (nodeIdByAssetId.has(ref)) {
      out.refNodeIds.push(nodeIdByAssetId.get(ref)!); // bare asset id → reverse-resolve
    } else {
      out.missing.push(ref);
    }
  }
  return out;
}

canvasCommand
  .command("add")
  .description("Add a text, group, or action-badge node")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--type <type>", "Node type: text, group, image_gen, video_gen, audio_gen, text_gen")
  .requiredOption("--label <label>", "Node label")
  .option("--prompt <text>", "Generation prompt for *_gen nodes. May contain `@[Label](node:<id>)` mentions to reference canvas asset nodes; type partitioning is automatic from the referenced asset's kind.")
  .option("--content <content>", "Body content for text / group nodes. Ignored for *_gen nodes — use --prompt there.")
  .option("--parent <id>", "Parent group ID")
  .option(
    "--model <id>",
    "Generation model id (e.g. nano-banana-2, gpt-image-2, veo-3.1-fast). Stored as data.modelId. Required for *_gen action nodes when no marketplace action is installed.",
  )
  .option(
    "--ref <id...>",
    "Reference an existing canvas asset (image / video / audio). Accepts a canvas node id (we look up its asset) or a bare asset id. Repeatable; the type partitions automatically by asset kind.",
    (val: string, prev: string[]) => [...(prev ?? []), val],
    [] as string[],
  )
  .option(
    "--param <key=value...>",
    "Model parameter (repeatable, stored under data.modelParams). Booleans and integers are coerced; everything else stays a string. Example: --param aspectRatio=16:9 --param seed=42",
    (val: string, prev: Array<[string, string]>) => {
      const eq = val.indexOf("=");
      if (eq < 0) throw new Error(`--param expects key=value, got: ${val}`);
      return [...(prev ?? []), [val.slice(0, eq), val.slice(eq + 1)] as [string, string]];
    },
    [] as Array<[string, string]>,
  )
  .option(
    "--action <id>",
    "Use a custom marketplace action instead of a built-in model. The action must be registered in the project (via the Python SDK's register_custom_actions, or the marketplace install flow). When set, --model is ignored and --param values go into data.customActionParams instead of data.modelParams.",
  )
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    // Phase 0 attribution: every node landed via the CLI gets stamped
    // with the actor that's running it. NodeProcessor refuses to
    // dispatch generations without these fields, so they're mandatory
    // for *_gen nodes; we attach them to text / group nodes too so
    // the inspector can show "Made by X" uniformly.
    const actor = await resolveCanvasActor();
    const extraData: Record<string, unknown> = {
      actorType: actor.actorType,
      actorUserId: actor.actorUserId,
      ...(actor.actorAgentId ? { actorAgentId: actor.actorAgentId } : {}),
    };
    const isGenNode = !!ACTION_TYPE_BY_NODE_TYPE[options.type];

    const isCustomAction = isGenNode && typeof options.action === "string" && options.action.length > 0;

    if (isGenNode) {
      if (isCustomAction) {
        // Custom action: actionType becomes `custom:<id>`, and the
        // executor reads customActionId / customActionParams / outputType
        // instead of modelId / modelParams. The output kind follows the
        // node type — `image_gen + --action grid-split` produces an
        // image-kinded pending child.
        extraData.actionType = `custom:${options.action}`;
        extraData.customActionId = options.action;
        const outputType =
          options.type === "video_gen" ? "video" :
          options.type === "audio_gen" ? "audio" :
          options.type === "text_gen"  ? "text"  : "image";
        extraData.outputType = outputType;
      } else {
        extraData.actionType = ACTION_TYPE_BY_NODE_TYPE[options.type];
        extraData.modelId = options.model ?? DEFAULT_MODEL_BY_NODE_TYPE[options.type];
      }
    } else if (options.model) {
      extraData.modelId = options.model;
    }

    // --param k=v lands under data.modelParams for built-in models, and
    // under data.customActionParams for custom actions. Both shapes are
    // `Record<string, string | number | boolean>`.
    if ((options.param ?? []).length > 0) {
      const params: Record<string, string | number | boolean> = {};
      for (const [k, v] of options.param) params[k] = coerceParamValue(v);
      if (isCustomAction) extraData.customActionParams = params;
      else extraData.modelParams = params;
    }

    // For *_gen nodes, write the prompt to BOTH `data.content` and
    // `data.prompt`. They map to different consumers in the web stack
    // and silently diverged on us once already:
    //   - ActionBadge's prompt editor seeds itself from `data.content`
    //     (the raw markdown the user typed, with `@[Label](node:id)`
    //     mentions preserved). Without it the UI renders an empty
    //     editor even when the node has a real prompt.
    //   - The generation executor reads `data.prompt` at run time as
    //     the cleaned plain-text payload to send to the provider.
    // The web UI keeps them in lockstep on every keystroke; we mirror
    // that here so CLI-created nodes are indistinguishable from
    // UI-created ones.
    const promptText: string | undefined = options.prompt;
    if (promptText && isGenNode) {
      extraData.prompt = promptText;
      extraData.content = promptText;
    }

    // Collect refs: explicit --ref values + any @-mentions inside the
    // prompt. Dedupe so a ref typed both ways doesn't get wired twice.
    const promptMentionIds = promptText
      ? extractAssetRefs(parsePromptParts(promptText)).map((r) => r.nodeId)
      : [];
    const allRefIds = [...new Set([...(options.ref ?? []), ...promptMentionIds])];

    // Resolve every input to a canvas node id. The action-badge data
    // doesn't carry the asset-id arrays (referenceImage/Video/AudioAssetIds);
    // those live on the *pending asset child* spawned at execute time
    // (see `useSpawnPendingAsset.buildShape` — it partitions refs by
    // model card capability at that moment). What the action-badge
    // does carry is `referenceImageOrder` — a positional list of
    // source node ids that the web UI uses to render the inline ref
    // chips inside the prompt editor in a stable order. The actual
    // ref edges are the source of truth, mirroring how the web
    // creates them (ActionBadge.addRefNode does the same).
    let refNodeIds: string[] = [];
    if (isGenNode && allRefIds.length > 0) {
      const resolved = await resolveReferences(projectId, allRefIds);
      refNodeIds = resolved.refNodeIds;
      if (refNodeIds.length > 0) extraData.referenceImageOrder = refNodeIds;
      if (resolved.missing.length > 0 && !isJsonMode(options)) {
        console.error(
          `warning: ${resolved.missing.length} reference(s) couldn't be resolved (no canvas node or asset row found): ${resolved.missing.join(", ")}`,
        );
      }
    }

    // For non-*_gen nodes (text / group) the daemon's `add` handler
    // sets `data.content` from this top-level field. For *_gen nodes
    // we've already populated data.content from --prompt above, so
    // don't double-write.
    const daemonResult = await runCommand(projectId, {
      action: "add", type: options.type, label: options.label,
      content: isGenNode ? undefined : options.content,
      parentId: options.parent,
      data: Object.keys(extraData).length ? extraData : undefined,
    });

    /** After the node lands, wire each ref through `ensure_edge` (daemon)
     *  or directly via the LoroSyncClient. Each edge fans out via
     *  Loro to every connected browser, where ActionBadge's
     *  `refNodeIds` recomputes from `edges.filter(e => e.target === id)`
     *  and the prompt editor's mention chips resolve their thumbnails. */
    async function wireRefEdges(newNodeId: string): Promise<void> {
      if (refNodeIds.length === 0) return;
      if (isDaemonRunning(projectId)) {
        for (const sourceId of refNodeIds) {
          await sendCommand(projectId, { action: "ensure_edge", source: sourceId, target: newNodeId });
        }
        return;
      }
      // No daemon — open a one-shot client. Note: this path means we
      // open *two* clients in the no-daemon code branch (one here, one
      // in the createNode fallback below), each with its own connect /
      // disconnect. Not ideal but matches the existing one-shot pattern
      // elsewhere in this file. Daemon mode (recommended) avoids it.
      const client = await connectToProject(projectId);
      try {
        const existing = client.canvas.listEdges();
        for (const sourceId of refNodeIds) {
          const dup = existing.find((e) => e.source === sourceId && e.target === newNodeId);
          if (dup) continue;
          client.canvas.insertEdge(`${sourceId}-${newNodeId}`, sourceId, newNodeId, "default");
        }
      } finally {
        await client.disconnect();
      }
    }

    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      await wireRefEdges(daemonResult.node_id as string);
      if (isJsonMode(options)) { printJson({ ...daemonResult, refNodeIds }); }
      else {
        console.log(`Created node: ${daemonResult.node_id} (${options.type})`);
        if (daemonResult.asset_id) console.log(`Asset ID:    ${daemonResult.asset_id}`);
        if (refNodeIds.length > 0) console.log(`Refs wired:  ${refNodeIds.join(", ")}`);
      }
      return;
    }

    const client = await connectToProject(projectId);
    try {
      const nodeId = crypto.randomUUID().slice(0, 8);
      const data: Record<string, unknown> = { ...extraData, label: options.label };
      if (options.content && !isGenNode) { data.content = options.content; }

      const result = client.createNode(nodeId, options.type, data, null, options.parent ?? null);
      if (result.error) { console.error(`Error: ${result.error}`); process.exit(1); }
      const existing = client.canvas.listEdges();
      for (const sourceId of refNodeIds) {
        const dup = existing.find((e) => e.source === sourceId && e.target === nodeId);
        if (dup) continue;
        client.canvas.insertEdge(`${sourceId}-${nodeId}`, sourceId, nodeId, "default");
      }
      if (isJsonMode(options)) {
        printJson({ ...result, refNodeIds });
      } else {
        console.log(`Created node: ${result.node_id} (${options.type})`);
        if (result.asset_id) console.log(`Asset ID:    ${result.asset_id}`);
        if (refNodeIds.length > 0) console.log(`Refs wired:  ${refNodeIds.join(", ")}`);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── execute ──────────────────────────────────────────────

canvasCommand
  .command("execute")
  .description(
    "Execute a node — triggers generation for action-badge nodes or render for video-editor nodes",
  )
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--node <id>", "Node ID (action-badge or video-editor)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const printExecuteResult = (kind: string | null, childNodeId: string, childNodeType: string) => {
      if (kind === "render") {
        console.log(`Executed video-editor: ${options.node}`);
        console.log(`Created pending render-video node: ${childNodeId}`);
      } else {
        console.log(`Executed action-badge: ${options.node}`);
        console.log(`Created pending asset: ${childNodeId} (${childNodeType})`);
      }
    };

    const daemonResult = await runCommand(projectId, { action: "execute", nodeId: options.node });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) printJson(daemonResult);
      else printExecuteResult(daemonResult.kind, daemonResult.childNodeId, daemonResult.childNodeType);
      return;
    }

    const client = await connectToProject(projectId);
    try {
      const canvas = new Canvas(client.doc, () => {});
      const r = canvas.execute(options.node, () => crypto.randomUUID().slice(0, 8));
      if (r.error) { console.error(`Error: ${r.error}`); process.exit(1); }
      if (isJsonMode(options)) {
        printJson({ executed: true, kind: r.kind, childNodeId: r.childNodeId, childNodeType: r.childNodeType });
      } else {
        printExecuteResult(r.kind, r.childNodeId, r.childNodeType);
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── timeline (pull / push) ───────────────────────────────
//
// VideoEditorNode owns a `timelineDsl` blob under `node.data.timelineDsl`
// (tracks + fps + composition size + duration; shape defined in
// `@master-clash/remotion-core` as `TimelineDsl`). The canvas-editor agent
// edits videos by:
//   1. `clash canvas timeline pull --node <id> -o timeline.yaml`
//   2. opening timeline.yaml in their Read/Edit toolchain
//   3. `clash canvas timeline push --node <id> -i timeline.yaml`
//
// YAML, not JSON: matches the agent-facing format defined in
// `@clash/shared-types/timeline-yaml` (`timelineDsl{To,From}Yaml`). That
// module already implements the full validator + relative-position
// resolver ("prev", "prev+15", "clip-A-30") used by the in-app
// agent tools, so the CLI just delegates. Keeps the agent surface and
// the in-app surface byte-identical instead of inventing a parallel
// JSON dialect that drifts.

const timelineCommand = canvasCommand
  .command("timeline")
  .description(
    `Round-trip a VideoEditorNode's timeline as a YAML file (edit-on-disk).

Workflow:
  clash canvas timeline pull --node <id> -o timeline.yaml   # export
  # edit timeline.yaml with your normal Read/Edit tools
  clash canvas timeline push --node <id> -i timeline.yaml   # write back

CAS:
  pull with -o also writes timeline.lock.json. push refuses to write if the
  canvas timeline changed after pull unless --force is passed.

Shape (one track, two image clips back-to-back):
  compositionWidth: 1920
  compositionHeight: 1080
  fps: 30
  durationInFrames: 300
  tracks:
    - id: track-1
      name: Video
      items:
        - id: shot-A
          type: image
          from: 0
          durationInFrames: 150
          sourceNodeId: abc12345
        - id: shot-B
          type: image
          from: prev          # = previous item's end
          durationInFrames: 150
          sourceNodeId: def67890

\`from\` accepts numbers (absolute frame), the literal "prev" (the
previous item on the same track), or "<id>±N" (offset from another
item's end). All resolved to absolute frames on push. \`sourceNodeId\`
points at a canvas asset node — find candidates with
\`clash canvas list --type image --json\`.`,
  );

// ─── timeline pull ─────────────────────────────────────────

timelineCommand
  .command("pull")
  .description("Export the node's timelineDsl as YAML to stdout or a file")
  .requiredOption("--node <id>", "VideoEditorNode ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("-o, --output <path>", "Write to this file instead of stdout")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const node = await readNode(projectId, options.node);
    if (!node) {
      console.error(`Node not found: ${options.node}`);
      process.exit(1);
    }
    if (node.type !== "video-editor") {
      // Soft warning, not a hard error — power users might keep timeline
      // blobs on non-editor nodes during migrations. Surface it loudly so
      // agents notice and pick a different node.
      process.stderr.write(
        `warning: node ${options.node} has type "${node.type}", expected "video-editor". ` +
          `Proceeding; the editor may ignore the result.\n`,
      );
    }

    const dsl = normalizeTimelineDslForYaml(node.data?.timelineDsl);
    const yaml = timelineYamlFromNode(node);

    if (options.output) {
      const filePath = resolveTimelineFilePath({ cwd: process.cwd(), file: options.output });
      const lockPath = resolveTimelineLockPath({ cwd: process.cwd(), file: options.output });
      const lock = createTimelineLock({
        projectId,
        nodeId: options.node,
        filePath,
        dsl,
      });
      mkdirSync(dirname(filePath), { recursive: true });
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(filePath, yaml, "utf-8");
      writeFileSync(lockPath, JSON.stringify(lock, null, 2) + "\n", "utf-8");
      process.stderr.write(`wrote ${filePath}\nwrote ${lockPath}\n`);
    } else {
      process.stdout.write(yaml);
      process.stderr.write("warning: no CAS lock written for stdout output; push from stdin requires --lock or --force.\n");
    }
  });

// ─── timeline push ─────────────────────────────────────────

timelineCommand
  .command("push")
  .description("Write a timelineDsl YAML file back into the node")
  .requiredOption("--node <id>", "VideoEditorNode ID")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("-i, --input <path>", "Read from this file (default: stdin, or '-' for stdin)")
  .option("--lock <path>", "CAS lock path (default: input YAML sidecar)")
  .option("--force", "Bypass CAS and intentionally overwrite the current canvas timeline")
  .option("--json", "Output result as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);

    // Read body. `-i -` and omitting `-i` both read stdin; `-i <path>` reads file.
    const raw = readBody(options.input);
    // Validate + resolve via the shared parser. Catches: bad YAML, missing
    // `tracks`, items without id/type/durationInFrames, items typoed with
    // `start`/`end` instead of `from`/`durationInFrames` (those fail the
    // durationInFrames check), and resolves `prev` / `<id>±N` references
    // to absolute frames.
    const result = parseTimelineFileForApply(raw);
    if (!result.ok) {
      console.error(`error: ${result.error}`);
      process.exit(1);
    }
    const resolved = result.dsl;
    const lockPath = resolveTimelineApplyLockPath(options.input, options.lock);
    const lock = options.force ? null : readTimelineLockForApply(lockPath);
    const inputFilePath = options.input && options.input !== "-"
      ? resolveTimelineFilePath({ cwd: process.cwd(), file: options.input })
      : undefined;
    const filePathCas = assertTimelineLockFilePath({
      lock,
      filePath: inputFilePath,
      cwd: process.cwd(),
      force: options.force === true,
    });
    if (!filePathCas.ok) {
      console.error(filePathCas.error);
      process.exit(1);
    }

    // Each unique source media node in the timeline gets a default
    // canvas edge to the editor — so the graph view reflects "this
    // editor consumes these media nodes" instead of looking like a
    // floating island. ensure_edge is idempotent on (source, target).
    const sources = result.sources;
    const actor = await resolveCanvasActor();

    function refreshTimelineLock(timelineRevision: TimelineAppliedRevision): void {
      if (!lockPath || !inputFilePath) return;
      const refreshedLock = createTimelineLock({
        projectId,
        nodeId: options.node,
        filePath: inputFilePath,
        dsl: resolved,
        appliedRevision: timelineRevision,
      });
      mkdirSync(dirname(lockPath), { recursive: true });
      writeFileSync(lockPath, JSON.stringify(refreshedLock, null, 2) + "\n", "utf-8");
    }

    // Daemon path: existing `update` action merges `data` into node.data
    // and broadcasts to the project room. timelineDsl is just one of
    // those merged fields — same wire shape as `clash canvas update`.
    const daemonResult = await runCommand(projectId, {
      action: "timeline_cas_update",
      projectId,
      nodeId: options.node,
      dsl: resolved,
      expectedTimelineHash: lock?.timelineHash,
      expectedTimelineFilePath: lock?.filePath,
      ...(inputFilePath ? { cwd: process.cwd(), filePath: inputFilePath } : {}),
      actor,
      force: options.force === true,
    });
    if (daemonResult) {
      if (daemonResult.error) {
        console.error(daemonResult.error);
        process.exit(1);
      }
      let edgesAdded = 0;
      for (const src of sources) {
        const r = await runCommand(projectId, {
          action: "ensure_edge",
          source: src,
          target: options.node,
        });
        if (r && !r.error && r.existed === false) edgesAdded++;
      }
      const timelineRevision = daemonResult.timelineRevision ?? (inputFilePath
        ? createTimelineAppliedRevision({
            projectId,
            nodeId: options.node,
            cwd: process.cwd(),
            filePath: inputFilePath,
            dsl: resolved,
            parentRevisionId: lock?.appliedRevision?.revisionId,
            actor,
          })
        : undefined);
      if (timelineRevision) refreshTimelineLock(timelineRevision);
      if (isJsonMode(options)) printJson({ ...daemonResult, edgesAdded, sources });
      else
        process.stderr.write(
          `pushed timeline to ${options.node} (${sources.length} source${sources.length === 1 ? "" : "s"}, +${edgesAdded} edge${edgesAdded === 1 ? "" : "s"})${daemonResult.forced ? " (forced)" : ""}\n`,
        );
      return;
    }

    // One-shot fallback (no daemon connected for this project).
    const client = await connectToProject(projectId);
    try {
      const current = client.readNode(options.node);
      if (!current) {
        console.error(`Node not found: ${options.node}`);
        process.exit(1);
      }
      const cas = assertTimelineCas({
        projectId,
        nodeId: options.node,
        lock,
        currentDsl: normalizeTimelineDslForYaml(current.data?.timelineDsl),
        force: options.force === true,
        ...(inputFilePath ? { filePath: inputFilePath, cwd: process.cwd() } : {}),
      });
      if (!cas.ok) {
        console.error(cas.error);
        process.exit(1);
      }
      const reference = assertTimelineNotMaterializedReferenced({
        nodeId: options.node,
        nodes: client.listNodes(),
        edges: client.canvas.listEdges(),
        force: options.force === true,
      });
      if (!reference.ok) {
        console.error(reference.error);
        process.exit(1);
      }
      const ok = client.updateNode(options.node, { timelineDsl: resolved });
      if (!ok) {
        console.error(`Node not found: ${options.node}`);
        process.exit(1);
      }
      let edgesAdded = 0;
      const existing = client.canvas.listEdges();
      for (const src of sources) {
        const pair = existing.find((e) => e.source === src && e.target === options.node);
        if (pair) continue;
        const edgeId = `e-${src}-${options.node}-${crypto.randomUUID().slice(0, 4)}`;
        client.canvas.insertEdge(edgeId, src, options.node, "default");
        edgesAdded++;
      }
      const timelineRevision = inputFilePath
        ? createTimelineAppliedRevision({
            projectId,
            nodeId: options.node,
            cwd: process.cwd(),
            filePath: inputFilePath,
            dsl: resolved,
            parentRevisionId: lock?.appliedRevision?.revisionId,
            actor,
            ...readLoroRevisionMetadata(client.doc),
          })
        : undefined;
      if (timelineRevision) refreshTimelineLock(timelineRevision);
      if (isJsonMode(options)) printJson({
        updated: true,
        nodeId: options.node,
        edgesAdded,
        sources,
        ...(options.force === true ? { forced: true } : {}),
      });
      else
        process.stderr.write(
          `pushed timeline to ${options.node} (${sources.length} source${sources.length === 1 ? "" : "s"}, +${edgesAdded} edge${edgesAdded === 1 ? "" : "s"})${options.force === true ? " (forced)" : ""}\n`,
        );
    } finally {
      await client.disconnect();
    }
  });

/** Read input from a path, "-" (stdin), or stdin when unspecified. */
function readBody(input?: string): string {
  if (!input || input === "-") return readFileSync(0, "utf-8");
  return readFileSync(input, "utf-8");
}

function resolveTimelineApplyLockPath(input?: string, lock?: string): string | null {
  if (lock) return resolveTimelineLockPath({ cwd: process.cwd(), lock });
  if (!input || input === "-") return null;
  return resolveTimelineLockPath({ cwd: process.cwd(), file: input });
}

function readTimelineLockForApply(lockPath: string | null): TimelineLock {
  if (!lockPath) {
    console.error("Missing timeline CAS lock. Push from stdin requires --lock, or pass --force to intentionally overwrite.");
    process.exit(1);
  }
  try {
    return parseTimelineLock(readFileSync(lockPath, "utf-8"));
  } catch (error) {
    console.error(`Failed to read timeline CAS lock at ${lockPath}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** Read one node via daemon if possible, otherwise one-shot LoroSync. */
async function readNode(
  projectId: string,
  nodeId: string,
): Promise<{ type: string; data: Record<string, unknown> } | null> {
  const daemonResult = await runCommand(projectId, { action: "get", nodeId });
  if (daemonResult) {
    if (daemonResult.error) return null;
    return daemonResult.node ?? null;
  }
  const client = await connectToProject(projectId);
  try {
    const node = client.readNode(nodeId);
    return node ? { type: node.type, data: node.data as Record<string, unknown> } : null;
  } finally {
    await client.disconnect();
  }
}

// ─── update ───────────────────────────────────────────────

canvasCommand
  .command("update")
  .description("Update a node's data")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--node <id>", "Node ID")
  .option("--label <label>", "New label")
  .option("--content <content>", "New content")
  .option("--asset-id <id>", "Bind an existing asset (image/video/audio) to this node — its preview will render")
  .option("--if-match <readToken>", "Require the node read token from `clash canvas get --json` before writing")
  .option("--force", "Bypass the agent read-token check only; content/checkpoint guardrails still apply")
  .option(
    "--data <key=value...>",
    "Arbitrary node-data field (repeatable). Example: --data status=completed --data description='hello'",
    (val: string, prev: Array<[string, string]>) => {
      const eq = val.indexOf("=");
      if (eq < 0) throw new Error(`--data expects key=value, got: ${val}`);
      return [...(prev ?? []), [val.slice(0, eq), val.slice(eq + 1)] as [string, string]];
    },
    [] as Array<[string, string]>,
  )
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const extraData: Record<string, unknown> = {};
    if (options.assetId) extraData.assetId = options.assetId;
    for (const [k, v] of (options.data ?? [])) extraData[k] = v;
    const guard = validateCanvasUpdateDataFields(Object.keys(extraData));
    if (!guard.ok) {
      console.error(`Error: ${guard.error}`);
      process.exit(1);
    }
    if (
      Object.keys(extraData).length === 0 &&
      typeof options.label !== "string" &&
      typeof options.content !== "string"
    ) {
      console.error("Provide at least one field to update (--label, --content, --asset-id, --data k=v)");
      process.exit(1);
    }

    const daemonResult = await runCommand(projectId, {
      action: "update",
      nodeId: options.node,
      label: options.label,
      content: options.content,
      data: Object.keys(extraData).length ? extraData : undefined,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      ifMatch: options.ifMatch,
      force: options.force === true,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else console.log(`Updated node: ${options.node}`);
      return;
    }
    const hostWrite = assertAgentHostWritePath({
      actorClientType: resolveCanvasPresenceOptions().clientType,
      force: options.force === true,
      operation: "canvas update",
      readCommand: "clash canvas get --json",
    });
    if (!hostWrite.ok) { console.error(hostWrite.error); process.exit(1); }

    const client = await connectToProject(projectId);
    try {
      const updates: Record<string, unknown> = { ...extraData };
      if (typeof options.label === "string") updates.label = options.label;
      if (typeof options.content === "string") updates.content = options.content;
      const node = client.readNode(options.node);
      if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      const readProof = validateCanvasReadProof({
        operation: "update",
        actorClientType: resolveCanvasPresenceOptions().clientType,
        node,
        expectedReadToken: options.ifMatch,
        force: options.force === true,
      });
      if (!readProof.ok) { console.error(readProof.error); process.exit(1); }
      const edges = client.canvas.listEdges();
      const contentGuard = validateCanvasContentPatch({
        nodeId: options.node,
        node: { type: node.type },
        nodes: client.listNodes(),
        edges,
        hasContentPatch: typeof updates.content === "string",
      });
      if (!contentGuard.ok) { console.error(contentGuard.error); process.exit(1); }
      const mediaGuard = validateCanvasMediaAssetPatch({
        nodeId: options.node,
        node: { type: node.type, data: node.data as Record<string, unknown> },
        edges,
        hasAssetIdPatch: Object.prototype.hasOwnProperty.call(updates, "assetId"),
        nextAssetId: updates.assetId,
      });
      if (!mediaGuard.ok) { console.error(mediaGuard.error); process.exit(1); }
      const checkpointGuard = validateCanvasCheckpointPatch({
        nodeId: options.node,
        node: { type: node.type, data: node.data as Record<string, unknown> },
        nodes: client.listNodes(),
        edges,
        fields: Object.keys(updates),
      });
      if (!checkpointGuard.ok) { console.error(checkpointGuard.error); process.exit(1); }
      const ok = client.updateNode(options.node, updates);
      if (!ok) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      const updatedNode = client.readNode(options.node);
      if (isJsonMode(options)) printJson({
        updated: true,
        nodeId: options.node,
        ...(updatedNode ? { readToken: canvasNodeReadToken(updatedNode) } : {}),
        ...(options.force === true ? { forced: true } : {}),
      });
      else console.log(`Updated node: ${options.node}`);
    } finally {
      await client.disconnect();
    }
  });

// ─── replace asset ────────────────────────────────────────

canvasCommand
  .command("replace-asset")
  .description("Create a copy-on-write media node with a replacement immutable asset")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--node <id>", "Source image/video/audio node ID")
  .requiredOption("--asset <assetId>", "Replacement immutable asset ID")
  .option("--if-match <readToken>", "Require the source node read token from `clash canvas get --json` before forking")
  .option("--new-node <id>", "Optional node ID for the copied media node")
  .option("--label <label>", "Optional label for the copied media node")
  .option("--force", "Bypass the agent read-token check")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const result = await replaceCanvasAssetNode({
        project: options.project,
        nodeId: options.node,
        assetId: options.asset,
        ifMatch: options.ifMatch,
        newNode: options.newNode,
        label: options.label,
        force: options.force === true,
      });
      if (isJsonMode(options)) printJson(result);
      else console.log(`Created copy-on-write media node: ${result.newNodeId}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// ─── delete ───────────────────────────────────────────────

canvasCommand
  .command("delete-batch")
  .description("Delete multiple canvas nodes atomically with a graph-aware CAS token")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--node <id>", "Node ID to delete; repeat for multiple nodes", collectNodeOption, [] as string[])
  .option("--yes", "Confirm deletion without an interactive prompt")
  .option("--force", "Delete even if the batch would orphan downstream references or bypass the agent read-token check")
  .option("--if-match <readToken>", "Require the batch read token from `clash canvas delete-plan --json` before deleting")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const nodeIds = normalizeNodeIds(options.node);
    if (nodeIds.length === 0) {
      console.error("Provide at least one --node <id>");
      process.exit(1);
    }
    const confirmation = requireDestructiveConfirmation(
      options,
      `canvas node batch ${nodeIds.join(",")}`,
    );
    if (!confirmation.ok) {
      console.error(`Error: ${confirmation.error}`);
      process.exit(1);
    }

    const projectId = await resolveCanvasProjectId(options);
    const daemonResult = await runCommand(projectId, {
      action: "delete_batch",
      nodeIds,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      ifMatch: options.ifMatch,
      force: options.force === true,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) printJson(daemonResult);
      else {
        console.log(`Deleted node batch: ${nodeIds.join(", ")}`);
        if (daemonResult.forced && Array.isArray(daemonResult.orphanedReferences) && daemonResult.orphanedReferences.length > 0) {
          console.log(`Forced: orphaned downstream refs ${daemonResult.orphanedReferences.join(", ")}`);
        }
      }
      return;
    }

    const hostWrite = assertAgentHostWritePath({
      actorClientType: resolveCanvasPresenceOptions().clientType,
      force: options.force === true,
      operation: "canvas batch delete",
      readCommand: "clash canvas delete-plan --node <id> --node <id> --json",
    });
    if (!hostWrite.ok) { console.error(hostWrite.error); process.exit(1); }

    const client = await connectToProject(projectId);
    try {
      const plan = readCanvasBatchDeletePlan(client, nodeIds);
      const readProof = validateCanvasBatchDeleteReadProof({
        actorClientType: resolveCanvasPresenceOptions().clientType,
        nodes: plan.nodes,
        edges: plan.edges,
        expectedReadToken: options.ifMatch,
        force: options.force === true,
      });
      if (!readProof.ok) { console.error(readProof.error); process.exit(1); }
      const guardrailEdges = canvasGuardrailEdgesFromReadProof(plan.edges);
      const deleteGuard = validateCanvasBatchDelete({
        nodeIds: plan.nodeIds,
        edges: guardrailEdges,
        force: options.force === true,
      });
      if (!deleteGuard.ok) { console.error(deleteGuard.error); process.exit(1); }
      const orphanedReferences = plan.nodeIds.flatMap((nodeId) => canvasDownstreamTargets(nodeId, guardrailEdges));
      const result = client.deleteNodes(plan.nodeIds);
      if (result.deletedNodeIds.length === 0) {
        console.error(`Node(s) not found: ${plan.nodeIds.join(", ")}`);
        process.exit(1);
      }
      const payload = {
        deleted: true,
        nodeIds: plan.nodeIds,
        deletedNodeIds: result.deletedNodeIds,
        deletedEdgeIds: result.deletedEdgeIds,
        ...(options.force === true ? { forced: true, orphanedReferences } : {}),
      };
      if (isJsonMode(options)) printJson(payload);
      else {
        console.log(`Deleted node batch: ${plan.nodeIds.join(", ")}`);
        if (options.force === true && orphanedReferences.length > 0) {
          console.log(`Forced: orphaned downstream refs ${orphanedReferences.join(", ")}`);
        }
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    } finally {
      await client.disconnect();
    }
  });

canvasCommand
  .command("delete")
  .description("Delete a node")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--node <id>", "Node ID")
  .option("--yes", "Confirm deletion without an interactive prompt")
  .option("--force", "Delete even if this node has downstream references")
  .option("--if-match <readToken>", "Require the node read token from `clash canvas get --json` before deleting")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const confirmation = requireDestructiveConfirmation(
      options,
      `canvas node ${options.node}`,
    );
    if (!confirmation.ok) {
      console.error(`Error: ${confirmation.error}`);
      process.exit(1);
    }

    const projectId = await resolveCanvasProjectId(options);
    const daemonResult = await runCommand(projectId, {
      action: "delete",
      nodeId: options.node,
      actorClientType: resolveCanvasPresenceOptions().clientType,
      ifMatch: options.ifMatch,
      force: options.force === true,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) { printJson(daemonResult); }
      else {
        console.log(`Deleted node: ${options.node}`);
        if (daemonResult.forced && Array.isArray(daemonResult.orphanedReferences) && daemonResult.orphanedReferences.length > 0) {
          console.log(`Forced: orphaned downstream refs ${daemonResult.orphanedReferences.join(", ")}`);
        }
      }
      return;
    }
    const hostWrite = assertAgentHostWritePath({
      actorClientType: resolveCanvasPresenceOptions().clientType,
      force: options.force === true,
      operation: "canvas delete",
      readCommand: "clash canvas get --json",
    });
    if (!hostWrite.ok) { console.error(hostWrite.error); process.exit(1); }

    const client = await connectToProject(projectId);
    try {
      const node = client.readNode(options.node);
      if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      const readProof = validateCanvasReadProof({
        operation: "delete",
        actorClientType: resolveCanvasPresenceOptions().clientType,
        node,
        expectedReadToken: options.ifMatch,
        force: options.force === true,
      });
      if (!readProof.ok) { console.error(readProof.error); process.exit(1); }
      const edges = client.canvas.listEdges();
      const deleteGuard = validateCanvasDelete({
        nodeId: options.node,
        edges,
        force: options.force === true,
      });
      if (!deleteGuard.ok) { console.error(deleteGuard.error); process.exit(1); }
      const orphanedReferences = canvasDownstreamTargets(options.node, edges);
      const ok = client.deleteNode(options.node);
      if (!ok) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      const payload = {
        deleted: true,
        nodeId: options.node,
        ...(options.force === true ? { forced: true, orphanedReferences } : {}),
      };
      if (isJsonMode(options)) printJson(payload);
      else {
        console.log(`Deleted node: ${options.node}`);
        if (options.force === true && orphanedReferences.length > 0) {
          console.log(`Forced: orphaned downstream refs ${orphanedReferences.join(", ")}`);
        }
      }
    } finally {
      await client.disconnect();
    }
  });

// ─── search ───────────────────────────────────────────────

canvasCommand
  .command("search")
  .description("Search nodes by content")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--query <query>", "Search query")
  .option("--type <types>", "Comma-separated node types to filter")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const projectId = await resolveCanvasProjectId(options);
    const daemonResult = await runCommand(projectId, {
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

    const client = await connectToProject(projectId);
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
