/**
 * clash-bridge — entry point for `npx @clash-space/bridge`.
 *
 * Two modes (kept side-by-side; pick whichever fits the user's flow):
 *
 *   A. Persistent runtime (recommended for daily use)
 *      $ npx @clash-space/bridge setup     # one-time OAuth + launchd install
 *      $ npx @clash-space/bridge status
 *      $ npx @clash-space/bridge uninstall
 *
 *      After `setup`, a launchd-managed daemon keeps the machine attached
 *      to clash.video. The web UI shows it as a Runtime; chats route to
 *      it like any other agent. See commands/setup.ts.
 *
 *   B. Ad-hoc one-shot pairing (zero install, single chat session)
 *      $ npx @clash-space/bridge --token=<PAIR_CODE> [--server=<wss://host>]
 *
 *      Pair token is shown in the chat panel ("Quick connect"). Bridge
 *      spawns claude-agent-acp, talks to it for the duration of one
 *      browser session, exits when the user closes the chat. See
 *      relay.ts + the existing byo-bridge flow on the server.
 *
 * Mode B exists because (a) some users only want a one-off chat without
 * leaving a daemon running and (b) it's the path we shipped first; users
 * have working terminals that depend on it.
 */

import { parseArgs } from "node:util";
import WebSocket from "ws";
import { AcpRuntimeImpl, KNOWN_ACP_AGENTS } from "./_acp-runtime/index.js";
import { NodeSpawner } from "./_acp-runtime/spawners/node.js";
import { detectAll } from "./_acp-runtime/registry.js";
import { listLocalCcSessions } from "./lib/cc-sessions.js";
import { ensureAgentCwd, listBundledAgents, readAgentRuntime } from "./lib/session-cwd.js";
import { Relay } from "./relay.js";

const DEFAULT_API_SERVER_URL = "https://api.clash.video";
const DEFAULT_BROWSER_ORIGIN = "https://clash.video";
const DEFAULT_PAIR_WS_SERVER = "wss://clash.video";

