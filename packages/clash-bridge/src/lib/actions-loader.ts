/**
 * Custom action host — supervises Python (or other) subprocesses defined
 * under `~/.clash/actions/<id>/`.
 *
 * Each subdirectory contains:
 *   - manifest.json   (CustomActionDefinition shape; see shared-types)
 *   - handler.py      (Python action entrypoint, uses clash-sdk)
 *
 * On start() we scan the actions dir, spawn one subprocess per manifest,
 * and inherit credentials via env:
 *
 *   CLASH_SERVER_URL   ← from credentials.json
 *   CLASH_PROJECT_ID   ← unset (the SDK gates on global runtime, not project)
 *                        but the python example reads it; for now we wire
 *                        the user's "active project" by leaving it empty
 *                        and letting the daemon configure it via a separate
 *                        per-project field on the action manifest later.
 *   CLASH_API_KEY      ← creds.agentApiKey (clsh_*) — same token ACP agents use
 *   CLASH_RUNTIME_ID   ← creds.runtimeId — links registration to this machine
 *   PYTHONPATH         ← prepended with the workspace's clash-sdk python pkg
 *
 * Lifecycle:
 *   - bridge start  → spawn all
 *   - bridge stop   → SIGTERM all, await exit (5s deadline) then SIGKILL
 *   - subprocess exits unexpectedly → restart with exponential backoff
 *     (1s → 2s → 4s → … capped at 60s; reset after 60s of healthy uptime)
 *   - subprocess exits immediately → disable until the bridge restarts
 *
 * Design notes:
 *   - We deliberately do NOT speak to the WS server directly. Each action
 *     opens its own WS via the python SDK, so each action gets its own
 *     bidirectional channel and one slow handler can't block another. The
 *     bridge is just a supervisor that owns the lifecycle.
 *   - Manifest validation is lax — bad manifests just log and skip, so a
 *     single broken action doesn't take down the bridge. Sharper schema
 *     enforcement can live in a future install endpoint.
 *   - We don't tail child stdout/stderr into the bridge log on purpose:
 *     action authors usually want their own logs in their own format, and
 *     mixing them into the bridge log makes both harder to read. We do
 *     log spawn/exit lines at the bridge level for visibility.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, statSync, watch, type FSWatcher, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const ACTIONS_DIR = join(homedir(), ".clash", "actions");
const RESTART_BACKOFF_MIN_MS = 1000;
const RESTART_BACKOFF_MAX_MS = 60_000;
const HEALTHY_UPTIME_MS = 60_000;
const FAST_EXIT_DISABLE_MS = 2_000;
const SHUTDOWN_GRACE_MS = 5_000;
const PYTHON_DEPS_STAMP = ".clash-python-deps.json";
/**
 * Debounce window for fs.watch events. node's watcher fires
 * multiple times for a single semantic change (atomic rename →
 * rename + change; CLI install writes many files → change-per-file).
 * 500ms collapses those into one reconcile pass without making the
 * UX feel laggy.
 */
const WATCH_DEBOUNCE_MS = 500;

export interface ActionEnv {
  /** CLASH_SERVER_URL — full URL (http[s]://). The python SDK converts http→ws. */
  serverUrl: string;
  /** clsh_* API key used by the action's SDK for WS + REST auth. */
  apiKey: string;
  /** Runtime row id; forwarded as the x-runtime-id WS header. */
  runtimeId: string;
}

export interface ActionManifest {
  id: string;
  name: string;
  description?: string;
  outputType?: string;
  promptModalities?: string[];
  parameters?: unknown[];
  model?: Record<string, unknown>;
  secrets?: Array<Record<string, unknown>>;
  /** Must be "local" — worker-runtime actions don't get supervised here. */
  runtime?: string;
  /** Path relative to the action dir, e.g. "handler.py". */
  entrypoint?: string;
  version?: string;
  /**
   * Project ids the action attaches to. `"*"` (the default) means every
   * project this user is in. Currently logged on load but not yet acted
   * on — the supervisor still spawns one subprocess per action and the
   * SDK joins whatever single project the env supplies. Per-project
   * spawning lands in a future change; this field is read & logged now
   * so the contract is stable before then.
   */
  attachedProjects?: string[];
}

