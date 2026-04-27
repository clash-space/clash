/**
 * clash-bridge — entrypoint for `npx @clash-space/bridge`.
 *
 * Run on a user's machine to pair a local Claude Code instance with the
 * Clash web UI.
 *
 * Usage:
 *   npx @clash-space/bridge --token <PAIR_CODE> [--server <URL>]
 *
 * What it does:
 *   1. Dial the clash Worker's bridge endpoint with the pairing token.
 *   2. Spawn `claude-code-acp` locally, do the ACP handshake.
 *   3. Tell the Worker we're ready.
 *   4. Relay prompts ↔ events until the Worker closes us or the agent dies.
 *
 * Out of scope for v1: agent picker (CC hardcoded), reconnect on drop
 * (just exit and prompt the user to re-run), permission prompts beyond
 * default-deny, persistent pairing.
 */

import WebSocket from "ws";
import { parseArgs } from "node:util";
import {
  AcpRuntimeImpl,
  KNOWN_ACP_AGENTS,
} from "./_acp-runtime/index.js";
import { NodeSpawner } from "./_acp-runtime/spawners/node.js";
import { Relay } from "./relay.js";

const DEFAULT_SERVER = "wss://api.clash.video";

function usage(): never {
  process.stderr.write(
    `Usage: clash-bridge --token <PAIR_CODE> [--server <wss://host>]\n` +
      `\n` +
      `Get a pairing code from the Clash chat panel ("Connect local agent").\n`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      token: { type: "string" },
      server: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help || !values.token) usage();

  const server = (values.server ?? DEFAULT_SERVER).replace(/\/+$/, "");
  const wsUrl = `${server}/agents/byo-bridge/cli?token=${encodeURIComponent(values.token!)}`;

  // Pick the CC entry from the registry. Hardcoded for v1 — we don't yet
  // expose agent choice over the wire. If CC isn't installed, fail fast
  // with the install hint instead of letting spawn ENOENT.
  const cc = KNOWN_ACP_AGENTS.find((a) => a.id === "claude-code-acp");
  if (!cc) {
    process.stderr.write("internal: claude-code-acp not in registry\n");
    process.exit(1);
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

  process.stderr.write(`→ spawning ${cc.spec.command} …\n`);
  const runtime = new AcpRuntimeImpl(new NodeSpawner());
  let session;
  try {
    session = await runtime.start({ agent: cc.spec });
  } catch (e) {
    process.stderr.write(
      `✗ could not start ${cc.spec.command}: ${e instanceof Error ? e.message : String(e)}\n` +
        (cc.installHint ? `  install: ${cc.installHint}\n` : ""),
    );
    ws.close(1011, "spawn failed");
    process.exit(1);
  }
  process.stderr.write("✓ agent ready\n");

  const relay = new Relay(ws, session);
  relay.notifyReady();

  // Stay alive until either side closes.
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
