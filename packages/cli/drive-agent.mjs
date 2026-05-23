#!/usr/bin/env node
/**
 * E2E driver — what a browser would do if a human were typing into the
 * chat panel. Connects to /api/v1/local-sessions/<sid>/_stream, sends a
 * single prompt frame, streams the agent's events to stdout.
 *
 * Usage:
 *   node /tmp/drive-agent.mjs <session_id> "<prompt text>"
 *
 * Stays open until you Ctrl-C or the server closes. Tool calls / streaming
 * text / status updates each print as a single line so it's easy to skim
 * the conversation in real time.
 */

import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const [, , sessionId, ...promptParts] = process.argv;
if (!sessionId || promptParts.length === 0) {
  console.error("usage: node drive-agent.mjs <session_id> <prompt text>");
  process.exit(2);
}
const prompt = promptParts.join(" ");
const creds = JSON.parse(readFileSync(join(homedir(), ".clash", "credentials.json"), "utf-8"));
const url = `ws://localhost:3001/api/v1/local-sessions/${sessionId}/_stream`;

const ws = new WebSocket(url, {
  headers: { Authorization: `Bearer ${creds.agentApiKey}` },
});

const turnId = randomUUID();
ws.on("open", () => {
  process.stderr.write(`✓ WS open → ${sessionId} (turn ${turnId.slice(0, 8)})\n`);
  ws.send(JSON.stringify({ type: "prompt", turn_id: turnId, text: prompt }));
});

ws.on("message", (data) => {
  const s = data.toString();
  let m;
  try { m = JSON.parse(s); } catch { console.log("[non-json]", s); return; }
  // Compact one-line summary of the message type so it's grep-able.
  const t = m.type ?? "?";
  if (t === "session.ready") {
    console.log(`▶ ready acp=${m.acp_session_id?.slice(0, 8)}…`);
  } else if (t === "session.event" || t === "session.update") {
    const ev = m.event ?? m.update ?? m;
    const sub = ev?.update?.sessionUpdate ?? ev?.sessionUpdate ?? "?";
    if (sub === "agent_message_chunk") {
      process.stdout.write(ev?.content?.text ?? ev?.update?.content?.text ?? "");
    } else if (sub === "agent_thought_chunk") {
      process.stdout.write(`\x1b[2m${ev?.content?.text ?? ev?.update?.content?.text ?? ""}\x1b[0m`);
    } else if (sub === "tool_call") {
      const tc = ev?.toolCall ?? ev?.update?.toolCall ?? {};
      const inp = JSON.stringify(tc.input ?? {}).slice(0, 160);
      console.log(`\n🔧 ${tc.name ?? tc.kind}  ${inp}`);
    } else if (sub === "tool_call_update") {
      const tc = ev?.toolCall ?? ev?.update?.toolCall ?? ev;
      const status = tc.status ?? "?";
      console.log(`   ↳ ${tc.title ?? tc.name ?? tc.kind ?? "tool"} [${status}]`);
    } else if (sub === "user_message_chunk") {
      // skip echoes
    } else if (sub === "available_commands_update") {
      // skip slash menu chatter
    } else {
      console.log(`· ${sub}`);
    }
  } else if (t === "session.error") {
    console.error(`✗ error: ${m.message}`);
  } else if (t === "session.turn_end" || t === "session.end") {
    console.log(`\n■ turn ended`);
  } else {
    console.log(`· ${t}`);
  }
});

ws.on("close", (code, reason) => {
  process.stderr.write(`\n← WS closed code=${code} reason=${reason}\n`);
  process.exit(0);
});
ws.on("error", (e) => {
  process.stderr.write(`✗ ${e.message}\n`);
  process.exit(1);
});

process.on("SIGINT", () => { ws.close(); });