interface LoadedAction {
  manifest: ActionManifest;
  /** Absolute path to the action's directory. */
  dir: string;
}

interface SupervisedAction {
  loaded: LoadedAction;
  child: ChildProcess | null;
  startedAt: number;
  backoffMs: number;
  /** Set when stop() is called so the exit handler doesn't restart. */
  stopping: boolean;
  /** Pending restart timer (so stop() can clear it). */
  restartTimer: NodeJS.Timeout | null;
}

interface PythonDepsStamp {
  sdk?: string;
  requirements?: Record<string, string>;
}

export class ActionsHost {
  private actions = new Map<string, SupervisedAction>();
  /** Index by directory name (== entry) so the watcher can map fs paths to supervised entries. */
  private dirIndex = new Map<string, string>(); // dirName → action id
  private env: ActionEnv;
  private stopping = false;
  private watcher: FSWatcher | null = null;
  private watchDebounce: NodeJS.Timeout | null = null;

  constructor(env: ActionEnv) {
    this.env = env;
  }

  /**
   * Scan ~/.clash/actions/ and spawn a subprocess per local-runtime
   * action. No-op if the dir doesn't exist (a brand-new bridge install
   * just doesn't host any actions yet).
   */
  async start(): Promise<{ spawned: string[]; skipped: string[] }> {
    const spawned: string[] = [];
    const skipped: string[] = [];

    // Ensure the dir exists so we can immediately watch it. Without this,
    // a brand-new install would silently skip the watcher and the user
    // would have to restart the daemon after their first `action install`.
    // We create with mode 0755; mkdirSync is idempotent thanks to recursive.
    try {
      mkdirSync(ACTIONS_DIR, { recursive: true });
    } catch (e) {
      process.stderr.write(`actions: could not create ${ACTIONS_DIR}: ${(e as Error).message}\n`);
    }

    let entries: string[];
    try {
      entries = await readdir(ACTIONS_DIR);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        process.stderr.write(`actions: no ~/.clash/actions/ — skipping action host\n`);
        this.startWatcher();
        return { spawned, skipped };
      }
      throw e;
    }

    for (const entry of entries) {
      const result = await this.tryLoadAndSpawn(entry);
      if (result === "spawned") spawned.push(entry);
      else if (result === "skipped") skipped.push(entry);
    }

