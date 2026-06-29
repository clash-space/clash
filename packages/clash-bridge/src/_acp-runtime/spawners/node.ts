/**
 * NodeSpawner — `child_process.spawn` adapter to the cross-host ChildHandle
 * shape. Used by clash-bridge and any other Node-resident host (desktop
 * shells, dev tooling, tests).
 *
 * Why we wrap, not re-export:
 *   - Node child_process gives us Node Readable/Writable streams. ACP SDK +
 *     this package's interfaces speak Web ReadableStream/WritableStream<Uint8Array>.
 *     `Readable.toWeb()` / `Writable.toWeb()` (Node 18+) bridges them.
 *   - `kill()` semantics: child_process.kill() returns synchronously. We
 *     promise-wait on the `exit` event so callers can `await kill()` and
 *     trust the process is actually gone.
 *   - `exited` resolves once with `{ code, signal }` even if both events
 *     fire (Node fires `exit` then `close`; we settle on the first).
 */

import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type { AgentSpec, ChildHandle, Spawner } from "../types.js";

type ManagedChild = {
  child: ChildProcessWithoutNullStreams;
  detached: boolean;
};

type ShutdownSignal = "SIGHUP" | "SIGINT" | "SIGTERM";

const activeChildren = new Set<ManagedChild>();
let cleanupHandlersInstalled = false;

function killProcessTree(
  child: ChildProcessWithoutNullStreams,
  signal: "SIGTERM" | "SIGKILL",
  detached: boolean,
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (detached && child.pid !== undefined) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall back to the direct process below. This can happen if the
      // process already exited between the exitCode check and kill(2).
    }
  }
  child.kill(signal);
}

function cleanupActiveChildren(signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): void {
  for (const managed of Array.from(activeChildren)) {
    killProcessTree(managed.child, signal, managed.detached);
  }
}

function installProcessCleanupHandlers(): void {
  if (cleanupHandlersInstalled) return;
  cleanupHandlersInstalled = true;

  process.once("exit", () => cleanupActiveChildren("SIGTERM"));

  for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] satisfies ShutdownSignal[]) {
    const handler = () => {
      cleanupActiveChildren("SIGTERM");
      if (process.listenerCount(signal) === 1) {
        process.off(signal, handler);
        process.kill(process.pid, signal);
      }
    };
    process.on(signal, handler);
  }
}

function shouldMirrorChildStderr(): boolean {
  return process.env.CLASH_DEBUG_ACP_CHILD_STDERR === "1";
}

export class NodeSpawner implements Spawner {
  async spawn(spec: AgentSpec): Promise<ChildHandle> {
    installProcessCleanupHandlers();

    const detached = process.platform !== "win32";

    // stdio: [stdin, stdout, stderr] all piped — we own all three streams.
    // Inheriting stderr would dump child noise into the bridge's own stderr
    // and lose it from any structured log we set up; keep it captured.
    const child: ChildProcessWithoutNullStreams = nodeSpawn(spec.command, spec.args ?? [], {
      env: { ...process.env, ...(spec.env ?? {}) },
      cwd: spec.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached,
    });

    // node:stream → Web stream. Node 18+ exposes `.toWeb()` on these classes;
    // they're not in the @types/node defaults everywhere, so we narrow.
    const stdin = (Writable as unknown as {
      toWeb(s: NodeJS.WritableStream): WritableStream<Uint8Array>;
    }).toWeb(child.stdin);
    const stdout = (Readable as unknown as {
      toWeb(s: NodeJS.ReadableStream): ReadableStream<Uint8Array>;
    }).toWeb(child.stdout);

    // Drain agent stderr so the OS pipe buffer cannot fill and block the
    // child. Structured callers receive these lines through onDiagnosticLine;
    // direct stderr mirroring is debug-only because most agents are noisy.
    // Without this, the OS pipe buffer fills (~64KB) and the agent
    // process blocks on its next stderr write — looks like the agent
    // "hung" with zero progress, no events, no responses.
    //
    // CRITICAL: stderr is consumed via the Node `data` event, NOT wrapped
    // via `Readable.toWeb` like stdout/stdin. We tried wrapping it once
    // and ALSO setting an encoding + data listener: under load Node's
    // webstreams adapter received string chunks (because setEncoding),
    // called `chunk.byteLength` (only valid on Buffers/Uint8Arrays), got
    // NaN, and threw `ERR_INVALID_ARG_VALUE` from inside the adapter —
    // crashing the daemon as soon as the child wrote anything to stderr.
    // Keeping stderr as a plain Node-stream consumer side-steps that.
    // We still expose a `stderr` ReadableStream<Uint8Array> on the
    // ChildHandle for callers that want the raw bytes; it's a stub that
    // never emits (nothing in the bridge reads it today).
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.length > 0) {
          spec.onDiagnosticLine?.(line);
          if (shouldMirrorChildStderr()) {
            process.stderr.write(`[acp.child] ${line}\n`);
          }
        }
      }
    });
    child.stderr.on("error", () => { /* ignore — child died */ });
    const stderr = new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } });

    // Single resolution of `exited` — first of (exit, close) wins.
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      let settled = false;
      const settle = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        resolve({ code, signal });
      };
      child.once("exit", settle);
      child.once("close", settle);
      // Spawn errors (e.g. ENOENT for missing command) fire before exit. Map
      // to a synthetic exit so callers waiting on `exited` don't hang forever.
      child.once("error", () => settle(null, null));
    });

    // Detached process groups keep grandchildren controllable, but they
    // also stop inheriting the host's SIGINT/SIGTERM. Keep each group in a
    // registry owned by this process so shutdown signals can reap it before
    // the host exits.
    const managed: ManagedChild = { child, detached };
    activeChildren.add(managed);
    void exited.finally(() => {
      activeChildren.delete(managed);
    });

    const kill = async (signal: "SIGTERM" | "SIGKILL" = "SIGTERM"): Promise<void> => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      killProcessTree(child, signal, detached);
      await exited;
    };

    return { stdin, stdout, stderr, kill, exited };
  }
}