function printUsage(): never {
  process.stderr.write(
    `clash-bridge — pair a local AI agent with the Clash web UI\n` +
      `\n` +
      `Persistent runtime (recommended):\n` +
      `  clash-bridge setup [--server-url=<https://...>] [--no-service] [--force]\n` +
      `        First run: opens browser to register. Re-run anytime to upgrade —\n` +
      `        skips OAuth + just refreshes the launchd plist + restarts daemon.\n` +
      `        --force does the OAuth dance again (e.g. after a server-side revoke).\n` +
      `  clash-bridge daemon\n` +
      `  clash-bridge status\n` +
      `  clash-bridge uninstall\n` +
      `\n` +
      `Ad-hoc pairing (one-shot, no install):\n` +
      `  clash-bridge --token=<PAIR_CODE> [--server=<wss://host>] [--agent=<id>]\n` +
      `        Auto-detects whichever local agent is available (codex,\n` +
      `        claude, gemini, opencode, hermes, openclaw). --agent picks\n` +
      `        explicitly when more than one is installed.\n` +
      `\n` +
      `Get a pair code from the chat panel ("Quick connect"). For persistent\n` +
      `setup, your browser opens to clash.video to authorize this machine.\n`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const sub = process.argv[2];

  // Subcommand mode (A) — anything that doesn't start with "-".
  if (sub && !sub.startsWith("-")) {
    return await dispatchSubcommand(sub);
  }

  // Flag mode (B) — existing --token pairing flow. Preserved verbatim.
  return await runAdHocPair();
}

async function dispatchSubcommand(name: string): Promise<void> {
  // Trim the subcommand from argv before delegating to parseArgs in
  // command modules. node:util parseArgs reads from argv directly when
  // called without an `args` option.
  process.argv.splice(2, 1);

  switch (name) {
    case "setup": {
      const { values } = parseArgs({
        options: {
          "server-url":     { type: "string" },
          "browser-origin": { type: "string" },
          "no-service":     { type: "boolean" },
          force:            { type: "boolean" },
          help:             { type: "boolean", short: "h" },
        },
        strict: true,
      });
      if (values.help) printUsage();
      const { runSetup } = await import("./commands/setup.js");
      await runSetup({
        serverUrl:     values["server-url"]     ?? DEFAULT_API_SERVER_URL,
        browserOrigin: values["browser-origin"] ?? DEFAULT_BROWSER_ORIGIN,
        noService:     !!values["no-service"],
        force:         !!values.force,
      });
      return;
    }
    case "daemon": {
      // No flags — daemon reads everything from credentials.json
      const { runDaemon } = await import("./commands/daemon.js");
      await runDaemon();
      return;
    }
    case "status": {
      const { runStatus } = await import("./commands/status.js");
      await runStatus();
      return;
    }
    case "uninstall": {
      const { runUninstall } = await import("./commands/uninstall.js");
      await runUninstall();
      return;
    }
    case "help":
    case "-h":
    case "--help":
      printUsage();
    // eslint-disable-next-line no-fallthrough
    default:
      process.stderr.write(`unknown subcommand: ${name}\n\n`);
      printUsage();
  }
}

async function runAdHocPair(): Promise<void> {
  const { values } = parseArgs({
    options: {
      token:  { type: "string" },
      server: { type: "string" },
      agent:  { type: "string" },           // explicit override (id from registry)
      help:   { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help || !values.token) printUsage();

  const server = (values.server ?? DEFAULT_PAIR_WS_SERVER).replace(/\/+$/, "");
  const wsUrl = `${server}/agents/byo-bridge/cli?token=${encodeURIComponent(values.token!)}`;

  // --agent narrows the picker the browser sees down to a single option;
  // otherwise we publish every detected agent and let the user choose
  // in-dialog. Bridge no longer auto-picks claude-agent-acp on connect.
  let chosen: typeof KNOWN_ACP_AGENTS[number] | null = null;
  if (values.agent) {
    chosen = KNOWN_ACP_AGENTS.find((a) => a.id === values.agent) ?? null;
    if (!chosen) {
      process.stderr.write(
        `✗ unknown --agent: ${values.agent}\n` +
          `  available: ${KNOWN_ACP_AGENTS.map((a) => a.id).join(", ")}\n`,
      );
      process.exit(1);
    }
  }

  // Persistent process state — survives WS reconnects. ACP session is
  // kept alive across blips so a brief network drop doesn't lose the
  // conversation; user explicit ctrl-C is the only thing that disposes.
  const detected = await detectAll();
  const candidates = chosen ? [chosen] : detected;
  if (candidates.length === 0) {
    process.stderr.write(
      `✗ no local agent detected\n` +
        `  enable or install an agent in Clash Desktop Settings > Runtimes:\n` +
        KNOWN_ACP_AGENTS.map((a) => `    ${a.id}  →  ${a.downloadUrl ?? a.homepage ?? "?"}`).join("\n") +
        `\n`,
    );
    process.exit(1);
  }
  const runtime = new AcpRuntimeImpl(new NodeSpawner());
  let session: import("./_acp-runtime/types.js").AcpSession | null = null;

  let stopping = false;
  const stop = (sig: string) => {
    if (stopping) return;
    stopping = true;
    process.stderr.write(`→ ${sig}, shutting down\n`);
    void session?.dispose().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));

  let backoffMs = 1000;
  const RECONNECT_MAX_MS = 30 * 1000;

  while (!stopping) {
    process.stderr.write(`→ connecting to ${server} …\n`);
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl);
      await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
        ws.once("unexpected-response", (_req, res) => {
          reject(new Error(`pairing rejected: HTTP ${res.statusCode}`));
        });
      });
    } catch (e) {
      process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
      if (stopping) break;
      process.stderr.write(`→ reconnecting in ${backoffMs}ms\n`);
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
      continue;
    }
    backoffMs = 1000;
    process.stderr.write("✓ paired\n");

    if (!session) {
      // First attach — let the browser pick an agent template + optional resume id.
      // Re-enumerate local sessions every attach so the picker is fresh.
      const sessions = await listLocalCcSessions(20).catch(() => []);
      const agents = await listBundledAgents();
      ws.send(JSON.stringify({
        type: "bridge_setup",
        agents,
        sessions,
      }));
      process.stderr.write(`→ waiting for browser to pick agent${sessions.length ? " / session" : ""} …\n`);

      const startMsg = await waitForStart(ws).catch((e) => {
        process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
        return null;
      });
      if (!startMsg) continue; // WS dropped before pick — reconnect, browser repicks

      // Resolve picked agent template → which ACP agent CLI to spawn.
      const agentTemplateId = startMsg.agent_template_id ?? agents[0]?.id ?? "master-clash";
      const agentRuntime = await readAgentRuntime(agentTemplateId);
      const pickedAgent =
        candidates.find((a) => a.id === agentRuntime?.agent_id) ??
        candidates.find((a) => a.id === "codex-acp") ??
        candidates[0];
      process.stderr.write(
        `→ spawning agent=${agentTemplateId} via ${pickedAgent.spec.command} (${pickedAgent.id})${
          startMsg.resume_session_id ? ` resume=${startMsg.resume_session_id.slice(0, 8)}…` : ""
        } …\n`,
      );
      // Workspace cwd: ~/.clash/projects/<projectId-or-default>/
      const sessionCwd = await ensureAgentCwd(agentTemplateId);
      // Browser passed CLASH_API_KEY (issued by /pair); inject so the
      // spawned ACP agent's `clash` CLI / plugin hooks authenticate
      // without prompting.
      const spawnEnv: Record<string, string> = { ...(pickedAgent.spec.env ?? {}) };
      if (startMsg.api_key) spawnEnv.CLASH_API_KEY = startMsg.api_key;
      if (startMsg.api_url) spawnEnv.CLASH_API_URL = startMsg.api_url;
      try {
        session = await runtime.start({
          agent: { ...pickedAgent.spec, cwd: sessionCwd, env: spawnEnv },
          resumeAcpSessionId: startMsg.resume_session_id,
        });
      } catch (e) {
        const msg = `could not start ${pickedAgent.spec.command}: ${e instanceof Error ? e.message : String(e)}`;
        process.stderr.write(`✗ ${msg}\n${pickedAgent.downloadUrl ? "  " + pickedAgent.downloadUrl + "\n" : ""}`);
        try { ws.send(JSON.stringify({ type: "error", message: msg })); } catch { /* */ }
        // Don't kill the process — let the user re-pair / re-pick.
        ws.close(1011, "spawn failed");
        if (stopping) break;
        await sleep(backoffMs);
        continue;
      }
      process.stderr.write("✓ agent ready\n");
    } else {
      // Reconnect after WS drop — agent is still alive; resume relay.
      process.stderr.write(`→ reattached, agent still alive\n`);
    }

    const relay = new Relay(ws, session);
    relay.notifyReady();

    // Wait for this WS to drop. ACP child stays put.
    await new Promise<void>((resolve) => ws.once("close", resolve));
    if (stopping) break;
    process.stderr.write(`→ WS dropped, reconnecting in ${backoffMs}ms (agent kept alive)\n`);
    await sleep(backoffMs);
    backoffMs = Math.min(backoffMs * 2, RECONNECT_MAX_MS);
  }

  await session?.dispose().catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface StartMessage {
  type: "start";
  /** Picked agent template id (master-clash). Bridge
   *  resolves to the underlying ACP agent CLI via
   *  agents/<id>/runtime.json. */
  agent_template_id?: string;
  /** Optional explicit ACP agent catalog id from the picker. */
  agent_id?: string;
  resume_session_id?: string;
  /** Server-issued clsh_* — bridge sets as CLASH_API_KEY in spawn env. */
  api_key?: string;
  /** Origin to call back to (e.g. https://clash.video) — CLASH_API_URL. */
  api_url?: string;
}

/** Block until the browser sends `{type: "start"}`. Other messages ignored. */
function waitForStart(ws: WebSocket): Promise<StartMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      let msg: { type?: string; [k: string]: unknown };
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.type !== "start") return; // ignore anything sent before start
      ws.off("message", onMessage);
      ws.off("close", onClose);
      resolve(msg as StartMessage);
    };
    const onClose = () => {
      ws.off("message", onMessage);
      reject(new Error("WS closed before start"));
    };
    ws.on("message", onMessage);
    ws.once("close", onClose);
  });
}

main().catch((e) => {
  process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
