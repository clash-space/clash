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
 *      spawns claude-code-acp, talks to it for the duration of one
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
      `        Auto-detects whichever ACP agent is on PATH (claude-code-acp,\n` +
      `        codex, gemini, opencode, hermes, openclaw via acpx). --agent picks\n` +
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

  // Pick which agent to spawn:
  //   1. If user passed --agent <id>, use that (must exist in registry).
  //   2. Otherwise scan PATH for any known agent. Prefer claude-code-acp
  //      because it's the most polished. If multiple are present and the
  //      user wanted a specific one, they should pass --agent.
  //   3. None on PATH → fail with install hints.
  let chosen = values.agent
    ? KNOWN_ACP_AGENTS.find((a) => a.id === values.agent) ?? null
    : null;
  if (values.agent && !chosen) {
    process.stderr.write(
      `✗ unknown --agent: ${values.agent}\n` +
        `  available: ${KNOWN_ACP_AGENTS.map((a) => a.id).join(", ")}\n`,
    );
    process.exit(1);
  }
  if (!chosen) {
    const detected = await detectAll();
    if (detected.length === 0) {
      process.stderr.write(
        `✗ no ACP agents detected on PATH\n` +
          `  install one of:\n` +
          KNOWN_ACP_AGENTS.map((a) => `    ${a.id}  →  ${a.installHint ?? a.homepage ?? "?"}`).join("\n") +
          `\n`,
      );
      process.exit(1);
    }
    chosen =
      detected.find((a) => a.id === "claude-code-acp") ??
      detected[0];
    if (detected.length > 1) {
      process.stderr.write(
        `→ ${detected.length} agents on PATH; using ${chosen.id}\n` +
          `  (others: ${detected.filter((a) => a.id !== chosen!.id).map((a) => a.id).join(", ")} — pass --agent <id> to pick)\n`,
      );
    }
  }

  process.stderr.write(`→ connecting to ${server} …\n`);
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
    ws.once("unexpected-response", (_req, res) => {
      reject(new Error(`pairing rejected: HTTP ${res.statusCode}`));
    });
  });
  process.stderr.write("✓ paired\n");

  process.stderr.write(`→ spawning ${chosen.spec.command} (${chosen.id}) …\n`);
  const runtime = new AcpRuntimeImpl(new NodeSpawner());
  let session;
  try {
    session = await runtime.start({ agent: chosen.spec });
  } catch (e) {
    process.stderr.write(
      `✗ could not start ${chosen.spec.command}: ${e instanceof Error ? e.message : String(e)}\n` +
        (chosen.installHint ? `  install: ${chosen.installHint}\n` : ""),
    );
    ws.close(1011, "spawn failed");
    process.exit(1);
  }
  process.stderr.write("✓ agent ready\n");

  const relay = new Relay(ws, session);
  relay.notifyReady();

  await new Promise<void>((resolve) => {
    ws.once("close", resolve);
  });
  process.stderr.write("→ disconnected\n");
  await session.dispose().catch(() => {});
}

main().catch((e) => {
  process.stderr.write(`✗ ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
