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

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const RESTART_BACKOFF_MIN_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 60_000;
const HEALTHY_UPTIME_MS = 60_000;
const FAST_EXIT_DISABLE_MS = 2_000;
const SHUTDOWN_GRACE_MS = 5_000;
const PYTHON_DEPS_STAMP = ".clash-python-deps.json";

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

interface PythonDepsStamp {
  sdk?: string;
  requirements?: Record<string, string>;
}

export interface ActionsHostEnv {
  serverUrl: string;
  apiKey: string;
  /** Reused from the bridge's credentials.json — same machine, same runtime. */
  runtimeId: string;
  /** Set by `canvas connect`; local custom actions register against this project room. */
  projectId?: string;
}

export function readBridgeRuntimeId(): { runtimeId: string; apiKey: string; serverUrl: string } | null {
  const path = credsPath();
  if (!existsSync(path)) return null;
  try {
    const creds = JSON.parse(readFileSync(path, "utf-8"));
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
    const root = actionsDir();

    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (e: any) {
      if (e.code === "ENOENT") return { spawned };
      throw e;
    }

    for (const entry of entries) {
      const dir = join(root, entry);
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
      if (await this.spawnOne(sup)) spawned.push(manifest.id);
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

  private async spawnOne(sup: SupervisedAction): Promise<boolean> {
    if (this.stopping || sup.stopping) return false;

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
    if (this.env.projectId) childEnv.CLASH_PROJECT_ID = this.env.projectId;
    if (sdkPythonDir) {
      const prev = process.env.PYTHONPATH;
      childEnv.PYTHONPATH = prev ? `${sdkPythonDir}:${prev}` : sdkPythonDir;
    }
    const explicitPython = process.env.CLASH_ACTIONS_PYTHON;
    const pythonBin = explicitPython
      ? prepareExplicitPythonRuntime({
        pythonBin: explicitPython,
        actionId: manifest.id,
        actionDir: dir,
        sdkPythonDir,
        logPrefix: "[canvas-connect] ",
      })
      : prepareManagedPythonRuntime({
        actionId: manifest.id,
        actionDir: dir,
        sdkPythonDir,
        logPrefix: "[canvas-connect] ",
      });
    if (!pythonBin) return false;

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
      return false;
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
      if (uptime < FAST_EXIT_DISABLE_MS) {
        sup.stopping = true;
        process.stderr.write(
          `[canvas-connect] actions: disabled id=${manifest.id} reason=fast-exit code=${code ?? "-"} signal=${signal ?? "-"}; fix the action and restart canvas connect\n`,
        );
        return;
      }
      const delay = sup.backoffMs;
      sup.backoffMs = Math.min(sup.backoffMs * 2, RESTART_BACKOFF_MAX_MS);
      sup.restartTimer = setTimeout(() => {
        sup.restartTimer = null;
        void this.spawnOne(sup);
      }, delay);
    });

    child.once("error", (err) => {
      process.stderr.write(
        `[canvas-connect] actions: child error id=${manifest.id} ${err.message}\n`,
      );
    });
    return true;
  }
}

function actionsDir(): string {
  return join(homedir(), ".clash", "actions");
}

function credsPath(): string {
  return join(homedir(), ".clash", "credentials.json");
}

function managedPythonVenvDir(): string {
  return process.env.CLASH_ACTIONS_VENV || join(actionsDir(), ".venv");
}

function managedPythonBin(venvDir: string): string {
  return process.platform === "win32"
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");
}

function explicitPythonStampDir(pythonBin: string): string {
  const key = Buffer.from(pythonBin).toString("base64url").slice(0, 80);
  return join(actionsDir(), ".python-deps", key);
}

function prepareExplicitPythonRuntime(opts: {
  pythonBin: string;
  actionId: string;
  actionDir: string;
  sdkPythonDir: string | null;
  logPrefix: string;
}): string | null {
  return preparePythonRuntimeDeps({
    pythonBin: opts.pythonBin,
    stampDir: explicitPythonStampDir(opts.pythonBin),
    actionId: opts.actionId,
    actionDir: opts.actionDir,
    sdkPythonDir: opts.sdkPythonDir,
    logPrefix: opts.logPrefix,
  });
}

