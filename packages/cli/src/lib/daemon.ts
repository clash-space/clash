/**
 * Canvas daemon — maintains a persistent WebSocket connection to a ProjectRoom.
 * Listens on a Unix socket for commands from CLI invocations.
 * Auto-exits after IDLE_TIMEOUT_MS of inactivity.
 */

import { createServer, createConnection, type Server } from "node:net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHmac, randomBytes } from "node:crypto";
import WebSocket from "ws";
import {
  agentReadReceiptToken,
  LoroSyncClient,
  Canvas,
  createMediaAssetCowNodeData,
  isMediaNodeType,
  validateAgentReadProof,
  type AgentReadReceiptProof,
  type LoroSyncClientOptions,
} from "@clash/shared-types";
import { CliActionsHost, readBridgeRuntimeId, type ActionsHostEnv } from "./actions-host";
import { resolveClashRoot } from "./clash-home";
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
  validateCanvasEdgeAdd,
  validateCanvasMediaAssetPatch,
  validateCanvasReadProof,
  validateCanvasUpdateDataFields,
  type CanvasReadProofEdgeLike,
} from "./canvas-update-guardrails";
import {
  assertTimelineCas,
  assertTimelineNotMaterializedReferenced,
  createTimelineAppliedRevision,
  createTimelineCowNodeData,
  createTimelineLockFromHash,
  normalizeTimelineDslForYaml,
  readLoroRevisionMetadata,
  timelineHash,
  timelineReadToken,
  type TimelineLock,
  type TimelineRevisionActor,
} from "./timeline-projection";
import {
  assertTextCas,
  assertTextNotReferenced,
  createTextAppliedRevision,
  createTextCowNodeData,
  createTextLockFromHash,
  textHash,
  textReadToken,
  textContentFromNode,
  type TextLock,
  type TextRevisionActor,
} from "./text-projection";
import {
  hostMutationRejected,
  hostMutationSucceeded,
  validateHostMutationEnvelope,
} from "./host-mutation-envelope";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
const DAEMON_READ_RECEIPT_SECRET = randomBytes(32).toString("hex");

export type DaemonPresenceOptions = Pick<
  LoroSyncClientOptions,
  "clientType" | "userId" | "userName" | "agentName"
>;

export function daemonSocketDir(env: Record<string, string | undefined> = process.env): string {
  return join(resolveClashRoot(env), "sockets");
}

export function getSocketPath(projectId: string): string {
  return join(daemonSocketDir(), `${projectId}.sock`);
}

function getPidPath(projectId: string): string {
  return join(daemonSocketDir(), `${projectId}.pid`);
}

/**
 * Check if a daemon is already running for this project.
 */
export function isDaemonRunning(projectId: string): boolean {
  const pidPath = getPidPath(projectId);
  if (!existsSync(pidPath)) return false;

  try {
    const pid = parseInt(readFileSync(pidPath, "utf-8").trim(), 10);
    process.kill(pid, 0); // check if process exists
    return true;
  } catch {
    // Stale pid file — clean up
    cleanup(projectId);
    return false;
  }
}

function cleanup(projectId: string) {
  const sockPath = getSocketPath(projectId);
  const pidPath = getPidPath(projectId);
  try { unlinkSync(sockPath); } catch {}
  try { unlinkSync(pidPath); } catch {}
}

function daemonCanvasReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`canvas-node:${readToken}`)
    .digest("base64url");
}

function daemonCanvasEdgeReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`canvas-edge:${readToken}`)
    .digest("base64url");
}

function daemonCanvasEdgesReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`canvas-edges:${readToken}`)
    .digest("base64url");
}

function daemonCanvasBatchDeleteReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`canvas-batch-delete:${readToken}`)
    .digest("base64url");
}

function canvasNodeReceiptReadToken(node: Parameters<typeof canvasNodeReadToken>[0]): string {
  const readToken = canvasNodeReadToken(node);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonCanvasReadReceipt(readToken),
  });
}

function canvasEdgeReceiptReadToken(edge: Parameters<typeof canvasEdgeReadToken>[0]): string {
  const readToken = canvasEdgeReadToken(edge);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonCanvasEdgeReadReceipt(readToken),
  });
}

function canvasEdgesReceiptReadToken(edges: Parameters<typeof canvasEdgesReadToken>[0]): string {
  const readToken = canvasEdgesReadToken(edges);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonCanvasEdgesReadReceipt(readToken),
  });
}

function canvasBatchDeleteReceiptReadToken(options: Parameters<typeof canvasBatchDeleteReadToken>[0]): string {
  const readToken = canvasBatchDeleteReadToken(options);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonCanvasBatchDeleteReadReceipt(readToken),
  });
}

function verifyDaemonCanvasReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "node" &&
    proof.receipt === daemonCanvasReadReceipt(proof.baseReadToken);
}

function verifyDaemonCanvasBatchDeleteReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "canvas-batch-delete" &&
    proof.receipt === daemonCanvasBatchDeleteReadReceipt(proof.baseReadToken);
}

function daemonTextReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`text:${readToken}`)
    .digest("base64url");
}

function textNodeReceiptReadToken(options: {
  projectId: string;
  nodeId: string;
  content: string;
}): string {
  const readToken = textReadToken(options);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonTextReadReceipt(readToken),
  });
}

function verifyDaemonTextReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "text" &&
    proof.receipt === daemonTextReadReceipt(proof.baseReadToken);
}

function daemonTimelineReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`timeline:${readToken}`)
    .digest("base64url");
}

function timelineNodeReceiptReadToken(options: {
  projectId: string;
  nodeId: string;
  dsl: unknown;
}): string {
  const readToken = timelineReadToken({
    projectId: options.projectId,
    nodeId: options.nodeId,
    dsl: normalizeTimelineDslForYaml(options.dsl),
  });
  return agentReadReceiptToken({
    readToken,
    receipt: daemonTimelineReadReceipt(readToken),
  });
}

function verifyDaemonTimelineReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "timeline" &&
    proof.receipt === daemonTimelineReadReceipt(proof.baseReadToken);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function listCanvasEdgesWithReceiptReadTokens(client: LoroSyncClient): { edges: CanvasReadProofEdgeLike[]; readToken: string } {
  const edges = listCanvasReadProofEdges(client);
  return {
    edges: edges.map((edge) => ({
      ...edge,
      readToken: canvasEdgeReceiptReadToken(edge),
    })),
    readToken: canvasEdgesReceiptReadToken(edges),
  };
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

function readCanvasBatchDeletePlan(client: LoroSyncClient, nodeIds: unknown): {
  nodeIds: string[];
  nodes: NonNullable<ReturnType<LoroSyncClient["readNode"]>>[];
  edges: CanvasReadProofEdgeLike[];
  readToken: string;
} | { error: string } {
  if (!Array.isArray(nodeIds)) return { error: "delete batch requires nodeIds" };
  const uniqueNodeIds = [...new Set(nodeIds.map((nodeId) => String(nodeId ?? "").trim()).filter(Boolean))];
  if (uniqueNodeIds.length === 0) return { error: "delete batch requires at least one node id" };
  const nodes: NonNullable<ReturnType<LoroSyncClient["readNode"]>>[] = [];
  const missing: string[] = [];
  for (const nodeId of uniqueNodeIds) {
    const node = client.readNode(nodeId);
    if (!node) missing.push(nodeId);
    else nodes.push(node);
  }
  if (missing.length > 0) return { error: `Node(s) not found: ${missing.join(", ")}` };
  const edges = listCanvasReadProofEdges(client);
  return {
    nodeIds: uniqueNodeIds,
    nodes,
    edges,
    readToken: canvasBatchDeleteReceiptReadToken({ nodes, edges }),
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

/**
 * Send a command to a running daemon. Returns the JSON response.
 */
export function sendCommand(projectId: string, cmd: object): Promise<object> {
  return new Promise((resolve, reject) => {
    const sockPath = getSocketPath(projectId);
    const client = createConnection(sockPath);
    let data = "";

    client.on("connect", () => {
      client.write(JSON.stringify(cmd) + "\n");
    });

    client.on("data", (chunk) => {
      data += chunk.toString();
    });

    client.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error(`Invalid response: ${data}`));
      }
    });

    client.on("error", (err) => {
      reject(err);
    });

    client.setTimeout(15000, () => {
      client.destroy();
      reject(new Error("Daemon command timed out"));
    });
  });
}

export function buildActionsHostEnv(
  projectId: string,
  serverUrl: string,
  token: string,
  creds: { runtimeId: string; apiKey: string; serverUrl: string },
): ActionsHostEnv {
  return {
    serverUrl,
    apiKey: token || creds.apiKey,
    runtimeId: creds.runtimeId,
    projectId,
  };
}

/**
 * Start the daemon process. Blocks until shutdown.
 */
