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

import { readCreds } from "../lib/config.js";
import { osTag, machineName, paths } from "../lib/platform.js";
import { listLocalCcSessions } from "../lib/cc-sessions.js";
import { detectAll } from "../_acp-runtime/registry.js";
import { SessionManager } from "../lib/session-manager.js";
import { gcOldSessions } from "../lib/session-cwd.js";
import { ActionsHost } from "../lib/actions-loader.js";
import { printBanner, log, c } from "../lib/style.js";
import { PKG_VERSION } from "../lib/version.js";
import WebSocket from "ws";

// Server's deriveRuntimeStatus treats last_heartbeat older than 90s as
// offline (RUNTIME_HEARTBEAT_STALE_SEC). 5-minute pings guaranteed the
// runtime spent 4+ minutes of every cycle marked offline — the browser
// then can't create new sessions (POST /sessions returns 409 "runtime
// offline" via the deriveRuntimeStatus check in routes/v1/runtimes.ts),
// so the test agent was effectively unreachable. 30s gives comfortable
// headroom under the 90s threshold.
const HEARTBEAT_INTERVAL_MS = 30 * 1000;
const RECONNECT_BACKOFF_MIN_MS = 1000;
const RECONNECT_BACKOFF_MAX_MS = 60 * 1000;


export async function runDaemon(): Promise<void> {
  const creds = await readCreds();
  if (!creds) {
    process.stderr.write(
      "✗ no credentials. Run `clash-bridge setup` first.\n",
    );
    process.exit(2);
  }

  printBanner(`daemon — runtime ${creds.runtimeId.slice(0, 8)}… → ${creds.serverUrl}`, PKG_VERSION);

  // Historical no-op hook. Project directories are durable product state and
  // must not be cleaned up implicitly when sessions age out.
  void gcOldSessions().then((r) => {
    if (r.removed > 0) log.step(`GC: removed ${r.removed} stale session dir${r.removed === 1 ? "" : "s"}`);
  }).catch(() => undefined);

  // Convert https:// → wss:// (or http→ws for dev). The exchange flow
  // wrote whatever scheme the user passed via --server-url to setup.
  const wsBase = creds.serverUrl.replace(/^http(s?):\/\//, "ws$1://").replace(/\/$/, "");
  const wsUrl = `${wsBase}/agents/runtime/_attach`;

  let backoffMs = RECONNECT_BACKOFF_MIN_MS;
  let stopping = false;

  // Custom-action host: scans $CLASH_HOME/actions/ and supervises one
  // subprocess per local-runtime action. Each child inherits creds +
  // CLASH_RUNTIME_ID so the server can stamp registrations as owned
  // by this machine. Started before WS attach because the server's
  // gating only requires the runtime row to be heartbeating — not
  // that the bridge's main WS link is up.
  const actionsHost = new ActionsHost({
    serverUrl: creds.serverUrl,
    apiKey: creds.agentApiKey ?? creds.token,
    runtimeId: creds.runtimeId,
  });
  try {
    const result = await actionsHost.start();
    if (result.spawned.length > 0) {
      log.ok(`actions: hosting ${result.spawned.length} action${result.spawned.length === 1 ? "" : "s"} — ${result.spawned.join(", ")}`);
    } else if (result.skipped.length === 0) {
      log.step(`actions: nothing under ${paths().configDir}/actions/`);
    }
    if (result.skipped.length > 0) {
      log.warn(`actions: skipped ${result.skipped.length} (see preceding lines)`);
    }
  } catch (e) {
    log.warn(`actions: host start failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    log.step(`${sig} received, shutting down`);
    // Tear down agents first so the child processes get SIGTERM-style
    // dispose instead of being orphaned when the daemon process exits.
    void sessions.disposeAll();
    // SIGTERM all action subprocesses too so the server sees their WS
    // close and immediately frees the customActions map entries on
    // next heartbeat-derived offline transition.
    void actionsHost.stopAll();
    if (currentWs) {
      try { currentWs.close(1000, "shutdown"); } catch { /* already closing */ }
    }
  };
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGINT", () => stop("SIGINT"));

  let currentWs: WebSocket | null = null;
  // SessionManager survives WS drops — keeps the ACP child processes alive
  // so a brief network blip doesn't kill in-progress conversations. Each
  // WS attach calls setSender() to point at the new socket.
  const sessions = new SessionManager(() => {
    /* placeholder — replaced on first attach via setSender */
  });
  // Forward the agent API key (issued during /exchange) into every
  // spawned ACP child as CLASH_API_KEY so its bundled `clash` CLI /
  // plugin hooks can authenticate without prompting the user.
  sessions.setSpawnEnv({
    CLASH_API_KEY: creds.agentApiKey,
    CLASH_API_URL: creds.serverUrl,
  });

  while (!stopping) {
    try {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      currentWs = ws;

      await waitOpen(ws);
      backoffMs = RECONNECT_BACKOFF_MIN_MS;
      log.ok(`attached to ${c.cyan(wsBase)}`);

      const agents = (await detectAll()).map((a) => ({
        id: a.id,
        binary: a.spec.command,
      }));
      ws.send(JSON.stringify({
        type: "hello",
        machine_id: creds.machineId,
        hostname: machineName(),
        os: osTag(),
        version: PKG_VERSION,
        agents,
      }));
      // Re-announce any sessions we were running before the WS drop.
      // First-attach this is a no-op (no sessions yet).
      sessions.announceAll();

      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "ping" }));
        }
      }, HEARTBEAT_INTERVAL_MS);

      // Re-point SessionManager at the new socket. Sessions from the prior
      // attach are still alive (their ACP children kept running across the
      // WS drop). Re-announce them so the server's session_state cache
      // gets refreshed and any browser that reattaches sees ready again.
      sessions.setSender((msg) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      });

      ws.on("message", (data: Buffer) => {
        let msg: { type?: string; [k: string]: unknown };
        try { msg = JSON.parse(data.toString()); } catch { return; }
        process.stderr.write(`← server: ${msg.type ?? "?"}\n`);
        switch (msg.type) {
          case "welcome":
          case "pong":
            return;
          case "session.start":
            process.stderr.write(
              `  session.start sid=${(msg.session_id as string)?.slice(0, 8)} template=${msg.agent_template_id}${msg.agent_id ? ` agent=${msg.agent_id}` : ""}\n`,
            );
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
          case "rpc.list_local_sessions":
            // Server is asking us to enumerate this machine's
            // CC transcripts so the picker dialog has a Resume list.
            (async () => {
              const list = await listLocalCcSessions(20).catch(() => []);
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                  type: "rpc.list_local_sessions.response",
                  request_id: msg.request_id,
                  sessions: list,
                }));
              }
            })();
            return;
          default:
            process.stderr.write(`! unhandled server message: ${msg.type ?? "?"}\n`);
        }
      });

      // Wait until the WS closes (clean shutdown or transport drop).
      await new Promise<void>((resolve) => {
        ws.once("close", (code, reason) => {
          clearInterval(heartbeat);
          log.step(`WS closed  ${c.dim(`code=${code} reason=${reason?.toString() || "—"}`)}`);
          resolve();
        });
      });

      // Lost the WS but keep the ACP children alive — they'll be
      // reachable again on the next successful attach. Backoff loop
      // continues below.
    } catch (e) {
      log.warn(`WS attach failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (stopping) break;
    log.step(`reconnecting in ${backoffMs}ms`);
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_BACKOFF_MAX_MS);
  }

  log.step("daemon exited");
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
