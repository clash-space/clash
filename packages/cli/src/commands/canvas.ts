import { Command } from "commander";
import WebSocket from "ws";
import { chmodSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  LoroSyncClient, DEFAULT_CANVAS_ID,
  parsePromptParts, extractAssetRefs,
  createMediaAssetCowNodeData,
  ExecutablePluginBindingSchema,
  MODEL_CARDS,
  coerceModelParameterInput,
  normalizeModelId,
  isMediaNodeType,
} from "@clash/shared-types";
import { requireApiKey, getServerUrl } from "../lib/config";
import { isJsonMode, printJson } from "../lib/output";
import { isDaemonRunning, sendCommand, startDaemon, getSocketPath, getDaemonMcpEndpoint } from "../lib/daemon";
import { apiFetch, apiJson } from "../lib/api";
import { resolveClashRoot } from "../lib/clash-home";
import { resolveProjectContext, type ResolvedProjectContext } from "../lib/project-context";
import { assertAgentHostWritePath } from "../lib/agent-host-write";
import { publicAgentCommandResult } from "../lib/agent-worktree-observation";
import {
  forgetWorktreeObservation,
  recordWorktreeObservation,
  requireWorktreeObservation,
} from "../lib/worktree-observations";
import {
  canvasBatchDeleteReadToken,
  canvasEdgesReadToken,
  canvasNodeReadToken,
  isCanvasNodeImmutable,
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

export async function resolveInstalledPluginAction(options: {
  actionId: string;
  serverUrl?: string;
  apiKey?: string;
  request?: typeof fetch;
}): Promise<{
  id: string;
  outputType?: "image" | "video" | "audio" | "text";
  pluginBinding: ReturnType<typeof ExecutablePluginBindingSchema.parse>;
  pluginPermissions?: unknown;
  definition: Record<string, unknown>;
} | null> {
  const serverUrl = options.serverUrl ?? getServerUrl();
  const apiKey = options.apiKey ?? requireApiKey(serverUrl);
  const response = await (options.request ?? fetch)(`${serverUrl}/api/v1/plugin-actions`, {
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });
  if (!response.ok) return null;
  const body = await response.json() as { actions?: unknown[] };
  for (const value of body.actions ?? []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const action = value as Record<string, unknown>;
    if (action.id !== options.actionId) continue;
    const binding = ExecutablePluginBindingSchema.safeParse(action.pluginBinding);
    if (!binding.success) continue;
    const outputType = action.outputType === "image" || action.outputType === "video"
      || action.outputType === "audio" || action.outputType === "text"
      ? action.outputType
      : undefined;
    return {
      id: options.actionId,
      ...(outputType ? { outputType } : {}),
      pluginBinding: binding.data,
      ...(action.pluginPermissions ? { pluginPermissions: action.pluginPermissions } : {}),
      definition: action,
    };
  }
  return null;
}

let activeCanvasId = DEFAULT_CANVAS_ID;

export function resolveCanvasCommandCanvasId(options: { canvas?: string } = {}): string {
  return options.canvas?.trim() || process.env.CLASH_CANVAS_ID?.trim() || DEFAULT_CANVAS_ID;
}

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
 *   - User-driven (default): resolve the local/remote product user through
 *     /api/v1/me, then stamp `{actorType:'user', actorUserId:<user>}`.
 *   - Agent-driven: the CLI was launched by the bridge daemon as the
 *     subprocess of an ACP agent. Bridge stamps
 *     CLASH_AGENT_MEMBER_ID into the env. We stamp `{actorType:'agent',
 *     actorAgentId:<cm>, actorUserId:<owner>}` so the resulting node
 *     attributes back to the human accountable for it.
 *
 * Both lookups go through the same /api/v1/me endpoint — agent-driven
 * just additionally carries the agent member id from the env.
 */
export async function resolveCanvasActor(
  env: Record<string, string | undefined> = process.env,
): Promise<CanvasActor> {
  const configuredUserId = env.CLASH_USER_ID?.trim();
  const configuredAgentId = env.CLASH_AGENT_MEMBER_ID?.trim();
  if (configuredUserId) {
    return configuredAgentId
      ? { actorType: "agent", actorUserId: configuredUserId, actorAgentId: configuredAgentId }
      : { actorType: "user", actorUserId: configuredUserId };
  }
  const me = await apiJson<{ id: string }>("/api/v1/me").catch((e) => {
    throw new Error(`Failed to resolve the current Clash user: ${e instanceof Error ? e.message : String(e)}`);
  });
  const agentMemberId = configuredAgentId;
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
  return (await resolveCanvasProjectContext(options)).projectId;
}

export async function resolveCanvasProjectContext(options: {
  project?: string;
  cwd?: string;
  env?: Record<string, string | undefined>;
} = {}): Promise<ResolvedProjectContext> {
  try {
    return await resolveProjectContext(options);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

function agentClientType(): "cli" | "agent" {
  return resolveCanvasPresenceOptions().clientType;
}

async function recordCanvasObservation(options: {
  context: ResolvedProjectContext;
  entityKind: string;
  entityId: string;
  revision: unknown;
}): Promise<void> {
  if (agentClientType() !== "agent") return;
  if (!options.context.workspaceRoot) {
    throw new Error("Agent reads require a cwd linked through .clash/project.toml.");
  }
  if (typeof options.revision !== "string" || !options.revision.trim()) {
    throw new Error("Host read did not return an entity version.");
  }
  const revision = options.revision.trim();
  await recordWorktreeObservation({
    workspaceRoot: options.context.workspaceRoot,
    projectId: options.context.projectId,
    entityKind: options.entityKind,
    entityId: options.entityId,
    revision,
  });
}

async function requireCanvasObservation(options: {
  context: ResolvedProjectContext;
  entityKind: string;
  entityId: string;
}): Promise<string | undefined> {
  if (agentClientType() !== "agent") return undefined;
  if (!options.context.workspaceRoot) {
    throw new Error("READ_REQUIRED: Run the command from a cwd linked through .clash/project.toml and read the target first.");
  }
  const observation = await requireWorktreeObservation({
    workspaceRoot: options.context.workspaceRoot,
    projectId: options.context.projectId,
    entityKind: options.entityKind,
    entityId: options.entityId,
  });
  if (!observation.ok) throw new Error(`${observation.code}: ${observation.error}`);
  return observation.revision;
}

async function forgetCanvasObservation(options: {
  context: ResolvedProjectContext;
  entityKind: string;
  entityId: string;
}): Promise<void> {
  if (agentClientType() !== "agent" || !options.context.workspaceRoot) return;
  await forgetWorktreeObservation({
    workspaceRoot: options.context.workspaceRoot,
    projectId: options.context.projectId,
    entityKind: options.entityKind,
    entityId: options.entityId,
  });
}

function publicMutationResult(value: Record<string, unknown>): Record<string, unknown> {
  return publicAgentCommandResult(value);
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
    canvasId: activeCanvasId,
    token: apiKey,
    ...resolveCanvasPresenceOptions(),
    WebSocket: WebSocket as any,
  });

  await client.connect();
  client.selectCanvas(activeCanvasId);
  return client;
}

async function registerInstalledPluginAction(
  projectId: string,
  action: { id: string; definition: Record<string, unknown> },
): Promise<void> {
  const client = await connectToProject(projectId);
  try {
    client.doc.getMap("customActions").set(action.id, action.definition);
    client.doc.commit({ origin: "cli:install-plugin-action" });
    await new Promise((resolve) => setTimeout(resolve, 100));
  } finally {
    await client.disconnect();
  }
}

/**
 * Run a command via daemon if running, otherwise fall back to one-shot connection.
 */
async function runCommand(projectId: string, cmd: object): Promise<any> {
  if (isDaemonRunning(projectId)) {
    return sendCommand(projectId, { ...cmd, canvasId: activeCanvasId });
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
  return client.canvas.listEdges().map((edge) => ({ ...edge }));
}

function listCanvasEdgesWithVersion(client: LoroSyncClient): { edges: CanvasReadProofEdgeLike[]; version: string } {
  const baseEdges = listCanvasReadProofEdges(client);
  return { edges: baseEdges, version: canvasEdgesReadToken(baseEdges) };
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
  newNode?: string;
  label?: string;
}): Promise<Record<string, unknown>> {
  const context = await resolveCanvasProjectContext({ project: options.project });
  const projectId = context.projectId;
  const assetId = String(options.assetId ?? "").trim();
  if (!assetId) throw new Error("asset id is required");
  const observedVersion = await requireCanvasObservation({
    context,
    entityKind: "canvas-node",
    entityId: options.nodeId,
  });

  const daemonResult = await runCommand(projectId, {
    action: "asset_cow_replace",
    nodeId: options.nodeId,
    assetId,
    newNodeId: options.newNode,
    label: options.label,
    actorClientType: agentClientType(),
    observedVersion,
    ifMatch: observedVersion,
  });
  if (daemonResult) {
    if (daemonResult.error) throw new Error(daemonResult.error);
    await recordCanvasObservation({
      context,
      entityKind: "canvas-node",
      entityId: String(daemonResult.newNodeId ?? daemonResult.nodeId),
      revision: daemonResult.readToken ?? daemonResult.version,
    });
    return publicMutationResult(daemonResult);
  }
  const hostWrite = assertAgentHostWritePath({
    actorClientType: resolveCanvasPresenceOptions().clientType,
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
      console.log(JSON.stringify({
        status: "already_running",
        socket: getSocketPath(projectId),
        mcp: getDaemonMcpEndpoint(projectId),
      }));
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
  .description("List canvas edges")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const daemonResult = await runCommand(projectId, { action: "edges" });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      const edges = Array.isArray(daemonResult.edges) ? daemonResult.edges : [];
      await recordCanvasObservation({
        context,
        entityKind: "canvas-edges",
        entityId: "graph",
        revision: daemonResult.readToken ?? daemonResult.version,
      });
      if (isJsonMode(options)) { printJson(edges); }
      else {
        for (const edge of edges) {
          console.log(`${edge.id}  ${edge.source} -> ${edge.target}`);
        }
        console.log(`\n${edges.length} edge(s)`);
      }
      return;
    }

    const client = await connectToProject(projectId);
    try {
      const { edges, version } = listCanvasEdgesWithVersion(client);
      await recordCanvasObservation({
        context,
        entityKind: "canvas-edges",
        entityId: "graph",
        revision: version,
      });
      if (isJsonMode(options)) {
        printJson(edges);
      } else if (edges.length === 0) {
        console.log("No edges found.");
      } else {
        for (const edge of edges) {
          console.log(`${edge.id}  ${edge.source} -> ${edge.target}`);
        }
        console.log(`\n${edges.length} edge(s)`);
      }
    } finally {
      await client.disconnect();
    }
  });

canvasCommand
  .command("delete-plan")
  .description("Read a graph-aware batch delete plan")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--node <id>", "Node ID to include in the delete batch; repeat for multiple nodes", collectNodeOption, [] as string[])
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const nodeIds = normalizeNodeIds(options.node);
    if (nodeIds.length === 0) {
      console.error("Provide at least one --node <id>");
      process.exit(1);
    }

    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const batchId = nodeIds.join(",");
    const daemonResult = await runCommand(projectId, {
      action: "batch_delete_plan",
      nodeIds,
      actorClientType: resolveCanvasPresenceOptions().clientType,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      await recordCanvasObservation({
        context,
        entityKind: "canvas-node-batch",
        entityId: batchId,
        revision: daemonResult.readToken ?? daemonResult.version,
      });
      if (isJsonMode(options)) printJson(publicMutationResult(daemonResult));
      else {
        console.log(`Batch delete plan: ${daemonResult.nodeIds?.join(", ") ?? nodeIds.join(", ")}`);
      }
      return;
    }

    const client = await connectToProject(projectId);
    try {
      const plan = readCanvasBatchDeletePlan(client, nodeIds);
      await recordCanvasObservation({
        context,
        entityKind: "canvas-node-batch",
        entityId: batchId,
        revision: plan.readToken,
      });
      if (isJsonMode(options)) {
        const { readToken: _readToken, ...publicPlan } = plan;
        printJson(publicPlan);
      }
      else {
        console.log(`Batch delete plan: ${plan.nodeIds.join(", ")}`);
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
  console.log(`Immutable: ${n.immutable === true ? "yes" : "no"}`);
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
    let observation: string | null = null;
    let immutable = false;

    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const daemonResult = await runCommand(projectId, {
      action: "get",
      projectId,
      nodeId: options.node,
      actorClientType: agentClientType(),
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      node = daemonResult.node;
      immutable = daemonResult.immutable === true;
      observation = typeof daemonResult.readToken === "string"
        ? daemonResult.readToken
        : typeof daemonResult.version === "string"
          ? daemonResult.version
          : null;
    } else {
      const client = await connectToProject(projectId);
      try {
        node = client.readNode(options.node);
        if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
        immutable = isCanvasNodeImmutable({ nodeId: options.node, edges: client.canvas.listEdges() });
      } finally {
        await client.disconnect();
      }
    }
    observation = observation ?? canvasNodeReadToken(node);
    await recordCanvasObservation({
      context,
      entityKind: "canvas-node",
      entityId: options.node,
      revision: observation,
    });

    // For media nodes, download the asset via D1 assetId.
    const assetId = typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
    const isMedia = ["image", "video", "audio"].includes(node.type);
    let assetPath: string | null = null;
    if (isMedia && assetId) {
      assetPath = await downloadAssetById(assetId);
    }

    if (isJsonMode(options)) {
      printJson({ ...node, immutable: immutable === true, ...(assetPath ? { assetPath } : {}) });
    } else {
      printNodeInfo({ ...node, immutable: immutable === true });
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

export function modelParamsFromEntries(
  modelId: string | undefined,
  entries: Array<[string, string]>,
): Record<string, string | number | boolean> {
  const normalizedModelId = normalizeModelId(modelId) ?? modelId;
  const card = MODEL_CARDS.find((candidate) => candidate.id === normalizedModelId);
  const params: Record<string, string | number | boolean> = {};
  for (const [key, raw] of entries) {
    const value = coerceParamValue(raw);
    params[key] = card ? coerceModelParameterInput(card, key, value) : value;
  }
  return params;
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
  .description("Add a text, group, Remotion component, or action-badge node")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--type <type>", "Node type: text, group, remotion, image_gen, video_gen, audio_gen, text_gen")
  .requiredOption("--label <label>", "Node label")
  .option("--prompt <text>", "Generation prompt for *_gen nodes. May contain `@[Label](node:<id>)` mentions to reference canvas asset nodes; type partitioning is automatic from the referenced asset's kind.")
  .option("--content <content>", "Body content for text / group nodes or single-file Remotion TSX for remotion nodes. Ignored for *_gen nodes — use --prompt there.")
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
    const installedPluginAction = isCustomAction
      ? await resolveInstalledPluginAction({ actionId: options.action })
      : null;
    if (installedPluginAction) {
      await registerInstalledPluginAction(projectId, installedPluginAction);
    }

    if (isGenNode) {
      if (isCustomAction) {
        // Custom action: actionType becomes `custom:<id>`, and the
        // executor reads customActionId / customActionParams / outputType
        // instead of modelId / modelParams. The output kind follows the
        // node type — `image_gen + --action grid-split` produces an
        // image-kinded pending child.
        extraData.actionType = `custom:${options.action}`;
        extraData.customActionId = options.action;
        const outputType = installedPluginAction?.outputType ?? (
          options.type === "video_gen" ? "video" :
          options.type === "audio_gen" ? "audio" :
          options.type === "text_gen"  ? "text"  : "image"
        );
        extraData.outputType = outputType;
        if (installedPluginAction) {
          extraData.pluginBinding = installedPluginAction.pluginBinding;
          if (installedPluginAction.pluginPermissions) {
            extraData.pluginPermissions = installedPluginAction.pluginPermissions;
          }
        }
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
      const params = modelParamsFromEntries(options.model, options.param);
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
    const persistedNodeType = options.type === "remotion" ? "remotion-component" : options.type;
    const daemonResult = await runCommand(projectId, {
      action: "add", type: persistedNodeType, label: options.label,
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
        console.log(`Created node: ${daemonResult.node_id} (${persistedNodeType})`);
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

      const result = client.createNode(nodeId, persistedNodeType, data, null, options.parent ?? null);
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
        console.log(`Created node: ${result.node_id} (${persistedNodeType})`);
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
      const r = client.canvas.execute(options.node, () => crypto.randomUUID().slice(0, 8));
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
    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    let observedVersion: string | undefined;
    try {
      observedVersion = await requireCanvasObservation({
        context,
        entityKind: "canvas-node",
        entityId: options.node,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
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
      actorClientType: agentClientType(),
      observedVersion,
      ifMatch: observedVersion,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      await recordCanvasObservation({
        context,
        entityKind: "canvas-node",
        entityId: options.node,
        revision: daemonResult.readToken ?? daemonResult.version,
      });
      if (isJsonMode(options)) { printJson(publicMutationResult(daemonResult)); }
      else console.log(`Updated node: ${options.node}`);
      return;
    }
    const hostWrite = assertAgentHostWritePath({
      actorClientType: resolveCanvasPresenceOptions().clientType,
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
      });
      else console.log(`Updated node: ${options.node}`);
    } finally {
      await client.disconnect();
    }
  });

canvasCommand
  .command("move")
  .description("Move a node to an absolute Canvas position")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--node <id>", "Node ID")
  .requiredOption("--x <number>", "Absolute Canvas x coordinate", Number)
  .requiredOption("--y <number>", "Absolute Canvas y coordinate", Number)
  .option("--json", "Output as JSON")
  .action(async (options) => {
    if (!Number.isFinite(options.x) || !Number.isFinite(options.y)) {
      console.error("Canvas move requires finite x and y coordinates");
      process.exit(1);
    }
    const projectId = await resolveCanvasProjectId(options);
    const position = { x: options.x, y: options.y };
    const daemonResult = await runCommand(projectId, {
      action: "move",
      nodeId: options.node,
      position,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      if (isJsonMode(options)) printJson(daemonResult);
      else console.log(`Moved node: ${options.node} (${options.x}, ${options.y})`);
      return;
    }

    const client = await connectToProject(projectId);
    try {
      const moved = client.canvas.moveNode(options.node, position);
      if (!moved) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      const result = { moved: true, nodeId: options.node, position };
      if (isJsonMode(options)) printJson(result);
      else console.log(`Moved node: ${options.node} (${options.x}, ${options.y})`);
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
  .option("--new-node <id>", "Optional node ID for the copied media node")
  .option("--label <label>", "Optional label for the copied media node")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    try {
      const result = await replaceCanvasAssetNode({
        project: options.project,
        nodeId: options.node,
        assetId: options.asset,
        newNode: options.newNode,
        label: options.label,
      });
      if (isJsonMode(options)) printJson(result);
      else console.log(`Created copy-on-write media node: ${result.newNodeId}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

canvasCommand
  .command("copy")
  .description("Create a mutable copy of a node while preserving existing downstream references")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .requiredOption("--node <id>", "Source node ID")
  .option("--new-node <id>", "Optional node ID for the copy")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const context = await resolveCanvasProjectContext(options);
    const observedVersion = await requireCanvasObservation({
      context,
      entityKind: "canvas-node",
      entityId: options.node,
    });
    const daemonResult = await runCommand(context.projectId, {
      action: "copy_node",
      nodeId: options.node,
      newNodeId: options.newNode,
      actorClientType: agentClientType(),
      observedVersion,
      ifMatch: observedVersion,
    });
    if (daemonResult) {
      if (daemonResult.error) {
        console.error(daemonResult.error);
        process.exit(1);
      }
      await recordCanvasObservation({
        context,
        entityKind: "canvas-node",
        entityId: String(daemonResult.newNodeId ?? daemonResult.nodeId),
        revision: daemonResult.readToken ?? daemonResult.version,
      });
      if (isJsonMode(options)) printJson(publicMutationResult(daemonResult));
      else console.log(`Created copy-on-write node: ${daemonResult.newNodeId}`);
      return;
    }

    const hostWrite = assertAgentHostWritePath({
      actorClientType: agentClientType(),
      operation: "canvas copy",
      readCommand: "clash canvas get --json",
    });
    console.error(hostWrite.ok ? "Canvas copy requires the local host daemon." : hostWrite.error);
    process.exit(1);
  });

// ─── delete ───────────────────────────────────────────────

canvasCommand
  .command("delete-batch")
  .description("Delete multiple canvas nodes atomically after reading a graph-aware plan")
  .option("--project <id>", "Project ID (defaults to cwd marker or $CLASH_PROJECT_ID)")
  .option("--node <id>", "Node ID to delete; repeat for multiple nodes", collectNodeOption, [] as string[])
  .option("--yes", "Confirm deletion without an interactive prompt")
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

    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    const batchId = nodeIds.join(",");
    let observedVersion: string | undefined;
    try {
      observedVersion = await requireCanvasObservation({
        context,
        entityKind: "canvas-node-batch",
        entityId: batchId,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const daemonResult = await runCommand(projectId, {
      action: "delete_batch",
      nodeIds,
      actorClientType: agentClientType(),
      observedVersion,
      ifMatch: observedVersion,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      await forgetCanvasObservation({ context, entityKind: "canvas-node-batch", entityId: batchId });
      for (const nodeId of nodeIds) {
        await forgetCanvasObservation({ context, entityKind: "canvas-node", entityId: nodeId });
      }
      if (isJsonMode(options)) printJson(publicMutationResult(daemonResult));
      else {
        console.log(`Deleted node batch: ${nodeIds.join(", ")}`);
      }
      return;
    }

    const hostWrite = assertAgentHostWritePath({
      actorClientType: resolveCanvasPresenceOptions().clientType,
      operation: "canvas batch delete",
      readCommand: "clash canvas delete-plan --node <id> --node <id> --json",
    });
    if (!hostWrite.ok) { console.error(hostWrite.error); process.exit(1); }

    const client = await connectToProject(projectId);
    try {
      const plan = readCanvasBatchDeletePlan(client, nodeIds);
      const guardrailEdges = canvasGuardrailEdgesFromReadProof(plan.edges);
      const deleteGuard = validateCanvasBatchDelete({
        nodeIds: plan.nodeIds,
        edges: guardrailEdges,
      });
      if (!deleteGuard.ok) { console.error(deleteGuard.error); process.exit(1); }
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
      };
      if (isJsonMode(options)) printJson(payload);
      else {
        console.log(`Deleted node batch: ${plan.nodeIds.join(", ")}`);
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

    const context = await resolveCanvasProjectContext(options);
    const projectId = context.projectId;
    let observedVersion: string | undefined;
    try {
      observedVersion = await requireCanvasObservation({
        context,
        entityKind: "canvas-node",
        entityId: options.node,
      });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
    const daemonResult = await runCommand(projectId, {
      action: "delete",
      nodeId: options.node,
      actorClientType: agentClientType(),
      observedVersion,
      ifMatch: observedVersion,
    });
    if (daemonResult) {
      if (daemonResult.error) { console.error(daemonResult.error); process.exit(1); }
      await forgetCanvasObservation({ context, entityKind: "canvas-node", entityId: options.node });
      if (isJsonMode(options)) { printJson(publicMutationResult(daemonResult)); }
      else {
        console.log(`Deleted node: ${options.node}`);
      }
      return;
    }
    const hostWrite = assertAgentHostWritePath({
      actorClientType: resolveCanvasPresenceOptions().clientType,
      operation: "canvas delete",
      readCommand: "clash canvas get --json",
    });
    if (!hostWrite.ok) { console.error(hostWrite.error); process.exit(1); }

    const client = await connectToProject(projectId);
    try {
      const node = client.readNode(options.node);
      if (!node) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      const edges = client.canvas.listEdges();
      const deleteGuard = validateCanvasDelete({
        nodeId: options.node,
        edges,
      });
      if (!deleteGuard.ok) { console.error(deleteGuard.error); process.exit(1); }
      const ok = client.deleteNode(options.node);
      if (!ok) { console.error(`Node not found: ${options.node}`); process.exit(1); }
      const payload = {
        deleted: true,
        nodeId: options.node,
      };
      if (isJsonMode(options)) printJson(payload);
      else {
        console.log(`Deleted node: ${options.node}`);
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

for (const command of canvasCommand.commands) {
  if (!command.options.some((option) => option.long === "--canvas")) {
    command.option("--canvas <id>", "Canvas ID (defaults to main or $CLASH_CANVAS_ID)");
  }
}

canvasCommand.hook("preAction", (_command, actionCommand) => {
  activeCanvasId = resolveCanvasCommandCanvasId(actionCommand.opts());
});
