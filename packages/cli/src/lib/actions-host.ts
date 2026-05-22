/**
 * Custom action host for `clash canvas connect`.
 *
 * Mirrors the bridge's actions host: scans ~/.clash/actions/ on daemon
 * startup, supervises one Python subprocess per local-runtime manifest,
 * SIGTERMs them all on daemon shutdown.
 *
 * Why is this duplicated from packages/clash-bridge/src/lib/actions-loader.ts
 * instead of shared? Because clash-bridge and the CLI publish as separate
 * npm packages and we don't want to introduce a cross-package runtime
 * dependency just for this. Both files are small and the bridge version
 * is the canonical reference — keep them in sync when you touch one.
 *
 * Runtime identity: read from ~/.clash/credentials.json (the bridge
 * writes this during `clash setup`). The CLI daemon is on the same
 * machine as the bridge, so reusing the same runtime_id is correct —
 * it's the runtime row tied to this user+machine. If credentials.json
 * doesn't exist, the host quietly does nothing (no actions to spawn).
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ACTIONS_DIR = join(homedir(), ".clash", "actions");
const CREDS_PATH = join(homedir(), ".clash", "credentials.json");
const RESTART_BACKOFF_MIN_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 60_000;
const HEALTHY_UPTIME_MS = 60_000;
const SHUTDOWN_GRACE_MS = 5_000;

interface ActionManifest {
  id: string;
  name: string;
  runtime?: string;
  entrypoint?: string;
}

interface SupervisedAction {
  manifest: ActionManifest;
  dir: string;
  child: ChildProcess | null;
  startedAt: number;
  backoffMs: number;
  stopping: boolean;
  restartTimer: NodeJS.Timeout | null;
}

export interface ActionsHostEnv {
  serverUrl: string;
  apiKey: string;
  /** Reused from the bridge's credentials.json — same machine, same runtime. */
  runtimeId: string;
}

export function readBridgeRuntimeId(): { runtimeId: string; apiKey: string; serverUrl: string } | null {
  if (!existsSync(CREDS_PATH)) return null;
  try {
    const creds = JSON.parse(readFileSync(CREDS_PATH, "utf-8"));
    if (!creds.runtimeId) return null;
    return {
      runtimeId: creds.runtimeId,
      apiKey: creds.agentApiKey || creds.token,
      serverUrl: creds.serverUrl,
    };
  } catch {
    return null;
  }
}

export class CliActionsHost {
  private actions = new Map<string, SupervisedAction>();
  private env: ActionsHostEnv;
  private stopping = false;

  constructor(env: ActionsHostEnv) {
    this.env = env;
  }

  async start(): Promise<{ spawned: string[] }> {
    const spawned: string[] = [];

    let entries: string[];
    try {
      entries = await readdir(ACTIONS_DIR);
    } catch (e: any) {
      if (e.code === "ENOENT") return { spawned };
      throw e;
    }

    for (const entry of entries) {
      const dir = join(ACTIONS_DIR, entry);
      try {
        const s = await stat(dir);
        if (!s.isDirectory()) continue;
      } catch { continue; }

      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;

      let manifest: ActionManifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      } catch { continue; }

      if (!manifest.id) continue;
      if (manifest.runtime && manifest.runtime !== "local") continue;

      const entrypoint = manifest.entrypoint ?? "handler.py";
      if (!existsSync(join(dir, entrypoint))) continue;

      const sup: SupervisedAction = {
        manifest,
        dir,
        child: null,
        startedAt: 0,
        backoffMs: RESTART_BACKOFF_MIN_MS,
        stopping: false,
        restartTimer: null,
      };
      this.actions.set(manifest.id, sup);
      this.spawnOne(sup);
      spawned.push(manifest.id);
    }

    return { spawned };
  }

  async stopAll(): Promise<void> {
    this.stopping = true;
    const pending: Promise<void>[] = [];
    for (const sup of this.actions.values()) {
      sup.stopping = true;
      if (sup.restartTimer) { clearTimeout(sup.restartTimer); sup.restartTimer = null; }
      if (!sup.child) continue;
      pending.push(new Promise<void>((resolve) => {
        const child = sup.child!;
        let done = false;
        const finish = () => { if (!done) { done = true; resolve(); } };
        child.once("exit", finish);
        try { child.kill("SIGTERM"); } catch { /* gone */ }
        setTimeout(() => {
          if (!done) {
            try { child.kill("SIGKILL"); } catch { /* gone */ }
            setTimeout(finish, 500);
          }
        }, SHUTDOWN_GRACE_MS);
      }));
    }
    await Promise.all(pending);
  }

  private spawnOne(sup: SupervisedAction): void {
    if (this.stopping || sup.stopping) return;

    const { manifest, dir } = sup;
    const entrypoint = manifest.entrypoint ?? "handler.py";
    const entrypointPath = join(dir, entrypoint);
    const sdkPythonDir = resolveSdkPythonDir();

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CLASH_SERVER_URL: this.env.serverUrl,
      CLASH_API_KEY: this.env.apiKey,
      CLASH_RUNTIME_ID: this.env.runtimeId,
    };
    if (sdkPythonDir) {
      const prev = process.env.PYTHONPATH;
      childEnv.PYTHONPATH = prev ? `${sdkPythonDir}:${prev}` : sdkPythonDir;
    }
    const pythonBin = process.env.CLASH_ACTIONS_PYTHON || "python3";
    process.stderr.write(
      `[canvas-connect] actions: spawn id=${manifest.id} bin=${pythonBin}\n`,
    );

    let child: ChildProcess;
    try {
      child = spawn(pythonBin, [entrypointPath], {
        cwd: dir,
        env: childEnv,
        stdio: ["ignore", "inherit", "inherit"],
      });
    } catch (e) {
      process.stderr.write(
        `[canvas-connect] actions: spawn failed id=${manifest.id} ${(e as Error).message}\n`,
      );
      return;
    }

    sup.child = child;
    sup.startedAt = Date.now();

    child.once("exit", (code, signal) => {
      const uptime = Date.now() - sup.startedAt;
      process.stderr.write(
        `[canvas-connect] actions: exit id=${manifest.id} code=${code} signal=${signal ?? "-"} uptime=${Math.round(uptime / 1000)}s\n`,
      );
      sup.child = null;
      if (uptime > HEALTHY_UPTIME_MS) sup.backoffMs = RESTART_BACKOFF_MIN_MS;
      if (this.stopping || sup.stopping) return;
      const delay = sup.backoffMs;
      sup.backoffMs = Math.min(sup.backoffMs * 2, RESTART_BACKOFF_MAX_MS);
      sup.restartTimer = setTimeout(() => {
        sup.restartTimer = null;
        this.spawnOne(sup);
      }, delay);
    });

    child.once("error", (err) => {
      process.stderr.write(
        `[canvas-connect] actions: child error id=${manifest.id} ${err.message}\n`,
      );
    });
  }
}

function resolveSdkPythonDir(): string | null {
  if (process.env.CLASH_ACTIONS_SDK_PATH) return process.env.CLASH_ACTIONS_SDK_PATH;
  // CLI is bundled as CJS, so we have __filename. The bundled file lives
  // at /…/packages/cli/dist/index.js; the SDK source is at
  // /…/packages/clash-sdk/python.
  try {
    const here = typeof __filename === "string" ? __filename : "";
    const idx = here.lastIndexOf("/packages/cli/");
    if (idx !== -1) return here.slice(0, idx) + "/packages/clash-sdk/python";
  } catch { /* fall through */ }
  return null;
}