    this.startWatcher();
    return { spawned, skipped };
  }

  /**
   * Read ~/.clash/actions/<dirName>/manifest.json, validate, and spawn
   * (or skip) the subprocess. Returns the outcome so callers can update
   * their counters. Shared between start() and the fs.watch reconciler.
   */
  private async tryLoadAndSpawn(
    dirName: string,
  ): Promise<"spawned" | "skipped" | "ignored"> {
    const dir = join(ACTIONS_DIR, dirName);
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) return "ignored";
    } catch {
      return "ignored";
    }

    const manifestPath = join(dir, "manifest.json");
    if (!existsSync(manifestPath)) {
      process.stderr.write(`actions: ${dirName}: no manifest.json — skipping\n`);
      return "skipped";
    }

    let manifest: ActionManifest;
    try {
      manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
    } catch (e) {
      process.stderr.write(`actions: ${dirName}: invalid manifest.json (${(e as Error).message}) — skipping\n`);
      return "skipped";
    }

    if (!manifest.id) {
      process.stderr.write(`actions: ${dirName}: manifest missing id — skipping\n`);
      return "skipped";
    }
    if (manifest.runtime && manifest.runtime !== "local") {
      process.stderr.write(`actions: ${manifest.id}: runtime=${manifest.runtime} not local — skipping\n`);
      return "skipped";
    }

    const entrypoint = manifest.entrypoint ?? "handler.py";
    const entrypointPath = join(dir, entrypoint);
    if (!existsSync(entrypointPath)) {
      process.stderr.write(`actions: ${manifest.id}: entrypoint ${entrypoint} missing — skipping\n`);
      return "skipped";
    }

    if (manifest.attachedProjects && manifest.attachedProjects.length > 0) {
      process.stderr.write(
        `actions: ${manifest.id}: attachedProjects=${JSON.stringify(manifest.attachedProjects)} ` +
          `(field reserved; honored on next bridge restart in a future change)\n`,
      );
    }

    const loaded: LoadedAction = { manifest, dir };
    const supervised: SupervisedAction = {
      loaded,
      child: null,
      startedAt: 0,
      backoffMs: RESTART_BACKOFF_MIN_MS,
      stopping: false,
      restartTimer: null,
    };
    this.actions.set(manifest.id, supervised);
    this.dirIndex.set(dirName, manifest.id);
    this.spawnOne(supervised);
    return "spawned";
  }

  /**
   * Stop every supervised action — SIGTERM, then SIGKILL after 5s grace.
   * Resolves once all children have exited (or the grace timer fires).
   */
  async stopAll(): Promise<void> {
    this.stopping = true;
    if (this.watcher) {
      try { this.watcher.close(); } catch { /* already closed */ }
      this.watcher = null;
    }
    if (this.watchDebounce) {
      clearTimeout(this.watchDebounce);
      this.watchDebounce = null;
    }
    const pending: Promise<void>[] = [];

    for (const sup of this.actions.values()) {
      sup.stopping = true;
      if (sup.restartTimer) {
        clearTimeout(sup.restartTimer);
        sup.restartTimer = null;
      }
      if (!sup.child) continue;

      pending.push(new Promise<void>((resolve) => {
        const child = sup.child!;
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        child.once("exit", finish);
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        setTimeout(() => {
          if (!resolved) {
            try { child.kill("SIGKILL"); } catch { /* already gone */ }
            // give SIGKILL a moment to land; either way, resolve so
            // shutdown isn't blocked indefinitely on a stuck child.
            setTimeout(finish, 500);
          }
        }, SHUTDOWN_GRACE_MS);
      }));
    }

    await Promise.all(pending);
  }

  /** Convenience for diagnostics — what's currently being hosted. */
  listIds(): string[] {
    return [...this.actions.keys()];
  }

  // ─── fs.watch / reconciliation ──────────────────────────────
  //
  // node's fs.watch is intentionally minimal — it tells us *something*
  // changed under ACTIONS_DIR but not what. So we use it purely as a
  // change signal and call reconcile() (a full diff between disk state
  // and the supervised map) on a 500ms debounce. That keeps the logic
  // robust against:
  //   - editor save-and-rename (atomic rename → multiple change events)
  //   - CLI install writing handler.py before manifest.json (interim
  //     state is "manifest exists but entrypoint missing")
  //   - `rm -rf` deleting many files in quick succession
  //
  // recursive:true is supported on macOS/Windows. On Linux it requires
  // node ≥20; if the host is older we log and fall back to top-level
  // watching (good enough for "add/remove an action dir" — only nested
  // file edits without a manifest touch get missed).

  private startWatcher(): void {
    if (this.stopping) return;
    if (this.watcher) return;
    try {
      this.watcher = watch(
        ACTIONS_DIR,
        { recursive: true, persistent: false },
        (_eventType, filename) => {
          // Ignore swap/temp files that editors create — they churn the
          // debouncer for changes we don't care about.
          if (typeof filename === "string" && /\.swp$|~$|\.swx$/.test(filename)) return;
          this.scheduleReconcile();
        },
      );
      this.watcher.on("error", (err) => {
        process.stderr.write(`actions: watcher error ${err.message}\n`);
      });
      process.stderr.write(`actions: watching ${ACTIONS_DIR} for changes\n`);
    } catch (e) {
      // Likely linux <20 without recursive support, or an exotic FS.
      // We still function — just no auto-reload.
      process.stderr.write(
        `actions: fs.watch unavailable (${(e as Error).message}); auto-reload disabled\n`,
      );
    }
  }

  private scheduleReconcile(): void {
    if (this.stopping) return;
    if (this.watchDebounce) clearTimeout(this.watchDebounce);
    this.watchDebounce = setTimeout(() => {
      this.watchDebounce = null;
      this.reconcile().catch((e) => {
        process.stderr.write(`actions: reconcile failed: ${(e as Error).message}\n`);
      });
    }, WATCH_DEBOUNCE_MS);
  }

  /**
   * Diff disk against the supervised map:
   *   - new dir with valid manifest                  → tryLoadAndSpawn
   *   - existing id, manifest version changed        → restart subprocess
   *   - dir / manifest disappeared                   → stopOne
   *
   * Logged as `actions: reloaded id=…` so the bridge log surfaces each
   * lifecycle event in one place (alongside the existing
   * `actions: spawn id=…` and `actions: exit id=…` lines).
   */
  private async reconcile(): Promise<void> {
    if (this.stopping) return;

    let entries: string[];
    try {
      entries = await readdir(ACTIONS_DIR);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        // Whole dir vanished — tear down everything we host.
        for (const id of [...this.actions.keys()]) await this.stopOne(id, "dir-removed");
        return;
      }
      throw e;
    }

    const liveDirs = new Set<string>();

    for (const entry of entries) {
      const dir = join(ACTIONS_DIR, entry);
      try {
        const s = await stat(dir);
        if (!s.isDirectory()) continue;
      } catch { continue; }
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      liveDirs.add(entry);

      // Read the manifest fresh — same validation as start().
      let manifest: ActionManifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
      } catch {
        // Half-written manifest mid-install. Skip; debounce will fire
        // again once the writer finishes.
        continue;
      }
      if (!manifest.id) continue;
      if (manifest.runtime && manifest.runtime !== "local") continue;

      const entrypoint = manifest.entrypoint ?? "handler.py";
      if (!existsSync(join(dir, entrypoint))) continue;

      const existing = this.actions.get(manifest.id);
      if (!existing) {
        process.stderr.write(`actions: new manifest detected dir=${entry} id=${manifest.id}\n`);
        await this.tryLoadAndSpawn(entry);
        process.stderr.write(`actions: reloaded id=${manifest.id} (added)\n`);
        continue;
      }

      // Restart on version change, entrypoint change, or any
      // material manifest delta. We compare on serialized manifest
      // so renames / parameter tweaks also pick up — the cost of a
      // restart is small and correctness > minimal disturbance.
      const oldKey = manifestKey(existing.loaded.manifest);
      const newKey = manifestKey(manifest);
      if (oldKey !== newKey) {
        process.stderr.write(
          `actions: manifest changed id=${manifest.id} (was v=${existing.loaded.manifest.version ?? "?"} now v=${manifest.version ?? "?"})\n`,
        );
        await this.restartOne(entry, manifest, dir);
        process.stderr.write(`actions: reloaded id=${manifest.id} (restarted)\n`);
      }
    }

    // Anything we host but is no longer on disk → SIGTERM.
    for (const [dirName, id] of [...this.dirIndex.entries()]) {
      if (!liveDirs.has(dirName)) {
        await this.stopOne(id, "manifest-removed");
        process.stderr.write(`actions: reloaded id=${id} (removed)\n`);
      }
    }
  }

  /**
   * SIGTERM the given action and drop it from the supervised map. Used
   * by the watcher when a manifest disappears (CLI uninstall, rm -rf).
   * Mirrors stopAll() for a single entry; reason is logged for grep-ability.
   */
  private async stopOne(id: string, reason: string): Promise<void> {
    const sup = this.actions.get(id);
    if (!sup) return;
    process.stderr.write(`actions: stopOne id=${id} reason=${reason}\n`);

    sup.stopping = true;
    if (sup.restartTimer) {
      clearTimeout(sup.restartTimer);
      sup.restartTimer = null;
    }

    const child = sup.child;
    if (child) {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => {
          if (resolved) return;
          resolved = true;
          resolve();
        };
        child.once("exit", finish);
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        setTimeout(() => {
          if (!resolved) {
            try { child.kill("SIGKILL"); } catch { /* already gone */ }
            setTimeout(finish, 500);
          }
        }, SHUTDOWN_GRACE_MS);
      });
    }

    this.actions.delete(id);
    // Drop the dir → id mapping too. find-by-value because the dirIndex
    // is keyed by directory name, not id.
    for (const [dirName, mappedId] of this.dirIndex.entries()) {
      if (mappedId === id) this.dirIndex.delete(dirName);
    }
  }

  /**
   * Replace an existing supervised action with a freshly-loaded one.
   * Internally: stopOne (SIGTERM) then tryLoadAndSpawn against the new
   * manifest. Used by reconcile() when a manifest version (or any
   * material field) changes on disk.
   */
  private async restartOne(
    dirName: string,
    _newManifest: ActionManifest,
    _dir: string,
  ): Promise<void> {
    const oldId = this.dirIndex.get(dirName);
    if (oldId) await this.stopOne(oldId, "manifest-changed");
    await this.tryLoadAndSpawn(dirName);
  }

  // ─── internals ──────────────────────────────────────────────

  private spawnOne(sup: SupervisedAction): void {
    if (this.stopping || sup.stopping) return;

    const { manifest, dir } = sup.loaded;
    const entrypoint = manifest.entrypoint ?? "handler.py";
    const entrypointPath = join(dir, entrypoint);

    // Locate the workspace clash-sdk python source so the subprocess can
    // import it without a pip install. In dev, this lives at
    //   <repo>/packages/clash-sdk/python
    // We chase it relative to the bridge's own dist/ — `import.meta.url`
    // resolves to file://.../packages/clash-bridge/dist/cli.js, so going
    // up three levels lands us at the packages/ root.
    const sdkPythonDir = resolveSdkPythonDir();

    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CLASH_SERVER_URL: this.env.serverUrl,
      CLASH_API_KEY: this.env.apiKey,
      CLASH_RUNTIME_ID: this.env.runtimeId,
      // The example actions read this; bridge doesn't pin a project, so
      // a single-project demo can override via the manifest in future.
      // For now leaving it unset is fine — actions that need it should
      // be parameterised by the canvas dispatch payload, not env.
    };
    if (sdkPythonDir) {
      const prev = process.env.PYTHONPATH;
      childEnv.PYTHONPATH = prev ? `${sdkPythonDir}:${prev}` : sdkPythonDir;
    }

    // Pick interpreter by entrypoint file extension.
    //
    // - `.py`              → prepared Python runtime (managed venv by default,
    //                        or CLASH_ACTIONS_PYTHON as an explicit interpreter)
    // - `.js` / `.mjs`     → node from current process (process.execPath)
    // - `.ts`              → not supported in production; reject so action
    //                        authors compile to .js (the marketplace install
    //                        endpoint serves built .js, not .ts).
    //
    // Why two languages: we ship both a Python SDK (existing) and a JS SDK
    // (`@clash-space/sdk`). The wire protocol is identical; only the host
    // language differs. The bridge is interpreter-agnostic — it just spawns
    // whatever runtime the manifest's entrypoint demands.
    const ext = entrypoint.toLowerCase().slice(entrypoint.lastIndexOf("."));
    let bin: string;
    let args: string[];
    if (ext === ".py") {
      const explicitPython = process.env.CLASH_ACTIONS_PYTHON;
      const pythonBin = explicitPython
        ? prepareExplicitPythonRuntime({
          pythonBin: explicitPython,
          actionId: manifest.id,
          actionDir: dir,
          sdkPythonDir,
          logPrefix: "",
        })
        : prepareManagedPythonRuntime({
          actionId: manifest.id,
          actionDir: dir,
          sdkPythonDir,
          logPrefix: "",
        });
      if (!pythonBin) return;
      bin = pythonBin;
      args = [entrypointPath];
    } else if (ext === ".js" || ext === ".mjs") {
      bin = process.execPath; // same node that's running this bridge
      args = [entrypointPath];
    } else if (ext === ".ts") {
      process.stderr.write(
        `actions: ${manifest.id}: .ts entrypoint not supported — compile to .js before installing\n`,
      );
      return;
    } else {
      process.stderr.write(
        `actions: ${manifest.id}: unknown entrypoint extension '${ext}' — expected .py / .js / .mjs\n`,
      );
      return;
    }

    process.stderr.write(
      `actions: spawn id=${manifest.id} entrypoint=${entrypoint} bin=${bin}\n`,
    );

    let child: ChildProcess;
    try {
      child = spawn(bin, args, {
        cwd: dir,
        env: childEnv,
        // Inherit stdio so action logs land in the bridge's stdout/stderr.
        // For production we'd route per-action log files; fine for now.
        stdio: ["ignore", "inherit", "inherit"],
      });
    } catch (e) {
      process.stderr.write(`actions: ${manifest.id}: spawn failed (${(e as Error).message})\n`);
      return;
    }

    sup.child = child;
    sup.startedAt = Date.now();

    child.once("exit", (code, signal) => {
      const uptime = Date.now() - sup.startedAt;
      process.stderr.write(
        `actions: exit id=${manifest.id} code=${code} signal=${signal ?? "-"} uptime=${Math.round(uptime / 1000)}s\n`,
      );
      sup.child = null;

      // If we ran healthy for a while, reset backoff. Otherwise scale.
      if (uptime > HEALTHY_UPTIME_MS) {
        sup.backoffMs = RESTART_BACKOFF_MIN_MS;
      }

      if (this.stopping || sup.stopping) return;

      if (uptime < FAST_EXIT_DISABLE_MS) {
        sup.stopping = true;
        process.stderr.write(
          `actions: disabled id=${manifest.id} reason=fast-exit code=${code ?? "-"} signal=${signal ?? "-"}; fix the action and restart the bridge\n`,
        );
        return;
      }

      const delay = sup.backoffMs;
      sup.backoffMs = Math.min(sup.backoffMs * 2, RESTART_BACKOFF_MAX_MS);
      process.stderr.write(
        `actions: restart id=${manifest.id} in ${delay}ms\n`,
      );
      sup.restartTimer = setTimeout(() => {
        sup.restartTimer = null;
        this.spawnOne(sup);
      }, delay);
    });

    child.once("error", (err) => {
      process.stderr.write(`actions: ${manifest.id}: child error ${err.message}\n`);
    });
  }
}