export async function startDaemon(
  projectId: string,
  serverUrl: string,
  token: string,
  presence: DaemonPresenceOptions = { clientType: "cli" },
): Promise<void> {
  // Ensure socket directory exists
  mkdirSync(daemonSocketDir(), { recursive: true });

  // Clean up stale files
  cleanup(projectId);

  // Connect to ProjectRoom
  const wsUrl = serverUrl.replace(/^http/, "ws");
  const client = new LoroSyncClient({
    serverUrl: wsUrl,
    projectId,
    token,
    ...presence,
    WebSocket: WebSocket as any,
  });

  await client.connect();

  // Custom-action host: spawns one python subprocess per
  // $CLASH_HOME/actions/<id>/manifest.json. Reuses the bridge's runtime_id
  // from credentials.json — same machine, same runtime row. If no
  // bridge has been set up, `creds` is null and we silently skip.
  const creds = readBridgeRuntimeId();
  let actionsHost: CliActionsHost | null = null;
  if (creds) {
    actionsHost = new CliActionsHost(buildActionsHostEnv(projectId, serverUrl, token, creds));
    try {
      const result = await actionsHost.start();
      if (result.spawned.length > 0) {
        process.stderr.write(
          `[canvas-connect] actions: hosting ${result.spawned.join(", ")}\n`,
        );
      }
    } catch (e) {
      process.stderr.write(
        `[canvas-connect] actions: start failed ${(e as Error).message}\n`,
      );
    }
  }

  // Idle timer
  let idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS);
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdown, IDLE_TIMEOUT_MS);
  }

  // Heartbeat
  const heartbeat = setInterval(() => {
    // LoroSyncClient keeps WS alive internally; this just ensures the process stays active
  }, HEARTBEAT_INTERVAL_MS);

  // Unix socket server
  const sockPath = getSocketPath(projectId);
  const server: Server = createServer((conn) => {
    resetIdle();
    let buf = "";

    conn.on("data", (chunk) => {
      buf += chunk.toString();
      const newlineIdx = buf.indexOf("\n");
      if (newlineIdx === -1) return;

      const line = buf.slice(0, newlineIdx);
      buf = buf.slice(newlineIdx + 1);

      try {
        const cmd = JSON.parse(line);
        const result = handleCommand(client, cmd);
        conn.end(JSON.stringify(result) + "\n");
      } catch (err: any) {
        conn.end(JSON.stringify({ error: err.message }) + "\n");
      }
    });
  });

  server.listen(sockPath);

  // Write PID file
  writeFileSync(getPidPath(projectId), String(process.pid));

  console.log(JSON.stringify({ status: "connected", projectId, socket: sockPath, pid: process.pid }));

  // Graceful shutdown
  let shutdownCalled = false;
  async function shutdown() {
    if (shutdownCalled) return;
    shutdownCalled = true;
    clearTimeout(idleTimer);
    clearInterval(heartbeat);
    server.close();
    cleanup(projectId);
    // Tear down action subprocesses BEFORE closing the LoroSyncClient
    // so they get SIGTERM and disconnect their WS — the server then
    // sees them go offline immediately rather than waiting for the
    // heartbeat-stale timeout.
    if (actionsHost) {
      try { await actionsHost.stopAll(); } catch { /* best effort */ }
    }
    await client.disconnect();
    process.exit(0);
  }

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * Handle a command from a CLI invocation.
 */
export function handleCommandForTest(client: LoroSyncClient, cmd: any): object {
  return handleCommand(client, cmd);
}