function prepareManagedPythonRuntime(opts: {
  actionId: string;
  actionDir: string;
  sdkPythonDir: string | null;
  logPrefix: string;
}): string | null {
  const venvDir = managedPythonVenvDir();
  const pythonBin = managedPythonBin(venvDir);

  if (!existsSync(pythonBin)) {
    mkdirSync(venvDir, { recursive: true });
    process.stderr.write(`${opts.logPrefix}actions: python venv create path=${venvDir}\n`);
    if (!runPythonSetup("python3", ["-m", "venv", venvDir], opts.logPrefix, opts.actionId)) {
      return null;
    }
  }

  return preparePythonRuntimeDeps({
    pythonBin,
    stampDir: venvDir,
    actionId: opts.actionId,
    actionDir: opts.actionDir,
    sdkPythonDir: opts.sdkPythonDir,
    logPrefix: opts.logPrefix,
  });
}

function preparePythonRuntimeDeps(opts: {
  pythonBin: string;
  stampDir: string;
  actionId: string;
  actionDir: string;
  sdkPythonDir: string | null;
  logPrefix: string;
}): string | null {
  const { pythonBin } = opts;
  const stamp = readPythonDepsStamp(opts.stampDir);
  let changed = false;
  if (opts.sdkPythonDir && existsSync(join(opts.sdkPythonDir, "pyproject.toml"))) {
    const sdkKey = `${opts.sdkPythonDir}:${fileVersionKey(join(opts.sdkPythonDir, "pyproject.toml"))}`;
    const sdkStampMatches = stamp.sdk === sdkKey;
    const sdkImportsOk = sdkStampMatches
      ? canImportPythonSdkRuntimeDeps(pythonBin, opts.logPrefix, opts.actionId, false)
      : false;
    if (!sdkStampMatches || !sdkImportsOk) {
      process.stderr.write(`${opts.logPrefix}actions: python deps install id=${opts.actionId} package=clash-sdk\n`);
      if (!runPythonSetup(pythonBin, ["-m", "pip", "install", "-e", opts.sdkPythonDir], opts.logPrefix, opts.actionId)) {
        return null;
      }
      stamp.sdk = sdkKey;
      changed = true;
    }
    if (!canImportPythonSdkRuntimeDeps(pythonBin, opts.logPrefix, opts.actionId, true)) {
      return null;
    }
  }

  const requirementsPath = join(opts.actionDir, "requirements.txt");
  if (existsSync(requirementsPath)) {
    const requirements = stamp.requirements ?? {};
    const requirementsKey = fileVersionKey(requirementsPath);
    if (requirements[opts.actionDir] !== requirementsKey) {
      process.stderr.write(`${opts.logPrefix}actions: python deps install id=${opts.actionId} requirements=${requirementsPath}\n`);
      if (!runPythonSetup(pythonBin, ["-m", "pip", "install", "-r", requirementsPath], opts.logPrefix, opts.actionId)) {
        return null;
      }
      requirements[opts.actionDir] = requirementsKey;
      stamp.requirements = requirements;
      changed = true;
    }
  }

  if (changed) writePythonDepsStamp(opts.stampDir, stamp);
  return pythonBin;
}

function canImportPythonSdkRuntimeDeps(
  pythonBin: string,
  logPrefix: string,
  actionId: string,
  verbose: boolean,
): boolean {
  const result = spawnSync(pythonBin, ["-c", "import clash_sdk; import aiohttp"], {
    env: process.env,
    stdio: verbose ? "inherit" : "ignore",
  });
  if (result.status === 0) return true;
  if (verbose) {
    const detail = result.error instanceof Error ? result.error.message : `exit=${result.status}`;
    process.stderr.write(
      `${logPrefix}actions: python deps import failed id=${actionId} modules=clash_sdk,aiohttp ${detail}\n`,
    );
  }
  return false;
}

function runPythonSetup(bin: string, args: string[], logPrefix: string, actionId: string): boolean {
  const result = spawnSync(bin, args, {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status === 0) return true;
  const detail = result.error instanceof Error ? result.error.message : `exit=${result.status}`;
  process.stderr.write(`${logPrefix}actions: python deps failed id=${actionId} command=${bin} ${args.join(" ")} ${detail}\n`);
  return false;
}

function readPythonDepsStamp(venvDir: string): PythonDepsStamp {
  const path = join(venvDir, PYTHON_DEPS_STAMP);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as PythonDepsStamp;
  } catch {
    return {};
  }
}

function writePythonDepsStamp(venvDir: string, stamp: PythonDepsStamp): void {
  mkdirSync(venvDir, { recursive: true });
  writeFileSync(join(venvDir, PYTHON_DEPS_STAMP), JSON.stringify(stamp, null, 2) + "\n");
}

function fileVersionKey(path: string): string {
  const s = statSync(path);
  return `${s.size}:${Math.round(s.mtimeMs)}`;
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
