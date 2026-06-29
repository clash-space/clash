/**
 * `clash-bridge setup` — one-time onboarding.
 *
 *   1. Bind 127.0.0.1:<rand-port> as a single-shot HTTP server.
 *   2. Open the user's browser to https://clash.video/connect-daemon?cb=…&state=…
 *   3. User clicks "Allow this machine" (already auth'd via session cookie).
 *      Browser POSTs /api/v1/runtimes/connect-daemon → gets one-time `code`.
 *      Browser redirects to http://127.0.0.1:<port>/cb?code=…&state=…
 *   4. Local server receives the code, returns a "✓ All set" HTML page,
 *      shuts down.
 *   5. CLI POSTs /agents/runtime/exchange { code, state, machine_id, … }
 *      and persists the returned token to credentials.json.
 *   6. (macOS) Install launchd plist, kick it off → daemon is now persistent.
 *   7. Exit.
 *
 * The `state` is verified server-side (so a leaked code can't be used by a
 * different setup attempt) AND client-side (so the localhost callback
 * can't be poisoned by an arbitrary cross-site request to 127.0.0.1).
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import { machineName } from "../lib/platform.js";
import { randomBytes } from "node:crypto";
import { writeCreds, readCreds, getOrCreateMachineId } from "../lib/config.js";
import { paths, currentPlatform, osTag } from "../lib/platform.js";
import { install as installLaunchd } from "../lib/launchd.js";
import { detectAll } from "../_acp-runtime/registry.js";
import { probeRuntimeToken } from "../lib/probe.js";
import { printBanner, log, c } from "../lib/style.js";
import { PKG_VERSION } from "../lib/version.js";

/** Resolve the daemon's launch path once, here, when we know the user's
 *  intent. realpath unwraps the npm/.bin/clash-bridge symlink so the
 *  plist points at the real dist/cli.js, not the shim — npm's package
 *  layout can shift the .bin target across upgrades, and a stale plist
 *  pointed at a missing shim silently breaks the daemon.
 *  Frozen at setup time because launchd doesn't re-source the user's
 *  shell or PATH; the only moment we know which binary the user
 *  actually wants is when they run `clash-bridge setup`. */
function resolveDaemonBinary(): string {
  const argv1 = process.argv[1];
  if (!argv1) throw new Error("process.argv[1] missing — can't resolve daemon binary path");
  try {
    return realpathSync(argv1);
  } catch {
    return argv1;
  }
}

/** Replace this process with `clash-bridge daemon` (foreground). Used
 *  when launchd install is skipped (--no-service or non-macOS) so the
 *  user gets a running daemon without typing a second command. spawn +
 *  inherit means the daemon's stdio shares the user's terminal and
 *  Ctrl-C flows through naturally; setup process exits with whatever
 *  the daemon exits with. */
