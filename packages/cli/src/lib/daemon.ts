/**
 * Canvas daemon — maintains a persistent WebSocket connection to a ProjectRoom.
 * Listens on a Unix socket for commands from CLI invocations.
 * Auto-exits after IDLE_TIMEOUT_MS of inactivity.
 */

import { createServer, createConnection, type Server } from "node:net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, createHmac, randomBytes } from "node:crypto";
import WebSocket from "ws";
import {
  agentReadReceiptToken,
  DEFAULT_CANVAS_ID,
  LoroSyncClient,
  createMediaAssetCowNodeData,
  isMediaNodeType,
  projectDirectorStageReadToken,
  projectCanvasReadToken,
  projectTimelineReadToken,
  validateAgentObservation,
  validateAgentReadProof,
  type AgentReadReceiptProof,
  type LoroSyncClientOptions,
} from "@clash/shared-types";
import { CliActionsHost, readBridgeRuntimeId, type ActionsHostEnv } from "./actions-host";
import { resolveClashRoot } from "./clash-home";
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
  validateCanvasEdgeAdd,
  validateCanvasMediaAssetPatch,
  validateCanvasReadProof,
  validateCanvasUpdateDataFields,
  type CanvasReadProofEdgeLike,
} from "./canvas-update-guardrails";
import {
  createTextAppliedRevision,
  createTextCowNodeData,
  textHash,
  textReadToken,
  textContentFromNode,
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

function daemonProjectKey(projectId: string): string {
  return createHash("sha256").update(projectId).digest("hex").slice(0, 32);
}

export function getSocketPath(
  projectId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return join(daemonSocketDir(env), `${daemonProjectKey(projectId)}.sock`);
}

function getPidPath(
  projectId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return join(daemonSocketDir(env), `${daemonProjectKey(projectId)}.pid`);
}

function getMcpPath(
  projectId: string,
  env: Record<string, string | undefined> = process.env,
): string {
  return join(daemonSocketDir(env), `${daemonProjectKey(projectId)}.mcp.json`);
}

export function getDaemonMcpEndpoint(projectId: string): string | undefined {
  try {
    const record = JSON.parse(readFileSync(getMcpPath(projectId), "utf8")) as { url?: unknown };
    return typeof record.url === "string" ? record.url : undefined;
  } catch {
    return undefined;
  }
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
  try { unlinkSync(sockPath); } catch { /* best-effort stale socket cleanup */ }
  try { unlinkSync(pidPath); } catch { /* best-effort stale pid cleanup */ }
  try { unlinkSync(getMcpPath(projectId)); } catch { /* best-effort stale MCP metadata cleanup */ }
}

function daemonCanvasReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`canvas-node:${readToken}`)
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

function daemonProjectCanvasReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`project-canvas:${readToken}`)
    .digest("base64url");
}

function projectCanvasReceiptReadToken(canvas: Parameters<typeof projectCanvasReadToken>[0]): string {
  const readToken = projectCanvasReadToken(canvas);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonProjectCanvasReadReceipt(readToken),
  });
}

function verifyDaemonProjectCanvasReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "canvas" &&
    proof.receipt === daemonProjectCanvasReadReceipt(proof.baseReadToken);
}

function daemonProjectTimelineReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`project-timeline:${readToken}`)
    .digest("base64url");
}

function projectTimelineReceiptReadToken(timeline: Parameters<typeof projectTimelineReadToken>[0]): string {
  const readToken = projectTimelineReadToken(timeline);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonProjectTimelineReadReceipt(readToken),
  });
}

function verifyDaemonProjectTimelineReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "timeline" &&
    proof.receipt === daemonProjectTimelineReadReceipt(proof.baseReadToken);
}

function validateDaemonProjectTimelineRead(options: {
  cmd: Record<string, unknown>;
  currentVersion: string;
  operation: string;
}) {
  return typeof options.cmd.ifMatch === "string"
    ? validateAgentReadProof({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        currentReadToken: options.currentVersion,
        expectedReadToken: options.cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonProjectTimelineReadReceipt,
        readCommandHint: "Run `clash timeline list --json` or `clash timeline pull --timeline <id>` first.",
      })
    : validateAgentObservation({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        observedVersion: typeof options.cmd.observedVersion === "string"
          ? options.cmd.observedVersion
          : undefined,
        currentVersion: options.currentVersion,
      });
}

