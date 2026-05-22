/**
 * Canvas daemon — maintains a persistent WebSocket connection to a ProjectRoom.
 * Listens on a Unix socket for commands from CLI invocations.
 * Auto-exits after IDLE_TIMEOUT_MS of inactivity.
 */

import { createServer, createConnection, type Server } from "node:net";
import { existsSync, unlinkSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import WebSocket from "ws";
import { LoroSyncClient, Canvas } from "@clash/shared-types";
import { CliActionsHost, readBridgeRuntimeId } from "./actions-host";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const HEARTBEAT_INTERVAL_MS = 30 * 1000; // 30 seconds
const SOCK_DIR = join(homedir(), ".clash", "sockets");

export function getSocketPath(projectId: string): string {
  return join(SOCK_DIR, `${projectId}.sock`);
}

function getPidPath(projectId: string): string {
  return join(SOCK_DIR, `${projectId}.pid`);
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

/**
 * Start the daemon process. Blocks until shutdown.
 */
export async function startDaemon(
  projectId: string,
  serverUrl: string,
  token: string,
): Promise<void> {
  // Ensure socket directory exists
  mkdirSync(SOCK_DIR, { recursive: true });

  // Clean up stale files
  cleanup(projectId);

  // Connect to ProjectRoom
  const wsUrl = serverUrl.replace(/^http/, "ws");
  const client = new LoroSyncClient({
    serverUrl: wsUrl,
    projectId,
    token,
    clientType: "cli",
    WebSocket: WebSocket as any,
  });

  await client.connect();

  // Custom-action host: spawns one python subprocess per
  // ~/.clash/actions/<id>/manifest.json. Reuses the bridge's runtime_id
  // from credentials.json — same machine, same runtime row. If no
  // bridge has been set up, `creds` is null and we silently skip.
  const creds = readBridgeRuntimeId();
  let actionsHost: CliActionsHost | null = null;
  if (creds) {
    actionsHost = new CliActionsHost({
      serverUrl: creds.serverUrl,
      apiKey: creds.apiKey,
      runtimeId: creds.runtimeId,
    });
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
function handleCommand(client: LoroSyncClient, cmd: any): object {
  const { action } = cmd;

  switch (action) {
    case "list": {
      const nodes = client.listNodes(cmd.type ?? undefined);
      return { nodes };
    }

    case "get": {
      const node = client.readNode(cmd.nodeId);
      if (!node) return { error: `Node not found: ${cmd.nodeId}` };
      return { node };
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
      if (cmd.label) updates.label = cmd.label;
      if (cmd.content) updates.content = cmd.content;
      const ok = client.updateNode(cmd.nodeId, updates);
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      return { updated: true, nodeId: cmd.nodeId };
    }

    case "delete": {
      const ok = client.deleteNode(cmd.nodeId);
      if (!ok) return { error: `Node not found: ${cmd.nodeId}` };
      return { deleted: true, nodeId: cmd.nodeId };
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
