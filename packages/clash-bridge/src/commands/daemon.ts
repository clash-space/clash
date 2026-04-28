/**
 * `clash-bridge daemon` — long-running reverse-WS to the control plane.
 *
 * Slice 1 scope: register, report manifest, heartbeat. No session spawning
 * yet — that lands in slice 2 (handle `session.start` / `session.prompt`
 * messages from the server, route to ACP agents, stream events back).
 *
 * Reconnect: exponential backoff capped at 60s. Heartbeat: 5min interval.
 * The daemon process never exits on transport errors — only on SIGTERM /
 * SIGINT (clean shutdown) or unrecoverable bugs (creds file missing /
 * malformed). Under launchd, even those exits get restarted within ~10s
 * thanks to KeepAlive=true.
 */

import { hostname } from "node:os";
import { readCreds } from "../lib/config.js";
import { osTag } from "../lib/platform.js";
import { detectAll } from "../_acp-runtime/registry.js";
import { SessionManager } from "../lib/session-manager.js";
import WebSocket from "ws";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;
const RECONNECT_BACKOFF_MIN_MS = 1000;
const RECONNECT_BACKOFF_MAX_MS = 60 * 1000;

import { createRequire } from "node:module";
const PKG_VERSION: string = (() => {
  const req = createRequire(import.meta.url);
  for (const path of ["../package.json", "../../package.json"]) {
    try { return req(path).version as string; } catch { /* try next */ }
  }
  return "0.0.0-dev";
})();

export async function runDaemon(): Promise<void> {
  const creds = await readCreds();
  if (!creds) {
    process.stderr.write(
      "✗ no credentials. Run `clash-bridge setup` first.\n",
    );
    process.exit(2);
  }

  process.stderr.write(
    `→ daemon starting (runtime ${creds.runtimeId.slice(0, 8)}…, server ${creds.serverUrl})\n`,
  );

  // Convert https:// → wss:// (or http→ws for dev). The exchange flow
  // wrote whatever scheme the user passed via --server-url to setup.
  const wsBase = creds.serverUrl.replace(/^http(s?):\/\//, "ws$1://").replace(/\/$/, "");
  const wsUrl = `${wsBase}/agents/runtime/_attach`;

  let backoffMs = RECONNECT_BACKOFF_MIN_MS;
  let stopping = false;

  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`→ ${sig} received, shutting down\n`);
    // Tear down agents first so the child processes get SIGTERM-style
    // dispose instead of being orphaned when the daemon process exits.
    void activeSessions?.disposeAll();
    if (currentWs) {
      try { currentWs.close(1000, "shutdown"); } catch { /* already closing */ }
    }
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  let currentWs: WebSocket | null = null;
  let activeSessions: SessionManager | null = null;

  while (!stopping) {
    try {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      currentWs = ws;

      await waitOpen(ws);
      backoffMs = RECONNECT_BACKOFF_MIN_MS;
      process.stderr.write(`✓ attached to ${wsBase}\n`);

      const agents = (await detectAll()).map((a) => ({
        id: a.id,
        binary: a.spec.command,
      }));
      ws.send(JSON.stringify({
        type: "hello",
        machine_id: creds.machineId,
        hostname: hostname(),
        os: osTag(),
        version: PKG_VERSION,
        agents,
      }));

      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Per-WS-attach SessionManager. Across WS reconnects we currently
      // throw away in-flight sessions on the daemon side (the server
      // would have to re-send `session.start` for them). Slice-3 can
      // persist session state across reconnects; for now treat WS drop
      // as "lost the conversation but kept the agent alive on disk".
      const sessions = new SessionManager((msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      });
      activeSessions = sessions;

      ws.on("message", (data: Buffer) => {
        let msg: { type?: string; [k: string]: unknown };
        try { msg = JSON.parse(data.toString()); } catch { return; }
        switch (msg.type) {
          case "welcome":
          case "pong":
            return;
          case "session.start":
            void sessions.start(msg as never);
            return;
          case "session.prompt":
            void sessions.prompt(msg as never);
            return;
          case "session.cancel":
            sessions.cancel(msg.session_id as string, msg.turn_id as string);
            return;
          case "session.dispose":
            void sessions.dispose(msg.session_id as string);
            return;
          default:
            process.stderr.write(`! unhandled server message: ${msg.type ?? "?"}\n`);
        }
      });

      // Wait until the WS closes (clean shutdown or transport drop).
      await new Promise<void>((resolve) => {
        ws.once("close", (code, reason) => {
          clearInterval(heartbeat);
          process.stderr.write(
            `→ WS closed code=${code} reason=${reason?.toString() || "—"}\n`,
          );
          resolve();
        });
      });

      // Lost the WS. Tear down agents — server will re-issue
      // session.start when (if) it re-routes a chat to us. Slice 3 can
      // keep them alive across reconnect once we have a re-attach RPC.
      await sessions.disposeAll();
      activeSessions = null;
    } catch (e) {
      process.stderr.write(
        `! WS attach failed: ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }

    if (stopping) break;
    process.stderr.write(`→ reconnecting in ${backoffMs}ms\n`);
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_BACKOFF_MAX_MS);
  }

  process.stderr.write("→ daemon exited\n");
  process.exit(0);
}

function waitOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      cleanup();
      reject(err);
    };
    const onUnexpected = (_req: unknown, res: { statusCode?: number }) => {
      cleanup();
      reject(new Error(`unexpected response: HTTP ${res.statusCode}`));
    };
    const cleanup = () => {
      ws.removeListener("open", onOpen);
      ws.removeListener("error", onError);
      ws.removeListener("unexpected-response", onUnexpected as never);
    };
    ws.once("open", onOpen);
    ws.once("error", onError);
    ws.once("unexpected-response", onUnexpected as never);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