function daemonProjectDirectorStageReadReceipt(readToken: string): string {
  return createHmac("sha256", DAEMON_READ_RECEIPT_SECRET)
    .update(`project-director-stage:${readToken}`)
    .digest("base64url");
}

function projectDirectorStageReceiptReadToken(
  stage: Parameters<typeof projectDirectorStageReadToken>[0],
): string {
  const readToken = projectDirectorStageReadToken(stage);
  return agentReadReceiptToken({
    readToken,
    receipt: daemonProjectDirectorStageReadReceipt(readToken),
  });
}

function verifyDaemonProjectDirectorStageReadReceipt(proof: AgentReadReceiptProof): boolean {
  return proof.namespace === "director-stage" &&
    proof.receipt === daemonProjectDirectorStageReadReceipt(proof.baseReadToken);
}

function validateDaemonProjectDirectorStageRead(options: {
  cmd: Record<string, unknown>;
  currentVersion: string;
  operation: string;
}) {
  return typeof options.cmd.ifMatch === "string"
    ? validateAgentReadProof({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        currentReadToken: options.currentVersion,
        expectedReadToken: options.cmd.ifMatch,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonProjectDirectorStageReadReceipt,
        readCommandHint: "Run `clash director list --json` or `clash director pull --stage <id>` first.",
      })
    : validateAgentObservation({
        actorClientType: typeof options.cmd.actorClientType === "string"
          ? options.cmd.actorClientType
          : undefined,
        operation: options.operation,
        observedVersion: typeof options.cmd.observedVersion === "string"
          ? options.cmd.observedVersion
          : undefined,
        currentVersion: options.currentVersion,
      });
}