function execIntoDaemon(): never {
  const child = spawn(process.execPath, [resolveDaemonBinary(), "daemon"], {
    stdio: "inherit",
    env: { ...process.env },
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
  // Block forever — the child's exit handler above is what eventually
  // terminates this process. The setImmediate(exit) wrapper in runSetup
  // would otherwise kill us before the child is even ready.
  return new Promise<never>(() => undefined) as never;
}

interface SetupOpts {
  serverUrl: string;
  /** Browser URL — typically same host as serverUrl but on the user-facing
   *  zone (clash.video) rather than the API zone (api.clash.video). */
  browserOrigin: string;
  /** When true, skip launchd install (useful for dev / non-macOS). */
  noService?: boolean;
  /** Force a fresh OAuth even if credentials.json already exists. */
  force?: boolean;
}


export async function runSetup(opts: SetupOpts): Promise<void> {
  try {
    await runSetupInner(opts);
  } finally {
    // Force-exit. Node's built-in fetch (undici) keeps HTTP keep-alive
    // sockets open ~5min after the last request — without this, setup
    // prints "Done." then hangs the user's terminal until those time
    // out. Anything that genuinely needs to outlive setup (e.g. the
    // launchd-installed daemon) has already forked off via launchctl.
    setImmediate(() => process.exit(0));
  }
}

async function runSetupInner(opts: SetupOpts): Promise<void> {
  printBanner(`setup — register this machine with ${opts.serverUrl}`, PKG_VERSION);

  // Fast path: if creds already exist (and the user didn't pass --force),
  // probe the server first. This catches the "I deleted the runtime in the
  // console and re-ran setup" recovery flow — without the probe we'd happily
  // refresh the launchd plist and restart the daemon with a token the server
  // no longer recognizes, leaving the runtime offline with no hint why.
  //
  // Three probe outcomes:
  //   - ok          → original fast path (refresh service / exec daemon, exit)
  //   - invalid     → server forgot us; fall through to OAuth dance, same as
  //                   if --force was passed. The stale creds get overwritten
  //                   below by writeCreds().
  //   - unreachable → can't tell; refresh service anyway (offline tolerance)
  //                   and warn that we couldn't verify.
  if (!opts.force) {
    const existing = await readCreds();
    if (existing) {
      log.ok(`existing credentials found  ${c.dim(paths().credsFile)}`);
      const probe = await probeRuntimeToken(existing.serverUrl, existing.token);
      if (!probe.ok && probe.reason === "invalid") {
        log.warn(`server no longer recognises this runtime (${probe.detail}) — re-registering`);
        log.hint(`(was runtime ${existing.runtimeId.slice(0, 8)}…)`);
        // Fall through to the OAuth path; writeCreds() will overwrite
        // the stale file with the new runtime_id + token.
      } else {
        if (!probe.ok) {
          log.warn(`could not verify with server (${probe.detail}) — proceeding anyway`);
        } else {
          log.hint(`runtime ${existing.runtimeId.slice(0, 8)}… (use --force to re-register)`);
        }
        if (!opts.noService && currentPlatform() === "darwin") {
          await installLaunchd({ binaryPath: resolveDaemonBinary() });
          log.ok(`launchd plist refreshed  ${c.dim(paths().serviceFile ?? "")}`);
          log.ok(`daemon restarted  ${c.dim("logs: " + paths().logFile)}`);
          process.stderr.write(`\n${c.bold("Up to date.")}\n\n`);
          return;
        }
        // No service install (--no-service or non-macOS): exec into the
        // daemon foreground so the user has a running bridge without
        // having to type a second command. Never returns.
        process.stderr.write(`\n${c.bold("Up to date.")}\n`);
        log.step(opts.noService ? "--no-service: starting daemon in foreground" : `service install not supported on ${process.platform}; running daemon in foreground`);
        log.hint("Ctrl-C to stop. To install as a launchd service, re-run setup without --no-service.");
        process.stderr.write("\n");
        execIntoDaemon();
      }
    }
  }

  log.step("waiting for browser to authorize");
  const state = randomBytes(16).toString("hex");
  const code = await waitForCallback(state, opts.browserOrigin);
  log.ok("received code from browser");

  const machineId = await getOrCreateMachineId();
  const exchange = await postExchange(opts.serverUrl, {
    code,
    state,
    machine_id: machineId,
    hostname: machineName(),
    os: osTag(),
    version: PKG_VERSION,
  });
  log.ok(`runtime registered  ${c.dim(exchange.runtime_id.slice(0, 8) + "…")}`);

  await writeCreds({
    serverUrl: opts.serverUrl,
    runtimeId: exchange.runtime_id,
    token: exchange.token,
    agentApiKey: exchange.agent_api_key,
    machineId,
    createdAt: Math.floor(Date.now() / 1000),
  });
  log.ok(`credentials written  ${c.dim(paths().credsFile)}`);

  // Quick agent scan so the user can see what we'll report on first daemon
  // startup. Manifest gets re-sent on every WS attach so this is just for
  // setup-time feedback.
  const agents = await detectAll();
  if (agents.length > 0) {
    log.ok(`agents detected  ${c.dim(agents.map((a) => a.id).join(", "))}`);
  } else {
    log.warn("no local agents detected yet");
    log.hint("Use Clash desktop Settings > Runtimes to install or enable an agent.");
  }

  if (opts.noService || currentPlatform() !== "darwin") {
    process.stderr.write("\n");
    log.step(opts.noService ? "--no-service: starting daemon in foreground" : `service install not supported on ${process.platform}; running daemon in foreground`);
    log.hint("Ctrl-C to stop. To install as a launchd service, re-run setup without --no-service.");
    process.stderr.write("\n");
    execIntoDaemon();
  }

  await installLaunchd({ binaryPath: resolveDaemonBinary() });
  log.ok(`launchd plist installed  ${c.dim(paths().serviceFile ?? "")}`);
  log.ok(`daemon started  ${c.dim("logs: " + paths().logFile)}`);
  process.stderr.write("\n");
  process.stderr.write(`${c.bold("Done.")} the runtime should appear online at ${c.cyan(opts.browserOrigin)}\n\n`);
}

/** Wait for browser to redirect to localhost cb. Returns the code. */
function waitForCallback(state: string, browserOrigin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeoutMs = 5 * 60 * 1000;
    const timer = setTimeout(() => {
      try { server.close(); } catch { /* already closing */ }
      reject(new Error("setup timed out — no browser callback in 5 minutes"));
    }, timeoutMs);

    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://127.0.0.1`);
      if (url.pathname !== "/cb") {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found");
        return;
      }
      const gotState = url.searchParams.get("state") ?? "";
      const code = url.searchParams.get("code") ?? "";
      if (gotState !== state) {
        res.writeHead(400, { "content-type": "text/plain" }).end("state mismatch");
        return;
      }
      if (!code) {
        res.writeHead(400, { "content-type": "text/plain" }).end("no code");
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(
        `<!doctype html><meta charset=utf-8><title>Connected</title>
<style>body{font-family:system-ui;text-align:center;padding:80px;color:#333}</style>
<h1>✓ Machine connected</h1>
<p>You can close this tab and return to your terminal.</p>`,
      );
      clearTimeout(timer);
      // Defer close so the response actually flushes.
      setTimeout(() => { try { server.close(); } catch { /* */ } }, 100);
      resolve(code);
    });

    server.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      const cb = `http://127.0.0.1:${port}/cb`;
      const target =
        `${browserOrigin.replace(/\/$/, "")}/connect-daemon` +
        `?cb=${encodeURIComponent(cb)}&state=${encodeURIComponent(state)}`;
      process.stderr.write(`→ opening ${target}\n`);
      openBrowser(target).catch((e) => {
        process.stderr.write(
          `! could not auto-open browser: ${e?.message ?? e}\n` +
            `  please open this URL manually:\n  ${target}\n`,
        );
      });
    });
  });
}

interface ExchangeResponse {
  runtime_id: string;
  token: string;
  agent_api_key?: string;
}

async function postExchange(
  serverUrl: string,
  body: { code: string; state: string; machine_id: string; hostname: string; os: string; version: string },
): Promise<ExchangeResponse> {
  const url = `${serverUrl.replace(/\/$/, "")}/agents/runtime/exchange`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`exchange failed: HTTP ${res.status}: ${text}`);
  }
  try {
    return JSON.parse(text) as ExchangeResponse;
  } catch {
    throw new Error(`exchange returned non-JSON: ${text.slice(0, 200)}`);
  }
}

function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const cmd =
      process.platform === "darwin" ? "open" :
      process.platform === "win32" ? "start" :
      "xdg-open";
    const args = process.platform === "win32" ? ["", url] : [url];
    const p = spawn(cmd, args, { stdio: "ignore", detached: true, shell: process.platform === "win32" });
    p.once("error", reject);
    p.unref();
    setTimeout(() => resolve(), 100);
  });
}