/**
 * Hash-equivalent of a manifest for change detection. We could deep-compare
 * but reconcile() only fires on a watcher tick — JSON.stringify is fast
 * enough, and key order is stable since we control the writer.
 */
function manifestKey(m: ActionManifest): string {
  return JSON.stringify({
    id: m.id,
    name: m.name,
    version: m.version,
    runtime: m.runtime,
    entrypoint: m.entrypoint,
    parameters: m.parameters,
    outputType: m.outputType,
    promptModalities: m.promptModalities,
    attachedProjects: m.attachedProjects,
  });
}

/**
 * Best-effort: find the bundled `packages/clash-sdk/python` dir relative
 * to the running bridge entrypoint. Used to inject PYTHONPATH so action
 * authors don't need a `pip install` step during dev.
 */
function resolveSdkPythonDir(): string | null {
  // CLASH_ACTIONS_SDK_PATH lets prod / packaged installs point at a
  // pip-installed location without bundling the source tree.
  if (process.env.CLASH_ACTIONS_SDK_PATH) {
    return process.env.CLASH_ACTIONS_SDK_PATH;
  }
  // In the dev monorepo, the bridge runs out of packages/clash-bridge/dist/
  // and the SDK source lives at ../clash-sdk/python relative to it.
  try {
    const here = new URL(import.meta.url).pathname;
    // here = /…/packages/clash-bridge/dist/cli.js (or commands/daemon.js)
    // walk up to packages/ then dive into clash-sdk/python.
    const idx = here.lastIndexOf("/packages/clash-bridge/");
    if (idx !== -1) {
      return here.slice(0, idx) + "/packages/clash-sdk/python";
    }
  } catch { /* fall through */ }
  return null;
}

function managedPythonVenvDir(): string {
  return process.env.CLASH_ACTIONS_VENV || join(ACTIONS_DIR, ".venv");
}

function managedPythonBin(venvDir: string): string {
  return process.platform === "win32"
    ? join(venvDir, "Scripts", "python.exe")
    : join(venvDir, "bin", "python");
}

function explicitPythonStampDir(pythonBin: string): string {
  const key = Buffer.from(pythonBin).toString("base64url").slice(0, 80);
  return join(ACTIONS_DIR, ".python-deps", key);
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