function handleCommand(client: LoroSyncClient, cmd: any): object {
  const { action } = cmd;

  switch (action) {
    case "list": {
      const nodes = client.listNodes(cmd.type ?? undefined);
      return { nodes };
    }

    case "edges": {
      return listCanvasEdgesWithReceiptReadTokens(client);
    }

    case "batch_delete_plan": {
      return readCanvasBatchDeletePlan(client, cmd.nodeIds);
    }

    case "get": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const result: Record<string, unknown> = {
        node,
        readToken: canvasNodeReceiptReadToken(node),
      };
      if (typeof cmd.projectId === "string" && typeof cmd.nodeId === "string") {
        if (node.type === "text") {
          result.textReadToken = textNodeReceiptReadToken({
            projectId: cmd.projectId,
            nodeId: cmd.nodeId,
            content: textContentFromNode({ type: node.type, data: node.data as Record<string, unknown> }),
          });
        }
        if (node.type === "video-editor") {
          result.timelineReadToken = timelineNodeReceiptReadToken({
            projectId: cmd.projectId,
            nodeId: cmd.nodeId,
            dsl: node.data?.timelineDsl,
          });
        }
      }
      return result;
    }

    case "add": {
      const nodeId = crypto.randomUUID().slice(0, 8);
      const data: Record<string, unknown> = { ...(cmd.data ?? {}), label: cmd.label };
      if (cmd.content) data.content = cmd.content;
      const result = client.createNode(nodeId, cmd.type, data, null, cmd.parentId ?? null);
      return result;
    }

    case "update": {
      const updates: Record<string, unknown> = { ...(cmd.data ?? {}) };
      const guard = validateCanvasUpdateDataFields(Object.keys(updates));
      if (!guard.ok) return { error: guard.error };
      if (typeof cmd.label === "string") updates.label = cmd.label;
      if (typeof cmd.content === "string") updates.content = cmd.content;
      if (Object.keys(updates).length === 0) {
        return { error: "Provide at least one field to update (--label, --content, --asset-id, --data k=v)" };
      }
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const readProof = validateCanvasReadProof({
        operation: "update",
        actorClientType: cmd.actorClientType,
        node,
        expectedReadToken: cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonCanvasReadReceipt,
        force: cmd.force === true,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken,
        force: cmd.force === true,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const edges = client.canvas.listEdges();
      if (typeof updates.content === "string") {
        const contentGuard = validateCanvasContentPatch({
          nodeId: cmd.nodeId,
          node: { type: node.type },
          nodes: client.listNodes(),
          edges,
          hasContentPatch: true,
        });
        if (!contentGuard.ok) return { error: contentGuard.error, mutation: hostMutationRejected(hostMutation.envelope, contentGuard.error) };
      }
      const mediaGuard = validateCanvasMediaAssetPatch({
        nodeId: cmd.nodeId,
        node: { type: node.type, data: node.data as Record<string, unknown> },
        edges,
        hasAssetIdPatch: Object.prototype.hasOwnProperty.call(updates, "assetId"),
        nextAssetId: updates.assetId,
      });
      if (!mediaGuard.ok) return { error: mediaGuard.error, mutation: hostMutationRejected(hostMutation.envelope, mediaGuard.error) };
      const checkpointGuard = validateCanvasCheckpointPatch({
        nodeId: cmd.nodeId,
        node: { type: node.type, data: node.data as Record<string, unknown> },
        nodes: client.listNodes(),
        edges,
        fields: Object.keys(updates),
      });
      if (!checkpointGuard.ok) return { error: checkpointGuard.error, mutation: hostMutationRejected(hostMutation.envelope, checkpointGuard.error) };
      const ok = client.updateNode(cmd.nodeId, updates);
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      const updatedNode = client.readNode(cmd.nodeId);
      const afterReadToken = updatedNode ? canvasNodeReceiptReadToken(updatedNode) : undefined;
      return {
        updated: true,
        nodeId: cmd.nodeId,
        ...(afterReadToken ? { readToken: afterReadToken } : {}),
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterReadToken,
        }),
        ...(cmd.force === true ? { forced: true } : {}),
      };
    }

    case "timeline_cas_update": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentDsl = normalizeTimelineDslForYaml(node.data?.timelineDsl);
      const beforeHash = timelineHash(currentDsl);
      const beforeReadToken = timelineReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        timelineHash: beforeHash,
      });
      const lock: TimelineLock | null =
        typeof cmd.expectedTimelineHash === "string"
          ? createTimelineLockFromHash({
              projectId: cmd.projectId,
              nodeId: cmd.nodeId,
              filePath: typeof cmd.expectedTimelineFilePath === "string" ? cmd.expectedTimelineFilePath : "",
              timelineHash: cmd.expectedTimelineHash,
              ...(typeof cmd.expectedReadToken === "string" ? { readToken: cmd.expectedReadToken } : {}),
              pulledAt: "",
            })
          : null;
      const cas = assertTimelineCas({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        lock,
        currentDsl,
        force: cmd.force === true,
        ...(typeof cmd.expectedTimelineFilePath === "string" && typeof cmd.filePath === "string"
          ? { filePath: cmd.filePath, cwd: typeof cmd.cwd === "string" ? cmd.cwd : undefined }
          : {}),
      });
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "timeline apply",
        currentReadToken: beforeReadToken,
        expectedReadToken: lock?.readToken,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonTimelineReadReceipt,
        force: cmd.force === true,
        readCommandHint:
          "Run `clash timeline pull --json` first and pass the lock readToken, or pass --force for an explicit overwrite.",
      });
      const actor = readTimelineRevisionActor(cmd.actor);
      const hostMutation = validateHostMutationEnvelope({
        operation: "timeline_cas_update",
        entity: { kind: "timeline", id: cmd.nodeId },
        actor,
        expectedHash: lock?.timelineHash,
        currentHash: beforeHash,
        expectedReadToken: lock?.readToken,
        currentReadToken: beforeReadToken,
        force: cmd.force === true,
        guard: cas.ok ? readProof : cas,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const reference = assertTimelineNotMaterializedReferenced({
        nodeId: cmd.nodeId,
        nodes: client.listNodes(),
        edges: client.canvas.listEdges(),
        force: cmd.force === true,
      });
      if (!reference.ok) return { error: reference.error, mutation: hostMutationRejected(hostMutation.envelope, reference.error) };
      const ok = client.updateNode(cmd.nodeId, { timelineDsl: cmd.dsl });
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      const revisionMetadata = readLoroRevisionMetadata(client.doc);
      const timelineRevision = typeof cmd.cwd === "string" && typeof cmd.filePath === "string"
        ? createTimelineAppliedRevision({
            projectId: cmd.projectId,
            nodeId: cmd.nodeId,
            cwd: cmd.cwd,
            filePath: cmd.filePath,
            dsl: cmd.dsl,
            parentRevisionId: typeof cmd.parentRevisionId === "string" ? cmd.parentRevisionId : undefined,
            actor,
            ...revisionMetadata,
          })
        : undefined;
      const afterHash = timelineHash(normalizeTimelineDslForYaml(cmd.dsl));
      const afterReadToken = timelineNodeReceiptReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        dsl: cmd.dsl,
      });
      return {
        updated: true,
        nodeId: cmd.nodeId,
        timelineRevision,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterHash,
          afterReadToken,
        }),
        ...(cmd.force === true ? { forced: true } : {}),
      };
    }

    case "timeline_cow_replace": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      if (node.type !== "video-editor") return { error: `Node ${cmd.nodeId} has type "${node.type}", expected "video-editor"` };
      if (!cmd.dsl || typeof cmd.dsl !== "object") {
        return { error: "timeline_cow_replace requires timeline dsl" };
      }
      const currentDsl = normalizeTimelineDslForYaml(node.data?.timelineDsl);
      const beforeHash = timelineHash(currentDsl);
      const beforeReadToken = timelineReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        timelineHash: beforeHash,
      });
      const lock: TimelineLock | null =
        typeof cmd.expectedTimelineHash === "string"
          ? createTimelineLockFromHash({
              projectId: cmd.projectId,
              nodeId: cmd.nodeId,
              filePath: typeof cmd.expectedTimelineFilePath === "string" ? cmd.expectedTimelineFilePath : "",
              timelineHash: cmd.expectedTimelineHash,
              ...(typeof cmd.expectedReadToken === "string" ? { readToken: cmd.expectedReadToken } : {}),
              pulledAt: "",
            })
          : null;
      const cas = assertTimelineCas({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        lock,
        currentDsl,
        force: cmd.force === true,
        ...(typeof cmd.expectedTimelineFilePath === "string" && typeof cmd.filePath === "string"
          ? { filePath: cmd.filePath, cwd: typeof cmd.cwd === "string" ? cmd.cwd : undefined }
          : {}),
      });
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "timeline replace",
        currentReadToken: beforeReadToken,
        expectedReadToken: lock?.readToken,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonTimelineReadReceipt,
        force: cmd.force === true,
        readCommandHint:
          "Run `clash timeline pull --json` first and pass the lock readToken, or pass --force for an explicit overwrite.",
      });
      const actor = readTimelineRevisionActor(cmd.actor);
      const hostMutation = validateHostMutationEnvelope({
        operation: "timeline_cow_replace",
        entity: { kind: "timeline", id: cmd.nodeId },
        actor,
        expectedHash: lock?.timelineHash,
        currentHash: beforeHash,
        expectedReadToken: lock?.readToken,
        currentReadToken: beforeReadToken,
        force: cmd.force === true,
        guard: cas.ok ? readProof : cas,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const newNodeId = typeof cmd.newNodeId === "string" && cmd.newNodeId.length > 0
        ? cmd.newNodeId
        : crypto.randomUUID().slice(0, 8);
      const revisionMetadata = readLoroRevisionMetadata(client.doc);
      const timelineRevision = typeof cmd.cwd === "string" && typeof cmd.filePath === "string"
        ? createTimelineAppliedRevision({
            projectId: cmd.projectId,
            nodeId: newNodeId,
            cwd: cmd.cwd,
            filePath: cmd.filePath,
            dsl: cmd.dsl,
            parentRevisionId: typeof cmd.parentRevisionId === "string" ? cmd.parentRevisionId : undefined,
            actor,
            ...revisionMetadata,
          })
        : undefined;
      const data = createTimelineCowNodeData({
        sourceNodeId: cmd.nodeId,
        sourceLabel: typeof node.data?.label === "string" ? node.data.label : undefined,
        sourceDsl: currentDsl,
        dsl: cmd.dsl,
        label: typeof cmd.label === "string" ? cmd.label : undefined,
        filePath: typeof cmd.filePath === "string" ? cmd.filePath : undefined,
        timelineRevision,
      });
      try {
        client.canvas.createLinkedNode({
          nodeId: newNodeId,
          nodeType: "video-editor",
          data,
          parentId: node.parent_id ?? null,
          sourceNodeId: cmd.nodeId,
          edgeId: `${cmd.nodeId}-${newNodeId}`,
          edgeType: "copy-on-write",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, mutation: hostMutationRejected(hostMutation.envelope, message) };
      }
      const afterHash = timelineHash(cmd.dsl);
      const afterReadToken = timelineNodeReceiptReadToken({
        projectId: cmd.projectId,
        nodeId: newNodeId,
        dsl: cmd.dsl,
      });
      return {
        replaced: true,
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
        newNodeId,
        nodeId: newNodeId,
        sourceTimelineHash: beforeHash,
        timelineHash: afterHash,
        timelineRevision,
        lineageEdge: { source: cmd.nodeId, target: newNodeId, type: "copy-on-write" },
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash,
          afterReadToken,
        }),
        ...(cmd.force === true ? { forced: true } : {}),
      };
    }

    case "text_cas_update": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      if (typeof cmd.content !== "string") {
        return { error: "text_cas_update requires string content" };
      }
      const currentContent = textContentFromNode({
        type: node.type,
        data: node.data as Record<string, unknown>,
      });
      const beforeHash = textHash(currentContent);
      const beforeReadToken = textReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        contentHash: beforeHash,
      });
      const lock: TextLock | null =
        typeof cmd.expectedContentHash === "string"
          ? createTextLockFromHash({
              projectId: cmd.projectId,
              nodeId: cmd.nodeId,
              filePath: typeof cmd.expectedTextFilePath === "string" ? cmd.expectedTextFilePath : "",
              contentHash: cmd.expectedContentHash,
              ...(typeof cmd.expectedReadToken === "string" ? { readToken: cmd.expectedReadToken } : {}),
              pulledAt: "",
            })
          : null;
      const cas = assertTextCas({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        lock,
        currentContent,
        force: cmd.force === true,
        ...(typeof cmd.expectedTextFilePath === "string" && typeof cmd.filePath === "string"
          ? { filePath: cmd.filePath, cwd: typeof cmd.cwd === "string" ? cmd.cwd : undefined }
          : {}),
      });
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "text apply",
        currentReadToken: beforeReadToken,
        expectedReadToken: lock?.readToken,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonTextReadReceipt,
        force: cmd.force === true,
        readCommandHint:
          "Run `clash text pull --json` first and pass the lock readToken, or pass --force for an explicit overwrite.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "text_cas_update",
        entity: { kind: "text", id: cmd.nodeId },
        expectedHash: lock?.contentHash,
        currentHash: beforeHash,
        expectedReadToken: lock?.readToken,
        currentReadToken: beforeReadToken,
        force: cmd.force === true,
        guard: cas.ok ? readProof : cas,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const reference = assertTextNotReferenced({
        nodeId: cmd.nodeId,
        nodes: client.listNodes(),
        edges: client.canvas.listEdges(),
        force: cmd.force === true,
      });
      if (!reference.ok) return { error: reference.error, mutation: hostMutationRejected(hostMutation.envelope, reference.error) };
      const ok = client.updateNode(cmd.nodeId, { content: cmd.content });
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      const afterHash = textHash(cmd.content);
      const afterReadToken = textNodeReceiptReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        content: cmd.content,
      });
      const textRevision = typeof cmd.cwd === "string" && typeof cmd.filePath === "string"
        ? createTextAppliedRevision({
            projectId: cmd.projectId,
            nodeId: cmd.nodeId,
            cwd: cmd.cwd,
            filePath: cmd.filePath,
            content: cmd.content,
            parentRevisionId: typeof cmd.parentRevisionId === "string" ? cmd.parentRevisionId : undefined,
            actor: readTextRevisionActor(cmd.actor),
          })
        : undefined;
      return {
        updated: true,
        nodeId: cmd.nodeId,
        textRevision,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterHash,
          afterReadToken,
        }),
        ...(cmd.force === true ? { forced: true } : {}),
      };
    }

    case "text_cow_replace": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      if (node.type !== "text") return { error: `Node ${cmd.nodeId} has type "${node.type}", expected "text"` };
      if (typeof cmd.content !== "string") {
        return { error: "text_cow_replace requires string content" };
      }
      const currentContent = textContentFromNode({
        type: node.type,
        data: node.data as Record<string, unknown>,
      });
      const beforeHash = textHash(currentContent);
      const beforeReadToken = textReadToken({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        contentHash: beforeHash,
      });
      const lock: TextLock | null =
        typeof cmd.expectedContentHash === "string"
          ? createTextLockFromHash({
              projectId: cmd.projectId,
              nodeId: cmd.nodeId,
              filePath: typeof cmd.expectedTextFilePath === "string" ? cmd.expectedTextFilePath : "",
              contentHash: cmd.expectedContentHash,
              ...(typeof cmd.expectedReadToken === "string" ? { readToken: cmd.expectedReadToken } : {}),
              pulledAt: "",
            })
          : null;
      const cas = assertTextCas({
        projectId: cmd.projectId,
        nodeId: cmd.nodeId,
        lock,
        currentContent,
        force: cmd.force === true,
        ...(typeof cmd.expectedTextFilePath === "string" && typeof cmd.filePath === "string"
          ? { filePath: cmd.filePath, cwd: typeof cmd.cwd === "string" ? cmd.cwd : undefined }
          : {}),
      });
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "text replace",
        currentReadToken: beforeReadToken,
        expectedReadToken: lock?.readToken,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonTextReadReceipt,
        force: cmd.force === true,
        readCommandHint:
          "Run `clash text pull --json` first and pass the lock readToken, or pass --force for an explicit overwrite.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "text_cow_replace",
        entity: { kind: "text", id: cmd.nodeId },
        expectedHash: lock?.contentHash,
        currentHash: beforeHash,
        expectedReadToken: lock?.readToken,
        currentReadToken: beforeReadToken,
        force: cmd.force === true,
        guard: cas.ok ? readProof : cas,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const newNodeId = typeof cmd.newNodeId === "string" && cmd.newNodeId.length > 0
        ? cmd.newNodeId
        : crypto.randomUUID().slice(0, 8);
      const textRevision = typeof cmd.cwd === "string" && typeof cmd.filePath === "string"
        ? createTextAppliedRevision({
            projectId: cmd.projectId,
            nodeId: newNodeId,
            cwd: cmd.cwd,
            filePath: cmd.filePath,
            content: cmd.content,
            parentRevisionId: typeof cmd.parentRevisionId === "string" ? cmd.parentRevisionId : undefined,
            actor: readTextRevisionActor(cmd.actor),
          })
        : undefined;
      const data = createTextCowNodeData({
        sourceNodeId: cmd.nodeId,
        sourceLabel: typeof node.data?.label === "string" ? node.data.label : undefined,
        sourceContent: currentContent,
        content: cmd.content,
        label: typeof cmd.label === "string" ? cmd.label : undefined,
        filePath: typeof cmd.filePath === "string" ? cmd.filePath : undefined,
        textRevision,
      });
      try {
        client.canvas.createLinkedNode({
          nodeId: newNodeId,
          nodeType: "text",
          data,
          parentId: node.parent_id ?? null,
          sourceNodeId: cmd.nodeId,
          edgeId: `${cmd.nodeId}-${newNodeId}`,
          edgeType: "copy-on-write",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, mutation: hostMutationRejected(hostMutation.envelope, message) };
      }
      const afterHash = textHash(cmd.content);
      const afterReadToken = textNodeReceiptReadToken({
        projectId: cmd.projectId,
        nodeId: newNodeId,
        content: cmd.content,
      });
      return {
        replaced: true,
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
        newNodeId,
        nodeId: newNodeId,
        sourceContentHash: beforeHash,
        contentHash: afterHash,
        textRevision,
        lineageEdge: { source: cmd.nodeId, target: newNodeId, type: "copy-on-write" },
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash,
          afterReadToken,
        }),
        ...(cmd.force === true ? { forced: true } : {}),
      };
    }

    case "delete": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const readProof = validateCanvasReadProof({
        operation: "delete",
        actorClientType: cmd.actorClientType,
        node,
        expectedReadToken: cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonCanvasReadReceipt,
        force: cmd.force === true,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_delete",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken,
        force: cmd.force === true,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const edges = client.canvas.listEdges();
      const deleteGuard = validateCanvasDelete({
        nodeId: cmd.nodeId,
        edges,
        force: cmd.force === true,
      });
      if (!deleteGuard.ok) return { error: deleteGuard.error, mutation: hostMutationRejected(hostMutation.envelope, deleteGuard.error) };
      const orphanedReferences = canvasDownstreamTargets(cmd.nodeId, edges);
      const ok = client.deleteNode(cmd.nodeId);
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      return {
        deleted: true,
        nodeId: cmd.nodeId,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
        }),
        ...(cmd.force === true ? { forced: true, orphanedReferences } : {}),
      };
    }

    case "delete_batch": {
      const plan = readCanvasBatchDeletePlan(client, cmd.nodeIds);
      if ("error" in plan) return { error: plan.error };
      const batchId = plan.nodeIds.join(",");
      const currentReadToken = canvasBatchDeleteReadToken({
        nodes: plan.nodes,
        edges: plan.edges,
      });
      const readProof = validateCanvasBatchDeleteReadProof({
        actorClientType: cmd.actorClientType,
        nodes: plan.nodes,
        edges: plan.edges,
        expectedReadToken: cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonCanvasBatchDeleteReadReceipt,
        force: cmd.force === true,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: batchId },
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken,
        force: cmd.force === true,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const guardrailEdges = canvasGuardrailEdgesFromReadProof(plan.edges);
      const deleteGuard = validateCanvasBatchDelete({
        nodeIds: plan.nodeIds,
        edges: guardrailEdges,
        force: cmd.force === true,
      });
      if (!deleteGuard.ok) return { error: deleteGuard.error, mutation: hostMutationRejected(hostMutation.envelope, deleteGuard.error) };
      const orphanedReferences = plan.nodeIds.flatMap((nodeId) => canvasDownstreamTargets(nodeId, guardrailEdges));
      const result = client.deleteNodes(plan.nodeIds);
      if (result.deletedNodeIds.length === 0) return { error: `Node(s) not found: ${plan.nodeIds.join(", ")}` };
      return {
        deleted: true,
        nodeIds: plan.nodeIds,
        deletedNodeIds: result.deletedNodeIds,
        deletedEdgeIds: result.deletedEdgeIds,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: batchId,
        }),
        ...(cmd.force === true ? { forced: true, orphanedReferences } : {}),
      };
    }

    case "asset_cow_replace": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      if (!isMediaNodeType(node.type)) {
        return { error: `Node ${cmd.nodeId} has type "${node.type}", expected image, video, or audio` };
      }
      if (typeof cmd.assetId !== "string" || cmd.assetId.trim().length === 0) {
        return { error: "asset_cow_replace requires assetId" };
      }
      const currentReadToken = canvasNodeReadToken(node);
      const readProof = validateCanvasReadProof({
        operation: "update",
        actorClientType: cmd.actorClientType,
        node,
        expectedReadToken: cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonCanvasReadReceipt,
        force: cmd.force === true,
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "asset_cow_replace",
        entity: { kind: "media-node", id: cmd.nodeId },
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken,
        force: cmd.force === true,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const newNodeId = typeof cmd.newNodeId === "string" && cmd.newNodeId.length > 0
        ? cmd.newNodeId
        : crypto.randomUUID().slice(0, 8);
      const sourceAssetId = typeof node.data?.assetId === "string" ? node.data.assetId : undefined;
      const data = createMediaAssetCowNodeData({
        sourceNodeId: cmd.nodeId,
        sourceLabel: typeof node.data?.label === "string" ? node.data.label : undefined,
        sourceAssetId,
        assetId: cmd.assetId.trim(),
        label: typeof cmd.label === "string" ? cmd.label : undefined,
      });
      try {
        client.canvas.createLinkedNode({
          nodeId: newNodeId,
          nodeType: node.type,
          data,
          parentId: node.parent_id ?? null,
          sourceNodeId: cmd.nodeId,
          edgeId: `${cmd.nodeId}-${newNodeId}`,
          edgeType: "copy-on-write",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { error: message, mutation: hostMutationRejected(hostMutation.envelope, message) };
      }
      const newNode = client.readNode(newNodeId);
      const afterReadToken = newNode ? canvasNodeReceiptReadToken(newNode) : undefined;
      return {
        replaced: true,
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
        newNodeId,
        nodeId: newNodeId,
        sourceAssetId,
        assetId: cmd.assetId.trim(),
        lineageEdge: { source: cmd.nodeId, target: newNodeId, type: "copy-on-write" },
        ...(afterReadToken ? { readToken: afterReadToken } : {}),
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterReadToken,
        }),
        ...(cmd.force === true ? { forced: true } : {}),
      };
    }

    case "search": {
      const types = cmd.types ?? null;
      const nodes = client.searchNodes(cmd.query, types);
      return { nodes };
    }

    case "execute": {
      const canvas = new Canvas(client.doc, () => {});
      const r = canvas.execute(cmd.nodeId, () => crypto.randomUUID().slice(0, 8));
      if (r.error) return { error: r.error };
      // Echo `kind` so the CLI can pick the right log line. Both
      // pipelines also fill `childNodeId` so the agent can poll the
      // resulting asset/render node for status.
      return { executed: true, kind: r.kind, childNodeId: r.childNodeId, childNodeType: r.childNodeType };
    }

    case "ensure_edge": {
      // Add a default edge from source → target IF no edge between that
      // exact pair already exists. Idempotent so callers don't have to
      // track which edges they've already wired. Used by `clash canvas
      // timeline push` to reflect timeline items' sourceNodeId
      // references as visible canvas edges. Goes through client.canvas
      // so the LoroSyncClient's subscribeLocalUpdates loop broadcasts
      // the change to the project room.
      const source: string = cmd.source;
      const target: string = cmd.target;
      for (const e of client.canvas.listEdges()) {
        if (e.source === source && e.target === target) return { existed: true };
      }
      const guard = validateCanvasEdgeAdd({
        edge: { source, target },
        nodes: client.listNodes(),
        edges: client.canvas.listEdges(),
      });
      if (!guard.ok) return { error: guard.error };
      const edgeId = `e-${source}-${target}-${crypto.randomUUID().slice(0, 4)}`;
      client.canvas.insertEdge(edgeId, source, target, "default");
      return { existed: false, edgeId };
    }

    case "ping": {
      return { pong: true };
    }

    case "disconnect": {
      // Will trigger shutdown after response is sent
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 100);
      return { disconnected: true };
    }

    default:
      return { error: `Unknown action: ${action}` };
  }
}

function readTimelineRevisionActor(value: unknown): TimelineRevisionActor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actor = value as Partial<TimelineRevisionActor>;
  if (
    (actor.actorType !== "user" && actor.actorType !== "agent") ||
    typeof actor.actorUserId !== "string"
  ) {
    return undefined;
  }
  return {
    actorType: actor.actorType,
    actorUserId: actor.actorUserId,
    ...(typeof actor.actorAgentId === "string" ? { actorAgentId: actor.actorAgentId } : {}),
  };
}

function readTextRevisionActor(value: unknown): TextRevisionActor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const actor = value as Partial<TextRevisionActor>;
  if (
    (actor.actorType !== "user" && actor.actorType !== "agent") ||
    typeof actor.actorUserId !== "string"
  ) {
    return undefined;
  }
  return {
    actorType: actor.actorType,
    actorUserId: actor.actorUserId,
    ...(typeof actor.actorAgentId === "string" ? { actorAgentId: actor.actorAgentId } : {}),
  };
}