function guardError(guard: { ok: false; error: string; code?: string }): object {
  return {
    error: guard.error,
    ...(guard.code ? { code: guard.code } : {}),
  };
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

function listCanvasEdgesWithVersion(client: LoroSyncClient): {
  edges: CanvasReadProofEdgeLike[];
  version: string;
  readToken: string;
} {
  const edges = listCanvasReadProofEdges(client);
  const version = canvasEdgesReadToken(edges);
  return {
    edges,
    version,
    readToken: agentReadReceiptToken({
      readToken: version,
      receipt: daemonCanvasEdgesReadReceipt(version),
    }),
  };
}

function listCanvasReadProofEdges(client: LoroSyncClient): CanvasReadProofEdgeLike[] {
  return client.canvas.listEdges().map((edge) => ({ ...edge }));
}

function readCanvasBatchDeletePlan(client: LoroSyncClient, nodeIds: unknown): {
  nodeIds: string[];
  nodes: NonNullable<ReturnType<LoroSyncClient["readNode"]>>[];
  edges: CanvasReadProofEdgeLike[];
  version: string;
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
    version: canvasBatchDeleteReadToken({ nodes, edges }),
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

  const mcpPortValue = process.env.CLASH_MCP_PORT ?? "0";
  const mcpPort = Number(mcpPortValue);
  if (!Number.isInteger(mcpPort) || mcpPort < 0 || mcpPort > 65535) {
    throw new Error("CLASH_MCP_PORT must be an integer between 0 and 65535");
  }
  const { startClashMcpHttpServer } = await import("@clash-space/mcp-server/server");
  const cliEntry = process.argv[1];
  const mcpHttp = await startClashMcpHttpServer({
    host: process.env.CLASH_MCP_HOST ?? "127.0.0.1",
    port: mcpPort,
    command: cliEntry ? process.execPath : undefined,
    argsPrefix: cliEntry ? [cliEntry] : undefined,
    cwd: process.cwd(),
    env: { ...process.env, CLASH_PROJECT_ID: projectId },
  });
  writeFileSync(getMcpPath(projectId), JSON.stringify({ url: mcpHttp.url, port: mcpHttp.port }), "utf8");

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

  console.log(JSON.stringify({ status: "connected", projectId, socket: sockPath, pid: process.pid, mcp: mcpHttp.url }));

  // Graceful shutdown
  let shutdownCalled = false;
  async function shutdown() {
    if (shutdownCalled) return;
    shutdownCalled = true;
    clearTimeout(idleTimer);
    clearInterval(heartbeat);
    server.close();
    await mcpHttp.close();
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
  const projectWorkspaceAction = action === "list_canvases" ||
    action === "create_canvas" ||
    action === "rename_canvas" ||
    action === "delete_canvas" ||
    action === "list_timelines" ||
    action === "create_timeline" ||
    action === "update_timeline_state" ||
    action === "attach_timeline" ||
    action === "detach_timeline" ||
    action === "copy_timeline_action" ||
    action === "list_director_stages" ||
    action === "create_director_stage" ||
    action === "update_director_stage_state" ||
    action === "attach_director_stage" ||
    action === "detach_director_stage";
  if (!projectWorkspaceAction) {
    client.selectCanvas(
      typeof cmd.canvasId === "string" && cmd.canvasId.trim()
        ? cmd.canvasId
        : DEFAULT_CANVAS_ID,
    );
  }

  switch (action) {
    case "list_canvases": {
      const canvases = client.listCanvases();
      return {
        canvases,
        versions: Object.fromEntries(
          canvases.map((canvas) => [canvas.id, projectCanvasReceiptReadToken(canvas)]),
        ),
      };
    }

    case "create_canvas": {
      const result = client.createCanvas({ id: cmd.canvasId, name: cmd.name });
      return result.ok
        ? {
            canvas: result.canvas,
            version: projectCanvasReadToken(result.canvas),
            readToken: projectCanvasReceiptReadToken(result.canvas),
          }
        : { error: result.error };
    }

    case "rename_canvas": {
      const current = client.listCanvases().find((canvas) => canvas.id === cmd.canvasId);
      if (!current) return { error: `Canvas ${cmd.canvasId} not found` };
      const currentVersion = projectCanvasReadToken(current);
      const guard = typeof cmd.ifMatch === "string"
        ? validateAgentReadProof({
            actorClientType: cmd.actorClientType,
            operation: "Canvas rename",
            currentReadToken: currentVersion,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyDaemonProjectCanvasReadReceipt,
            readCommandHint: "Run `clash canvases list --json` first.",
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "renaming the Canvas",
            observedVersion: cmd.observedVersion,
            currentVersion,
          });
      if (!guard.ok) return guardError(guard);
      const result = client.renameCanvas(cmd.canvasId, cmd.name);
      return result.ok
        ? {
            canvas: result.canvas,
            version: projectCanvasReadToken(result.canvas),
            readToken: projectCanvasReceiptReadToken(result.canvas),
          }
        : { error: result.error };
    }

    case "delete_canvas": {
      const current = client.listCanvases().find((canvas) => canvas.id === cmd.canvasId);
      if (!current) return { error: `Canvas ${cmd.canvasId} not found` };
      const currentVersion = projectCanvasReadToken(current);
      const guard = typeof cmd.ifMatch === "string"
        ? validateAgentReadProof({
            actorClientType: cmd.actorClientType,
            operation: "Canvas delete",
            currentReadToken: currentVersion,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyDaemonProjectCanvasReadReceipt,
            readCommandHint: "Run `clash canvases list --json` first.",
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "deleting the Canvas",
            observedVersion: cmd.observedVersion,
            currentVersion,
          });
      if (!guard.ok) return guardError(guard);
      const result = client.deleteCanvas(cmd.canvasId);
      return result.ok
        ? { deleted: true, canvasId: result.canvasId }
        : { error: result.error };
    }

    case "list_timelines": {
      const timelines = client.listTimelines();
      return {
        timelines,
        versions: Object.fromEntries(
          timelines.map((timeline) => [timeline.id, projectTimelineReceiptReadToken(timeline)]),
        ),
      };
    }

    case "create_timeline": {
      const result = client.createTimeline({
        id: cmd.timelineId,
        name: cmd.name,
        state: cmd.state ?? { tracks: [] },
      });
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "update_timeline_state": {
      const current = client.listTimelines().find((timeline) => timeline.id === cmd.timelineId);
      if (!current) return { error: `Timeline ${cmd.timelineId} not found` };
      const guard = validateDaemonProjectTimelineRead({
        cmd,
        operation: "Timeline apply",
        currentVersion: projectTimelineReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.updateTimelineState(cmd.timelineId, cmd.state);
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "attach_timeline": {
      const current = client.listTimelines().find((timeline) => timeline.id === cmd.timelineId);
      if (!current) return { error: `Timeline ${cmd.timelineId} not found` };
      const guard = validateDaemonProjectTimelineRead({
        cmd,
        operation: "Timeline attach",
        currentVersion: projectTimelineReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.attachTimeline({
        timelineId: cmd.timelineId,
        canvasId: cmd.canvasId,
        actionNodeId: cmd.actionNodeId,
        position: cmd.position ?? { x: 0, y: 0 },
      });
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "detach_timeline": {
      const current = client.listTimelines().find((timeline) => timeline.id === cmd.timelineId);
      if (!current) return { error: `Timeline ${cmd.timelineId} not found` };
      const guard = validateDaemonProjectTimelineRead({
        cmd,
        operation: "Timeline detach",
        currentVersion: projectTimelineReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.detachTimeline(cmd.timelineId);
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
          }
        : { error: result.error };
    }

    case "copy_timeline_action": {
      const current = client.listTimelines().find(
        (timeline) => timeline.id === cmd.sourceTimelineId,
      );
      if (!current) return { error: `Timeline ${cmd.sourceTimelineId} not found` };
      const sourceVersion = projectTimelineReadToken(current);
      const guard = validateDaemonProjectTimelineRead({
        cmd,
        operation: "Timeline Action copy",
        currentVersion: sourceVersion,
      });
      if (!guard.ok) return guardError(guard);
      const result = client.copyTimelineAction({
        sourceTimelineId: cmd.sourceTimelineId,
        targetCanvasId: cmd.targetCanvasId,
        newTimelineId: cmd.newTimelineId,
        newActionNodeId: cmd.newActionNodeId,
        position: cmd.position ?? { x: 0, y: 0 },
      });
      return result.ok
        ? {
            timeline: result.timeline,
            version: projectTimelineReadToken(result.timeline),
            readToken: projectTimelineReceiptReadToken(result.timeline),
            sourceVersion,
          }
        : { error: result.error };
    }

    case "list_director_stages": {
      const stages = client.listDirectorStages();
      return {
        stages,
        versions: Object.fromEntries(
          stages.map((stage) => [stage.id, projectDirectorStageReceiptReadToken(stage)]),
        ),
      };
    }

    case "create_director_stage": {
      const result = client.createDirectorStage({
        id: cmd.stageId,
        name: cmd.name,
        state: cmd.state,
      });
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "update_director_stage_state": {
      const current = client.listDirectorStages().find((stage) => stage.id === cmd.stageId);
      if (!current) return { error: `Director Stage ${cmd.stageId} not found` };
      const guard = validateDaemonProjectDirectorStageRead({
        cmd,
        operation: "Director Stage apply",
        currentVersion: projectDirectorStageReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.updateDirectorStageState(cmd.stageId, cmd.state);
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "attach_director_stage": {
      const current = client.listDirectorStages().find((stage) => stage.id === cmd.stageId);
      if (!current) return { error: `Director Stage ${cmd.stageId} not found` };
      const guard = validateDaemonProjectDirectorStageRead({
        cmd,
        operation: "Director Stage attach",
        currentVersion: projectDirectorStageReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.attachDirectorStage({
        stageId: cmd.stageId,
        canvasId: cmd.canvasId,
        actionNodeId: cmd.actionNodeId,
        position: cmd.position ?? { x: 0, y: 0 },
      });
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "detach_director_stage": {
      const current = client.listDirectorStages().find((stage) => stage.id === cmd.stageId);
      if (!current) return { error: `Director Stage ${cmd.stageId} not found` };
      const guard = validateDaemonProjectDirectorStageRead({
        cmd,
        operation: "Director Stage detach",
        currentVersion: projectDirectorStageReadToken(current),
      });
      if (!guard.ok) return guardError(guard);
      const result = client.detachDirectorStage(cmd.stageId);
      return result.ok
        ? {
            stage: result.stage,
            version: projectDirectorStageReadToken(result.stage),
            readToken: projectDirectorStageReceiptReadToken(result.stage),
          }
        : { error: result.error };
    }

    case "list": {
      const nodes = client.listNodes(cmd.type ?? undefined);
      return { nodes };
    }

    case "edges": {
      return listCanvasEdgesWithVersion(client);
    }

    case "batch_delete_plan": {
      return readCanvasBatchDeletePlan(client, cmd.nodeIds);
    }

    case "get": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const result: Record<string, unknown> = {
        node,
        immutable: isCanvasNodeImmutable({
          nodeId: cmd.nodeId,
          edges: client.canvas.listEdges(),
        }),
        version: canvasNodeReadToken(node),
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
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyDaemonCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas update",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const edges = client.canvas.listEdges();
      if (isCanvasNodeImmutable({ nodeId: cmd.nodeId, edges })) {
        const error = "IMMUTABLE_NODE";
        return {
          code: error,
          error,
          entity: { kind: "canvas-node", id: cmd.nodeId },
          mutation: hostMutationRejected(hostMutation.envelope, error),
        };
      }
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
      const version = updatedNode ? canvasNodeReadToken(updatedNode) : undefined;
      const afterReadToken = updatedNode ? canvasNodeReceiptReadToken(updatedNode) : undefined;
      return {
        updated: true,
        nodeId: cmd.nodeId,
        ...(version ? { version } : {}),
        ...(afterReadToken ? { readToken: afterReadToken } : {}),
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterHash: observedVersion ? version : undefined,
          afterReadToken,
        }),
      };
    }

    case "move": {
      const x = Number(cmd.position?.x);
      const y = Number(cmd.position?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return { error: "Canvas move requires finite x and y coordinates" };
      }
      const moved = client.canvas.moveNode(cmd.nodeId, { x, y });
      if (!moved) return { error: `Node not found: ${cmd.nodeId}` };
      return {
        moved: true,
        nodeId: cmd.nodeId,
        position: { x, y },
      };
    }

    case "copy_node": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyDaemonCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas copy",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_copy_node",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };

      const newNodeId = typeof cmd.newNodeId === "string" && cmd.newNodeId.trim()
        ? cmd.newNodeId.trim()
        : crypto.randomUUID().slice(0, 8);
      const data: Record<string, unknown> = {
        ...(node.data as Record<string, unknown>),
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
      };
      for (const runtimeField of ["error", "hasRun", "pendingTask", "pendingTaskAt", "progress", "status", "taskId"]) {
        delete data[runtimeField];
      }

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

      const copiedNode = client.readNode(newNodeId);
      if (!copiedNode) {
        const error = `Copied node not found after creation: ${newNodeId}`;
        return { error, mutation: hostMutationRejected(hostMutation.envelope, error) };
      }
      const version = canvasNodeReadToken(copiedNode);
      const afterReadToken = canvasNodeReceiptReadToken(copiedNode);
      return {
        copied: true,
        copyOnWrite: true,
        sourceNodeId: cmd.nodeId,
        newNodeId,
        nodeId: newNodeId,
        node: copiedNode,
        immutable: false,
        lineageEdge: { source: cmd.nodeId, target: newNodeId, type: "copy-on-write" },
        version,
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash: observedVersion ? version : undefined,
          afterReadToken,
        }),
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
      const expectedReadToken = typeof cmd.ifMatch === "string"
        ? cmd.ifMatch
        : typeof cmd.observedVersion === "string"
          ? cmd.observedVersion
          : undefined;
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "text apply",
        currentReadToken: beforeReadToken,
        expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonTextReadReceipt,
        readCommandHint: "Run `clash text pull --json` first, then retry.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "text_cas_update",
        entity: { kind: "text", id: cmd.nodeId },
        currentHash: beforeHash,
        expectedReadToken,
        currentReadToken: beforeReadToken,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      if (isCanvasNodeImmutable({ nodeId: cmd.nodeId, edges: client.canvas.listEdges() })) {
        const error = "IMMUTABLE_NODE";
        return {
          code: error,
          error,
          entity: { kind: "text", id: cmd.nodeId },
          mutation: hostMutationRejected(hostMutation.envelope, error),
        };
      }
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
        version: textReadToken({
          projectId: cmd.projectId,
          nodeId: cmd.nodeId,
          content: cmd.content,
        }),
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
          afterHash,
          afterReadToken,
        }),
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
      const expectedReadToken = typeof cmd.ifMatch === "string"
        ? cmd.ifMatch
        : typeof cmd.observedVersion === "string"
          ? cmd.observedVersion
          : undefined;
      const readProof = validateAgentReadProof({
        actorClientType: cmd.actorClientType,
        operation: "text replace",
        currentReadToken: beforeReadToken,
        expectedReadToken,
        requireReceipt: true,
        readReceiptVerifier: verifyDaemonTextReadReceipt,
        readCommandHint: "Run `clash text pull --json` first, then retry.",
      });
      const hostMutation = validateHostMutationEnvelope({
        operation: "text_cow_replace",
        entity: { kind: "text", id: cmd.nodeId },
        currentHash: beforeHash,
        expectedReadToken,
        currentReadToken: beforeReadToken,
        guard: readProof,
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
        version: textReadToken({
          projectId: cmd.projectId,
          nodeId: newNodeId,
          content: cmd.content,
        }),
        readToken: afterReadToken,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash,
          afterReadToken,
        }),
      };
    }

    case "delete": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      const currentReadToken = canvasNodeReadToken(node);
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "delete",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyDaemonCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas delete",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_delete",
        entity: { kind: "canvas-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const edges = client.canvas.listEdges();
      const deleteGuard = validateCanvasDelete({
        nodeId: cmd.nodeId,
        edges,
      });
      if (!deleteGuard.ok) return { error: deleteGuard.error, mutation: hostMutationRejected(hostMutation.envelope, deleteGuard.error) };
      const ok = client.deleteNode(cmd.nodeId);
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      return {
        deleted: true,
        nodeId: cmd.nodeId,
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: cmd.nodeId,
        }),
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
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasBatchDeleteReadProof({
            actorClientType: cmd.actorClientType,
            nodes: plan.nodes,
            edges: plan.edges,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyDaemonCanvasBatchDeleteReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas batch delete",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: batchId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
        guard: readProof,
      });
      if (!hostMutation.ok) return { error: hostMutation.error, mutation: hostMutation.mutation };
      const guardrailEdges = canvasGuardrailEdgesFromReadProof(plan.edges);
      const deleteGuard = validateCanvasBatchDelete({
        nodeIds: plan.nodeIds,
        edges: guardrailEdges,
      });
      if (!deleteGuard.ok) return { error: deleteGuard.error, mutation: hostMutationRejected(hostMutation.envelope, deleteGuard.error) };
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
      const observedVersion = typeof cmd.observedVersion === "string" ? cmd.observedVersion : undefined;
      const readProof = typeof cmd.ifMatch === "string"
        ? validateCanvasReadProof({
            operation: "update",
            actorClientType: cmd.actorClientType,
            node,
            expectedReadToken: cmd.ifMatch,
            requireReceipt: true,
            readReceiptVerifier: verifyDaemonCanvasReadReceipt,
          })
        : validateAgentObservation({
            actorClientType: cmd.actorClientType,
            operation: "canvas copy",
            observedVersion,
            currentVersion: currentReadToken,
          });
      const hostMutation = validateHostMutationEnvelope({
        operation: "asset_cow_replace",
        entity: { kind: "media-node", id: cmd.nodeId },
        expectedHash: observedVersion,
        currentHash: observedVersion ? currentReadToken : undefined,
        expectedReadToken: typeof cmd.ifMatch === "string" ? cmd.ifMatch : undefined,
        currentReadToken: typeof cmd.ifMatch === "string" ? currentReadToken : undefined,
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
      const version = newNode ? canvasNodeReadToken(newNode) : undefined;
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
        ...(version ? { version } : {}),
        ...(afterReadToken ? { readToken: afterReadToken } : {}),
        mutation: hostMutationSucceeded(hostMutation.envelope, {
          resultEntityId: newNodeId,
          afterHash: observedVersion ? version : undefined,
          afterReadToken,
        }),
      };
    }

    case "search": {
      const types = cmd.types ?? null;
      const nodes = client.searchNodes(cmd.query, types);
      return { nodes };
    }

    case "execute": {
      const r = client.canvas.execute(cmd.nodeId, () => crypto.randomUUID().slice(0, 8));
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
