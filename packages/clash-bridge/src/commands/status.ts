/**
 * `clash-bridge status` — print local creds + (best-effort) ping the server
 * to verify the runtime is reachable and the token is still valid.
 *
 * No daemon process discovery (would require platform-specific PID files
 * or `launchctl list` parsing). Status is "do you have a creds file" +
 * "does the server still know about you" — for "is the daemon process
 * actually running" the user can check `launchctl list | grep clash`
 * (macOS) or look at the logs.
 */

import { readCreds } from "../lib/config.js";
import { paths } from "../lib/platform.js";

export async function runStatus(): Promise<void> {
  const p = paths();
  const creds = await readCreds();

  if (!creds) {
    process.stderr.write(
      `Not set up. Run \`clash-bridge setup\` to register this machine.\n` +
        `(Looked for: ${p.credsFile})\n`,
    );
    process.exit(1);
  }

  process.stdout.write(`Local credentials\n`);
  process.stdout.write(`  server:     ${creds.serverUrl}\n`);
  process.stdout.write(`  runtime_id: ${creds.runtimeId}\n`);
  process.stdout.write(`  machine_id: ${creds.machineId}\n`);
  process.stdout.write(`  registered: ${new Date(creds.createdAt * 1000).toISOString()}\n`);
  process.stdout.write(`  creds file: ${p.credsFile}\n`);
  process.stdout.write(`  log file:   ${p.logFile}\n`);
  if (p.serviceFile) {
    process.stdout.write(`  service:    ${p.serviceFile}\n`);
  }

  // Probe by opening a WS to /attach — if the token is valid we'll get
  // 101, then close immediately. We won't hang waiting for messages.
  // (We don't have a /api/v1/me-style probe yet that the daemon could
  // call; the WS handshake is the cheapest reachability check.)
  process.stdout.write(`\nProbing server …\n`);
  try {
    const wsUrl = `${creds.serverUrl.replace(/^http(s?):\/\//, "ws$1://").replace(/\/$/, "")}/agents/runtime/_attach`;
    const WebSocket = (await import("ws")).default;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${creds.token}` },
      });
      ws.once("open", () => {
        process.stdout.write(`  ✓ token accepted (server reachable)\n`);
        ws.close(1000, "status probe");
        resolve();
      });
      ws.once("unexpected-response", (_req, res) => {
        reject(new Error(`HTTP ${res.statusCode}`));
      });
      ws.once("error", reject);
      setTimeout(() => reject(new Error("timeout")), 8000);
    });
  } catch (e) {
    process.stdout.write(
      `  ✗ probe failed: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    process.exit(1);
  }
}
