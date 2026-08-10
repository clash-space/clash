/**
 * Custom action host — supervises Python (or other) subprocesses defined
 * under `$CLASH_HOME/actions/<id>/`.
 *
 * Each subdirectory contains:
 *   - manifest.json   (CustomActionDefinition shape; see shared-types)
 *   - handler.py      (Python action entrypoint, uses clash-sdk)
 *
 * On start() we scan the actions dir and spawn one subprocess per manifest.
 * Legacy Custom Actions inherit the original SDK credentials for backwards
 * compatibility. `clash.plugin/v1` processes use credential-free stdio and
 * must request assets, secrets, and external operations from the Bridge.
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
 *   - Legacy actions still open their own WS via the Python/JS SDK.
 *   - Executable Plugins are strictly validated with all declared Cards and
 *     function links before the process is spawned.
 *   - We don't tail child stdout/stderr into the bridge log on purpose:
 *     action authors usually want their own logs in their own format, and
 *     mixing them into the bridge log makes both harder to read. We do
 *     log spawn/exit lines at the bridge level for visibility.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { deepStrictEqual } from "node:assert";
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, watch, type FSWatcher, writeFileSync } from "node:fs";
import { join, delimiter, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  ExecutablePluginActivationReceiptSchema,
  ExecutablePluginManifestSchema,
  ExecutablePluginInvocationSchema,
  isSafePluginRelativePath,
  validateExecutablePluginPackage,
  type ExecutablePluginResult,
  type ExecutablePluginManifest,
  type ExecutablePluginBinding,
  type ExecutablePluginCardRegistration,
  type ExecutablePluginProviderRegistration,
  type ExecutablePluginModelBindingRegistration,
  type ExecutablePluginActivationReceipt,
  type ExecutablePluginCardDocument,
  type ExecutablePluginProviderDocument,
  type ExecutablePluginModelBindingDocument,
  type ExecutablePluginContractTestDocument,
  resolvePluginLanguage,
} from "@clash/shared-types";
import { paths } from "./platform.js";
import {
  executablePluginBrokerPermissionError,
  PluginStdioSession,
  type PluginBroker,
} from "./plugin-stdio-runner.js";

export { executablePluginBrokerPermissionError, PluginStdioSession };
export type { PluginBroker };

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

const PLUGIN_NETWORK_GUARD = `data:text/javascript,${encodeURIComponent(`
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import dns from "node:dns";
import { syncBuiltinESMExports } from "node:module";
const denied = () => {
  const error = new Error("Direct plugin network access is denied; use the Clash capability broker.");
  error.code = "ERR_CLASH_PLUGIN_NETWORK_DENIED";
  throw error;
};
globalThis.fetch = async () => denied();
for (const [target, keys] of [
  [http, ["request", "get"]],
  [https, ["request", "get"]],
  [net, ["connect", "createConnection"]],
  [tls, ["connect"]],
  [dgram, ["createSocket"]],
  [dns, ["lookup", "resolve", "resolve4", "resolve6"]],
]) {
  for (const key of keys) {
    try { target[key] = denied; } catch {}
  }
}
try { net.Socket.prototype.connect = denied; } catch {}
try { tls.TLSSocket.prototype.connect = denied; } catch {}
syncBuiltinESMExports();
`)}`;

function actionsDir(): string {
  return join(paths().configDir, "actions");
}

export interface ActionEnv {
  /** CLASH_SERVER_URL — full URL (http[s]://). The python SDK converts http→ws. */
  serverUrl: string;
  /** clsh_* API key used by the action's SDK for WS + REST auth. */
  apiKey: string;
  /** Runtime row id; forwarded as the x-runtime-id WS header. */
  runtimeId: string;
  /** Kernel-owned capability broker for v1 stdio plugins. */
  pluginBroker?: PluginBroker;
  /** Override for embedded/self-hosted kernels that share Bridge hosting code. */
  actionsRoot?: string;
  /** Do not launch legacy websocket actions in an embedded plugin-only host. */
  executablePluginsOnly?: boolean;
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

type HostedActionManifest = ActionManifest | ExecutablePluginManifest;

function isExecutablePluginManifest(
  manifest: HostedActionManifest | Record<string, unknown>,
): manifest is ExecutablePluginManifest {
  return "apiVersion" in manifest && manifest.apiVersion === "clash.plugin/v1";
}

function hostedEntrypoint(manifest: HostedActionManifest): string {
  return isExecutablePluginManifest(manifest)
    ? manifest.runtime.kind === "local" ? manifest.runtime.entrypoint : ""
    : manifest.entrypoint ?? "handler.py";
}

interface HostedActionPackage {
  manifest: HostedActionManifest;
  cards: Record<string, ExecutablePluginCardDocument>;
  providers: Record<string, ExecutablePluginProviderDocument>;
  modelBindings: Record<string, ExecutablePluginModelBindingDocument>;
  contractTests: Record<string, ExecutablePluginContractTestDocument>;
}

async function readHostedPackage(dir: string): Promise<HostedActionPackage> {
  const raw = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as Record<string, unknown>;
  if (raw.apiVersion !== "clash.plugin/v1") {
    return {
      manifest: raw as unknown as ActionManifest,
      cards: {},
      providers: {},
      modelBindings: {},
      contractTests: {},
    };
  }

  const manifest = ExecutablePluginManifestSchema.parse(raw);
  if (manifest.runtime.kind !== "local") {
    throw new Error(`runtime=${manifest.runtime.kind} is not local`);
  }
  const cards: Record<string, unknown> = {};
  for (const card of manifest.exports.cards) {
    cards[card.path] = JSON.parse(await readFile(join(dir, card.path), "utf8"));
  }
  const providers: Record<string, unknown> = {};
  for (const provider of manifest.exports.providers) {
    providers[provider.path] = JSON.parse(await readFile(join(dir, provider.path), "utf8"));
  }
  const modelBindings: Record<string, unknown> = {};
  for (const binding of manifest.exports.modelBindings) {
    modelBindings[binding.path] = JSON.parse(await readFile(join(dir, binding.path), "utf8"));
  }
  const contractTests: Record<string, unknown> = {};
  for (const path of manifest.contractTests) {
    contractTests[path] = JSON.parse(await readFile(join(dir, path), "utf8"));
  }
  return validateExecutablePluginPackage(manifest, cards, contractTests, {
    providers,
    modelBindings,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function executablePluginSchemaHash(
  manifest: ExecutablePluginManifest,
  cards: Record<string, ExecutablePluginCardDocument>,
  providers: Record<string, ExecutablePluginProviderDocument> = {},
  modelBindings: Record<string, ExecutablePluginModelBindingDocument> = {},
): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalJson({
    apiVersion: manifest.apiVersion,
    id: manifest.id,
    version: manifest.version,
    exports: manifest.exports,
    permissions: manifest.permissions,
    cards,
    providers,
    modelBindings,
  })).digest("hex")}`;
}

async function executablePluginContentFiles(
  root: string,
  directory: string,
  output: Array<{ path: string; contents: Buffer }>,
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const path = relative(root, absolutePath).split("\\").join("/");
    const metadata = await lstat(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`Executable plugin content cannot contain symbolic links: ${path}`);
    }
    if (metadata.isDirectory()) {
      await executablePluginContentFiles(root, absolutePath, output);
      continue;
    }
    if (metadata.isFile()) output.push({ path, contents: await readFile(absolutePath) });
  }
}

export async function executablePluginDirectoryContentHash(
  pluginDirInput: string,
): Promise<`sha256:${string}`> {
  const pluginDir = realpathSync(pluginDirInput);
  const files: Array<{ path: string; contents: Buffer }> = [];
  await executablePluginContentFiles(pluginDir, pluginDir, files);
  files.sort((left, right) => left.path.localeCompare(right.path));
  const digest = createHash("sha256");
  for (const file of files) {
    digest.update(file.path);
    digest.update("\0");
    digest.update(String(file.contents.byteLength));
    digest.update("\0");
    digest.update(file.contents);
    digest.update("\0");
  }
  return `sha256:${digest.digest("hex")}`;
}

export function executablePluginActivationReceiptPath(
  actionsRoot: string,
  pluginId: string,
): string {
  return join(`${actionsRoot}.activations`, `${pluginId}.json`);
}

export async function createExecutablePluginActivationReceipt(
  pluginDir: string,
): Promise<ExecutablePluginActivationReceipt> {
  const hostedPackage = await readHostedPackage(pluginDir);
  if (!isExecutablePluginManifest(hostedPackage.manifest)) {
    throw new Error("Activation receipts require a clash.plugin/v1 manifest.");
  }
  return ExecutablePluginActivationReceiptSchema.parse({
    apiVersion: "clash.plugin.activation/v1",
    pluginId: hostedPackage.manifest.id,
    version: hostedPackage.manifest.version,
    schemaHash: executablePluginSchemaHash(
      hostedPackage.manifest,
      hostedPackage.cards,
      hostedPackage.providers,
      hostedPackage.modelBindings,
    ),
    contentHash: await executablePluginDirectoryContentHash(pluginDir),
    activatedAt: new Date().toISOString(),
  });
}

async function verifyExecutablePluginActivation(
  actionsRoot: string,
  pluginDir: string,
  manifest: ExecutablePluginManifest,
  cards: Record<string, ExecutablePluginCardDocument>,
  providers: Record<string, ExecutablePluginProviderDocument>,
  modelBindings: Record<string, ExecutablePluginModelBindingDocument>,
): Promise<void> {
  const receiptFile = executablePluginActivationReceiptPath(actionsRoot, manifest.id);
  let receipt: ExecutablePluginActivationReceipt;
  try {
    receipt = ExecutablePluginActivationReceiptSchema.parse(
      JSON.parse(await readFile(receiptFile, "utf8")),
    );
  } catch (error) {
    throw new Error(
      `Plugin ${manifest.id} has no valid activation receipt; use clash action activate. `
        + `${(error as Error).message}`,
    );
  }
  const schemaHash = executablePluginSchemaHash(manifest, cards, providers, modelBindings);
  const contentHash = await executablePluginDirectoryContentHash(pluginDir);
  if (receipt.pluginId !== manifest.id
    || receipt.version !== manifest.version
    || receipt.schemaHash !== schemaHash
    || receipt.contentHash !== contentHash) {
    throw new Error(
      `Plugin ${manifest.id}@${manifest.version} differs from its activated content; `
        + "bump the version and run clash action activate.",
    );
  }
}

interface LoadedAction {
  manifest: HostedActionManifest;
  /** Absolute path to the action's directory. */
  dir: string;
  cards: Record<string, ExecutablePluginCardDocument>;
  providers: Record<string, ExecutablePluginProviderDocument>;
  modelBindings: Record<string, ExecutablePluginModelBindingDocument>;
  schemaHash?: `sha256:${string}`;
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
  /** Present only for credential-free clash.plugin/v1 processes. */
  session: PluginStdioSession | null;
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
  private readonly root: string;

  constructor(env: ActionEnv) {
    this.env = env;
    this.root = env.actionsRoot ?? actionsDir();
  }

  /**
   * Scan $CLASH_HOME/actions/ and spawn a subprocess per local-runtime
   * action. No-op if the dir doesn't exist (a brand-new bridge install
   * just doesn't host any actions yet).
   */
  async start(): Promise<{ spawned: string[]; skipped: string[] }> {
    const spawned: string[] = [];
    const skipped: string[] = [];
    const root = this.root;

    // Ensure the dir exists so we can immediately watch it. Without this,
    // a brand-new install would silently skip the watcher and the user
    // would have to restart the daemon after their first `action install`.
    // We create with mode 0755; mkdirSync is idempotent thanks to recursive.
    try {
      mkdirSync(root, { recursive: true });
    } catch (e) {
      process.stderr.write(`actions: could not create ${root}: ${(e as Error).message}\n`);
    }

    let entries: string[];
    try {
      entries = await readdir(root);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        process.stderr.write(`actions: no ${root} — skipping action host\n`);
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
   * Read $CLASH_HOME/actions/<dirName>/manifest.json, validate, and spawn
   * (or skip) the subprocess. Returns the outcome so callers can update
   * their counters. Shared between start() and the fs.watch reconciler.
   */
  private async tryLoadAndSpawn(
    dirName: string,
  ): Promise<"spawned" | "skipped" | "ignored"> {
    const dir = join(this.root, dirName);
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

    let hostedPackage: HostedActionPackage;
    try {
      hostedPackage = await readHostedPackage(dir);
    } catch (e) {
      process.stderr.write(`actions: ${dirName}: invalid manifest.json (${(e as Error).message}) — skipping\n`);
      return "skipped";
    }
    const { manifest, cards, providers, modelBindings } = hostedPackage;
    if (this.env.executablePluginsOnly && !isExecutablePluginManifest(manifest)) {
      return "ignored";
    }

    if (!manifest.id) {
      process.stderr.write(`actions: ${dirName}: manifest missing id — skipping\n`);
      return "skipped";
    }
    if (!isExecutablePluginManifest(manifest) && manifest.runtime && manifest.runtime !== "local") {
      process.stderr.write(`actions: ${manifest.id}: runtime=${manifest.runtime} not local — skipping\n`);
      return "skipped";
    }
    if (isExecutablePluginManifest(manifest)) {
      try {
        await verifyExecutablePluginActivation(
          this.root,
          dir,
          manifest,
          cards,
          providers,
          modelBindings,
        );
      } catch (error) {
        process.stderr.write(`actions: ${manifest.id}: ${(error as Error).message} — skipping\n`);
        return "skipped";
      }
    }

    const entrypoint = hostedEntrypoint(manifest);
    if (!isSafePluginRelativePath(entrypoint)) {
      process.stderr.write(`actions: ${manifest.id}: unsafe entrypoint ${entrypoint} — skipping\n`);
      return "skipped";
    }
    const entrypointPath = join(dir, entrypoint);
    if (!existsSync(entrypointPath)) {
      process.stderr.write(`actions: ${manifest.id}: entrypoint ${entrypoint} missing — skipping\n`);
      return "skipped";
    }

    if (!isExecutablePluginManifest(manifest)
      && manifest.attachedProjects
      && manifest.attachedProjects.length > 0) {
      process.stderr.write(
        `actions: ${manifest.id}: attachedProjects=${JSON.stringify(manifest.attachedProjects)} ` +
          `(field reserved; honored on next bridge restart in a future change)\n`,
      );
    }

    const loaded: LoadedAction = {
      manifest,
      dir,
      cards,
      providers,
      modelBindings,
      ...(isExecutablePluginManifest(manifest)
        ? { schemaHash: executablePluginSchemaHash(manifest, cards, providers, modelBindings) }
        : {}),
    };
    const supervised: SupervisedAction = {
      loaded,
      child: null,
      startedAt: 0,
      backoffMs: RESTART_BACKOFF_MIN_MS,
      stopping: false,
      restartTimer: null,
      session: null,
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
      sup.session?.close();
      sup.session = null;
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

  /** Activated declarative Cards currently eligible for Kernel discovery. */
  listCards(): ExecutablePluginCardRegistration[] {
    const registrations: ExecutablePluginCardRegistration[] = [];
    for (const supervised of this.actions.values()) {
      const { manifest, cards, schemaHash } = supervised.loaded;
      if (!isExecutablePluginManifest(manifest) || !supervised.session || !schemaHash) continue;
      for (const document of Object.values(cards)) {
        registrations.push({
          pluginId: manifest.id,
          version: manifest.version,
          schemaHash,
          runtime: manifest.runtime,
          permissions: manifest.permissions,
          document,
        });
      }
    }
    return registrations.sort((left, right) =>
      `${left.pluginId}:${left.document.spec.id}`.localeCompare(
        `${right.pluginId}:${right.document.spec.id}`,
      ),
    );
  }

  /** Activated Provider definitions, independent from the Model Card catalog. */
  listProviders(): ExecutablePluginProviderRegistration[] {
    const registrations: ExecutablePluginProviderRegistration[] = [];
    for (const supervised of this.actions.values()) {
      const { manifest, providers, schemaHash } = supervised.loaded;
      if (!isExecutablePluginManifest(manifest) || !supervised.session || !schemaHash) continue;
      for (const document of Object.values(providers)) {
        registrations.push({
          pluginId: manifest.id,
          version: manifest.version,
          schemaHash,
          runtime: manifest.runtime,
          permissions: manifest.permissions,
          document,
        });
      }
    }
    return registrations.sort((left, right) =>
      `${left.pluginId}:${left.document.spec.id}`.localeCompare(
        `${right.pluginId}:${right.document.spec.id}`,
      ),
    );
  }

  /** Activated provider-side implementations that attach to Cards by id. */
  listModelBindings(): ExecutablePluginModelBindingRegistration[] {
    const registrations: ExecutablePluginModelBindingRegistration[] = [];
    for (const supervised of this.actions.values()) {
      const { manifest, modelBindings, schemaHash } = supervised.loaded;
      if (!isExecutablePluginManifest(manifest) || !supervised.session || !schemaHash) continue;
      for (const document of Object.values(modelBindings)) {
        registrations.push({
          pluginId: manifest.id,
          version: manifest.version,
          schemaHash,
          runtime: manifest.runtime,
          permissions: manifest.permissions,
          document,
        });
      }
    }
    return registrations.sort((left, right) =>
      `${left.pluginId}:${left.document.spec.id}`.localeCompare(
        `${right.pluginId}:${right.document.spec.id}`,
      ),
    );
  }

  /** Resolve the active immutable contract before a Canvas node is authored. */
  resolveBinding(
    pluginId: string,
    exportId: string,
    kind: "action" | "provider-projector" | "provider-executor",
  ): ExecutablePluginBinding {
    const supervised = this.actions.get(pluginId);
    if (!supervised || !isExecutablePluginManifest(supervised.loaded.manifest)) {
      throw new Error(`Executable plugin ${pluginId} is not installed.`);
    }
    if (!supervised.session || !supervised.loaded.schemaHash) {
      throw new Error(`Executable plugin ${pluginId} is not running.`);
    }
    const exported = supervised.loaded.manifest.exports.functions.find(
      (entry) => entry.id === exportId && entry.kind === kind,
    );
    if (!exported) {
      throw new Error(`Executable plugin ${pluginId} does not export ${kind} ${exportId}.`);
    }
    return {
      pluginId,
      version: supervised.loaded.manifest.version,
      exportId,
      schemaHash: supervised.loaded.schemaHash,
    };
  }

  /** Invoke one exact, already-supervised plugin version over stdio. */
  invoke(
    pluginId: string,
    invocation: unknown,
    options: { timeoutMs?: number } = {},
  ): Promise<ExecutablePluginResult> {
    const supervised = this.actions.get(pluginId);
    if (!supervised?.session) {
      return Promise.reject(new Error(`Executable plugin ${pluginId} is not running.`));
    }
    const parsed = ExecutablePluginInvocationSchema.parse(invocation);
    if (!supervised.loaded.schemaHash || parsed.target.schemaHash !== supervised.loaded.schemaHash) {
      return Promise.reject(new Error(
        `Executable plugin ${pluginId} schema hash does not match the pinned invocation.`,
      ));
    }
    return supervised.session.invoke(parsed, options);
  }

  // ─── fs.watch / reconciliation ──────────────────────────────
  //
  // node's fs.watch is intentionally minimal — it tells us *something*
  // changed under the actions directory but not what. So we use it purely as a
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
    const root = this.root;
    try {
      this.watcher = watch(
        root,
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
      process.stderr.write(`actions: watching ${root} for changes\n`);
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
    const root = this.root;
    try {
      entries = await readdir(root);
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
      const dir = join(root, entry);
      try {
        const s = await stat(dir);
        if (!s.isDirectory()) continue;
      } catch { continue; }
      const manifestPath = join(dir, "manifest.json");
      if (!existsSync(manifestPath)) continue;
      liveDirs.add(entry);

      // Read the manifest fresh — same validation as start().
      let hostedPackage: HostedActionPackage;
      try {
        hostedPackage = await readHostedPackage(dir);
      } catch {
        // Half-written manifest mid-install. Skip; debounce will fire
        // again once the writer finishes.
        continue;
      }
      const { manifest } = hostedPackage;
      if (!manifest.id) continue;
      if (!isExecutablePluginManifest(manifest) && manifest.runtime && manifest.runtime !== "local") continue;

      if (isExecutablePluginManifest(manifest)) {
        try {
          await verifyExecutablePluginActivation(
            this.root,
            dir,
            manifest,
            hostedPackage.cards,
            hostedPackage.providers,
            hostedPackage.modelBindings,
          );
        } catch (error) {
          const active = this.actions.get(manifest.id);
          if (active) await this.stopOne(manifest.id, "activation-receipt-mismatch");
          process.stderr.write(`actions: ${manifest.id}: ${(error as Error).message} — disabled\n`);
          continue;
        }
      }

      const entrypoint = hostedEntrypoint(manifest);
      if (!isSafePluginRelativePath(entrypoint)) continue;
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

    sup.session?.close();
    sup.session = null;

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
    _newManifest: HostedActionManifest,
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
    const executablePlugin = isExecutablePluginManifest(manifest);
    const executableRuntime = executablePlugin && manifest.runtime.kind === "local"
      ? manifest.runtime
      : undefined;
    const entrypoint = hostedEntrypoint(manifest);
    const entrypointPath = join(dir, entrypoint);
    const runtimeDir = executablePlugin ? realpathSync(dir) : dir;
    const runtimeEntrypointPath = executablePlugin ? realpathSync(entrypointPath) : entrypointPath;

    // Locate the workspace clash-sdk python source so the subprocess can
    // import it without a pip install. In dev, this lives at
    //   <repo>/packages/clash-sdk/python
    // We chase it relative to the bridge's own dist/ — `import.meta.url`
    // resolves to file://.../packages/clash-bridge/dist/cli.js, so going
    // up three levels lands us at the packages/ root.
    const sdkPythonDir = resolveSdkPythonDir();

    const childEnv: NodeJS.ProcessEnv = executablePlugin
      ? credentialFreePluginEnv(manifest)
      : {
          ...process.env,
          CLASH_SERVER_URL: this.env.serverUrl,
          CLASH_API_KEY: this.env.apiKey,
          CLASH_RUNTIME_ID: this.env.runtimeId,
        };
    if (!executablePlugin && sdkPythonDir) {
      const prev = process.env.PYTHONPATH;
      childEnv.PYTHONPATH = prev ? `${sdkPythonDir}:${prev}` : sdkPythonDir;
    }

    // Pick interpreter by entrypoint file extension.
    //
    // - `.py`              → prepared Python runtime (managed venv by default,
    //                        or CLASH_ACTIONS_PYTHON as an explicit interpreter)
    // - `.js` / `.mjs`     → explicit desktop Node runtime, else process.execPath
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
      if (executablePlugin) {
        const pythonBin = resolveExecutablePluginPythonBin({
          manifestId: manifest.id,
          pluginDir: runtimeDir,
          sdkPythonDir,
          logPrefix: "",
        });
        if (!pythonBin) {
          process.stderr.write(
            `actions: ${manifest.id}: no Python runtime available for sandboxed plugin — set CLASH_ACTIONS_PYTHON or install the app-managed runtime\n`,
          );
          return;
        }
        bin = pythonBin;
        args = executablePluginPythonArgs(
          runtimeEntrypointPath,
          executableRuntime?.args ?? [],
        );
        Object.assign(childEnv, executablePluginPythonEnv(manifest, sdkPythonDir, runtimeDir));
      } else {
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
      }
    } else if (ext === ".js" || ext === ".mjs") {
      bin = resolveExecutablePluginNodePath();
      args = executablePlugin
        ? executablePluginNodeArgs(
            runtimeDir,
            runtimeEntrypointPath,
            executableRuntime?.args ?? [],
          )
        : [entrypointPath];
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
        cwd: runtimeDir,
        env: childEnv,
        // v1 plugins reserve stdin/stdout for the versioned JSON-lines ABI.
        // Legacy actions keep their SDK-driven websocket lifecycle.
        stdio: executablePlugin
          ? ["pipe", "pipe", "pipe"]
          : ["ignore", "inherit", "inherit"],
      });
    } catch (e) {
      process.stderr.write(`actions: ${manifest.id}: spawn failed (${(e as Error).message})\n`);
      return;
    }

    sup.child = child;
    sup.startedAt = Date.now();

    if (executablePlugin) {
      if (!child.stdin || !child.stdout) {
        process.stderr.write(`actions: ${manifest.id}: stdio pipes unavailable — disabling\n`);
        try { child.kill("SIGTERM"); } catch { /* already gone */ }
        return;
      }
      sup.session = new PluginStdioSession({
        manifest,
        stdin: child.stdin,
        stdout: child.stdout,
        broker: this.env.pluginBroker ?? (async () => {
          throw new Error("Clash Bridge capability broker is unavailable.");
        }),
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        process.stderr.write(`plugin[${manifest.id}]: ${chunk.toString("utf8")}`);
      });
    }

    child.once("exit", (code, signal) => {
      const uptime = Date.now() - sup.startedAt;
      process.stderr.write(
        `actions: exit id=${manifest.id} code=${code} signal=${signal ?? "-"} uptime=${Math.round(uptime / 1000)}s\n`,
      );
      sup.child = null;
      sup.session?.close();
      sup.session = null;

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
function manifestKey(m: HostedActionManifest): string {
  if (isExecutablePluginManifest(m)) return JSON.stringify(m);
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

export function credentialFreePluginEnv(
  manifest: Pick<ExecutablePluginManifest, "id" | "version">,
  inherited: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    CLASH_PLUGIN_ID: manifest.id,
    CLASH_PLUGIN_VERSION: manifest.version,
    CLASH_PLUGIN_TRANSPORT: "stdio",
    // Safe runtime flag, not a credential. It makes process.execPath usable
    // when the host is Electron and is ignored by a standalone Node binary.
    ELECTRON_RUN_AS_NODE: "1",
  };
  // Only process-launch essentials cross the sandbox boundary. In particular,
  // no CLASH_API_KEY or provider credential is inherited from the Bridge.
  for (const key of [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "SYSTEMROOT",
    "WINDIR",
    "PATHEXT",
  ]) {
    if (inherited[key] !== undefined) env[key] = inherited[key];
  }
  return env;
}

export function resolveExecutablePluginNodePath(
  inherited: NodeJS.ProcessEnv = process.env,
  fallback = process.execPath,
): string {
  return inherited.CLASH_NODE_EXEC_PATH?.trim() || fallback;
}

export interface ExecutablePluginContractTestRun {
  passed: number;
  tests: Array<{ id: string; status: "passed" }>;
}

function executablePluginNodeArgs(
  pluginDir: string,
  entrypointPath: string,
  runtimeArgs: readonly string[],
): string[] {
  return [
    "--permission",
    `--allow-fs-read=${pluginDir}`,
    `--import=${PLUGIN_NETWORK_GUARD}`,
    entrypointPath,
    // Runtime arguments deliberately follow the entrypoint. They are plugin
    // arguments, never Node flags capable of weakening the sandbox.
    ...runtimeArgs,
  ];
}

/**
 * Python analog of the Node import-map network guard. Injected as a
 * `sitecustomize.py` that Python's site machinery imports before the plugin
 * entrypoint runs; it replaces every socket constructor with a raising stub so
 * urllib/http.client/requests all fail with the same marker as the Node
 * sandbox. Best-effort like the Node guard — the hard boundaries remain the
 * broker, the credential-free environment, and the domain allowlist.
 */
const PLUGIN_PYTHON_NETWORK_GUARD_SOURCE = `"""Clash executable-plugin sandbox: direct network and undeclared-path access is denied."""
import builtins
import io
import os
import socket
import _socket

_DENIED = (
    "Direct plugin network access is denied; use the Clash capability broker. "
    "(ERR_CLASH_PLUGIN_NETWORK_DENIED)"
)

_PATH_DENIED = (
    "Undeclared filesystem access is denied; declare the path in the plugin manifest. "
    "(ERR_CLASH_PLUGIN_PATH_DENIED)"
)


def _denied(*_args, **_kwargs):
    # A denial must look like a denial: PermissionError with EPERM is what a
    # kernel-level sandbox produces, so callers can handle one shape.
    raise PermissionError(1, _DENIED)


class _DeniedSocket(socket.socket):
    def __init__(self, *_args, **_kwargs):
        raise PermissionError(1, _DENIED)


socket.socket = _DeniedSocket
socket.create_connection = _denied
socket.create_server = _denied
socket.socketpair = _denied
socket.getaddrinfo = _denied
socket.gethostbyname = _denied
socket.gethostbyname_ex = _denied
socket.gethostbyaddr = _denied

# The high-level module is only a wrapper. Patching it alone left \`import
# _socket\` as a complete bypass, which is the first thing a hostile plugin
# reaches for.
_socket.socket = _denied
_socket.socketpair = _denied
_socket.getaddrinfo = _denied
_socket.gethostbyname = _denied
_socket.gethostbyname_ex = _denied
_socket.gethostbyaddr = _denied

# Paths the plugin is allowed to touch, injected by the Bridge. Anything else --
# provider secrets, other plugins' packages, the rest of the machine -- is
# refused before the syscall.
_ALLOWED_PREFIXES = tuple(
    os.path.realpath(entry)
    for entry in os.environ.get("CLASH_PLUGIN_ALLOWED_PATHS", "").split(os.pathsep)
    if entry
)


def _path_allowed(path):
    if not _ALLOWED_PREFIXES:
        return True
    try:
        resolved = os.path.realpath(path if isinstance(path, str) else os.fsdecode(path))
    except (TypeError, ValueError):
        return True
    return any(
        resolved == prefix or resolved.startswith(prefix + os.sep)
        for prefix in _ALLOWED_PREFIXES
    )


_real_open = builtins.open
_real_os_open = os.open
_real_io_open = io.open


def _guarded_open(file, *args, **kwargs):
    if isinstance(file, (str, bytes, os.PathLike)) and not _path_allowed(file):
        raise PermissionError(1, _PATH_DENIED)
    return _real_open(file, *args, **kwargs)


def _guarded_os_open(path, *args, **kwargs):
    if not _path_allowed(path):
        raise PermissionError(1, _PATH_DENIED)
    return _real_os_open(path, *args, **kwargs)


def _guarded_io_open(file, *args, **kwargs):
    if isinstance(file, (str, bytes, os.PathLike)) and not _path_allowed(file):
        raise PermissionError(1, _PATH_DENIED)
    return _real_io_open(file, *args, **kwargs)


builtins.open = _guarded_open
io.open = _guarded_io_open
os.open = _guarded_os_open
`;

let pythonNetworkGuardDir: string | null = null;

function ensurePythonNetworkGuardDir(): string {
  if (pythonNetworkGuardDir && existsSync(join(pythonNetworkGuardDir, "sitecustomize.py"))) {
    return pythonNetworkGuardDir;
  }
  const dir = join(tmpdir(), `clash-plugin-py-guard-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "sitecustomize.py"), PLUGIN_PYTHON_NETWORK_GUARD_SOURCE);
  pythonNetworkGuardDir = dir;
  return dir;
}

function executablePluginPythonArgs(
  entrypointPath: string,
  runtimeArgs: readonly string[],
): string[] {
  // -B: no .pyc writes inside the attested package; -s: no user site-packages.
  // No -E/-I: the sitecustomize network guard arrives via PYTHONPATH, which the
  // Bridge fully controls because the plugin env is built from scratch.
  return ["-B", "-s", entrypointPath, ...runtimeArgs];
}

function executablePluginPythonEnv(
  manifest: Pick<ExecutablePluginManifest, "id" | "version" | "permissions">,
  sdkPythonDir: string | null,
  pluginDir?: string,
): NodeJS.ProcessEnv {
  const env = credentialFreePluginEnv(manifest);
  const guardDir = ensurePythonNetworkGuardDir();
  env.PYTHONPATH = sdkPythonDir ? `${guardDir}${delimiter}${sdkPythonDir}` : guardDir;
  env.PYTHONDONTWRITEBYTECODE = "1";
  env.PYTHONNOUSERSITE = "1";
  // Mirrors the Node sandbox's `--allow-fs-read=<pluginDir>`: the same declared
  // surface, expressed for the interpreter that has no permission model. The
  // manifest's own declared reads are honoured so a plugin can still be given
  // explicit access. Deliberately not the temp root: a local host's data dir can
  // live under it, so allowing it would re-open the secrets this guard protects.
  if (pluginDir) {
    const declaredReads = manifest.permissions?.filesystem?.read ?? [];
    const allowed = [
      pluginDir,
      ...(sdkPythonDir ? [sdkPythonDir] : []),
      guardDir,
      ...declaredReads,
    ];
    env.CLASH_PLUGIN_ALLOWED_PATHS = allowed.join(delimiter);
  }
  return env;
}

/**
 * App-internal Python prepared for the local ASR/TTS model runtimes. Reused
 * for sandboxed plugins so a packaged desktop install needs no system Python.
 * Path mirrors apps/local-api/src/managed-local-model-python.ts.
 */
function managedLocalModelsPythonBin(): string | null {
  const venvDir = join(paths().configDir, "runtimes", "python", "local-models", "venv");
  const bin = managedPythonBin(venvDir);
  return existsSync(bin) ? bin : null;
}

/**
 * Interpreter for a sandboxed Python executable plugin, in order:
 * 1. CLASH_ACTIONS_PYTHON (explicit override; dev/test hermetic path)
 * 2. the local-models venv the app already maintains for ASR/TTS — only for
 *    dependency-free plugins so plugin pip installs never pollute it
 * 3. the actions-managed venv (created on demand), where a plugin's
 *    requirements.txt installs through the existing stamped machinery
 */
function resolveExecutablePluginPythonBin(opts: {
  manifestId: string;
  pluginDir: string;
  sdkPythonDir: string | null;
  logPrefix: string;
}): string | null {
  const hasRequirements = existsSync(join(opts.pluginDir, "requirements.txt"));
  const explicit = process.env.CLASH_ACTIONS_PYTHON;
  if (explicit) {
    if (!hasRequirements) return explicit;
    return preparePythonRuntimeDeps({
      pythonBin: explicit,
      stampDir: explicitPythonStampDir(explicit),
      actionId: opts.manifestId,
      actionDir: opts.pluginDir,
      sdkPythonDir: opts.sdkPythonDir,
      logPrefix: opts.logPrefix,
      installSdk: false,
    });
  }
  if (!hasRequirements) {
    const localModelsPython = managedLocalModelsPythonBin();
    if (localModelsPython) return localModelsPython;
  }
  const venvDir = managedPythonVenvDir();
  const pythonBin = managedPythonBin(venvDir);
  if (!existsSync(pythonBin)) {
    mkdirSync(venvDir, { recursive: true });
    process.stderr.write(`${opts.logPrefix}actions: python venv create path=${venvDir}\n`);
    if (!runPythonSetup("python3", ["-m", "venv", venvDir], opts.logPrefix, opts.manifestId)) {
      return null;
    }
  }
  return preparePythonRuntimeDeps({
    pythonBin,
    stampDir: venvDir,
    actionId: opts.manifestId,
    actionDir: opts.pluginDir,
    sdkPythonDir: opts.sdkPythonDir,
    logPrefix: opts.logPrefix,
    installSdk: false,
  });
}

/**
 * Run an unpacked draft's declarative contracts through the same credential-
 * free stdio session and Node permission sandbox used by ActionsHost. Broker
 * responses come exclusively from the contract document's inert fixtures.
 */
export async function runExecutablePluginContractTests(
  pluginDirInput: string,
): Promise<ExecutablePluginContractTestRun> {
  const pluginDir = realpathSync(pluginDirInput);
  const hostedPackage = await readHostedPackage(pluginDir);
  if (!isExecutablePluginManifest(hostedPackage.manifest)) {
    throw new Error("Contract tests require a clash.plugin/v1 manifest.");
  }
  const { manifest, cards, contractTests } = hostedPackage;
  if (manifest.runtime.kind !== "local" || manifest.runtime.transport !== "stdio") {
    throw new Error(`Plugin ${manifest.id} is not a local stdio plugin.`);
  }
  if (manifest.contractTests.length === 0) {
    throw new Error(`Plugin ${manifest.id} declares no contract tests.`);
  }
  const entrypointPath = realpathSync(join(pluginDir, manifest.runtime.entrypoint));
  const extension = manifest.runtime.entrypoint.toLowerCase().slice(
    manifest.runtime.entrypoint.lastIndexOf("."),
  );
  // The extension whitelist stays as a sandbox check: these are the only shapes the
  // host knows how to launch under `--permission`. It no longer decides *which*
  // interpreter runs -- the manifest declares that, so the two concerns are separate.
  if (extension !== ".js" && extension !== ".mjs" && extension !== ".py") {
    throw new Error(
      `Contract-tested v1 plugins require a sandboxed .js, .mjs or .py entrypoint; got ${extension || "none"}.`,
    );
  }
  const language = resolvePluginLanguage(manifest.runtime) ?? "node";
  const sdkPythonDir = language === "python" ? resolveSdkPythonDir() : null;
  const spawnPlan = language === "python"
    ? (() => {
      const pythonBin = resolveExecutablePluginPythonBin({
        manifestId: manifest.id,
        pluginDir,
        sdkPythonDir,
        logPrefix: "",
      });
      if (!pythonBin) {
        throw new Error(
          `Plugin ${manifest.id} needs a Python runtime — set CLASH_ACTIONS_PYTHON or install the app-managed runtime.`,
        );
      }
      return {
        bin: pythonBin,
        args: executablePluginPythonArgs(entrypointPath, manifest.runtime.args),
        env: executablePluginPythonEnv(manifest, sdkPythonDir, pluginDir),
      };
    })()
    : {
      bin: resolveExecutablePluginNodePath(),
      args: executablePluginNodeArgs(pluginDir, entrypointPath, manifest.runtime.args),
      env: credentialFreePluginEnv(manifest),
    };
  const schemaHash = executablePluginSchemaHash(manifest, cards);
  const completed: ExecutablePluginContractTestRun["tests"] = [];

  for (const path of manifest.contractTests) {
    const contractTest = contractTests[path];
    const child: ChildProcess = spawn(
      spawnPlan.bin,
      spawnPlan.args,
      {
        cwd: pluginDir,
        env: spawnPlan.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    if (!child.stdin || !child.stdout) {
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      throw new Error(`Contract test ${contractTest.id} could not open plugin stdio.`);
    }
    let fixtureIndex = 0;
    const session: PluginStdioSession = new PluginStdioSession({
      manifest,
      stdin: child.stdin,
      stdout: child.stdout,
      broker: async (request) => {
        const fixture = contractTest.brokerFixtures[fixtureIndex];
        if (!fixture) {
          throw new Error(
            `Contract test ${contractTest.id} made undeclared broker request `
              + `${canonicalJson(request.operation)}.`,
          );
        }
        try {
          deepStrictEqual(request.operation, fixture.operation);
        } catch {
          throw new Error(
            `Contract test ${contractTest.id} broker request ${canonicalJson(request.operation)} `
              + `did not match fixture ${canonicalJson(fixture.operation)}.`,
          );
        }
        fixtureIndex += 1;
        if (fixture.response.status === "error") {
          throw new Error(`${fixture.response.error.code}: ${fixture.response.error.message}`);
        }
        return fixture.response.result;
      },
    });

    try {
      const invocationId = `contract:${contractTest.id}`;
      const result: ExecutablePluginResult = await session.invoke({
        protocol: "clash.plugin.invoke/v1",
        invocationId,
        taskId: `contract:${contractTest.id}`,
        projectId: contractTest.context.projectId,
        ...(contractTest.context.nodeId ? { nodeId: contractTest.context.nodeId } : {}),
        target: {
          pluginId: manifest.id,
          version: manifest.version,
          exportId: contractTest.target.exportId,
          schemaHash,
          kind: contractTest.target.kind,
        },
        input: contractTest.input,
        // Without these a poll case silently runs as a submit, and the suite reports a pass for a
        // path it never exercised.
        operation: contractTest.operation,
        ...(contractTest.pollState === undefined ? {} : { pollState: contractTest.pollState }),
        actor: { kind: "system", id: "contract-test-runner" },
      }, { timeoutMs: contractTest.timeoutMs });
      if (fixtureIndex !== contractTest.brokerFixtures.length) {
        throw new Error(
          `Contract test ${contractTest.id} consumed ${fixtureIndex} of `
            + `${contractTest.brokerFixtures.length} broker fixtures.`,
        );
      }
      const actual: unknown = result.status === "completed"
        ? { status: result.status, outputs: result.outputs }
        : result.status === "accepted"
          ? { status: result.status, pollState: result.pollState }
          : { status: result.status, error: result.error };
      try {
        deepStrictEqual(actual, contractTest.expect);
      } catch {
        throw new Error(
          `Contract test ${contractTest.id} result mismatch. `
            + `Expected ${canonicalJson(contractTest.expect)}, got ${canonicalJson(actual)}.`,
        );
      }
      completed.push({ id: contractTest.id, status: "passed" });
    } catch (error) {
      const details = stderr.trim();
      throw new Error(
        `${(error as Error).message}${details ? `\nPlugin stderr:\n${details}` : ""}`,
      );
    } finally {
      session.close();
      try { child.kill("SIGTERM"); } catch { /* already gone */ }
    }
  }

  return { passed: completed.length, tests: completed };
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
  /** Sandboxed executable plugins speak raw stdio JSONL; they import the pure-
   * Python SDK via PYTHONPATH and never need the agent's aiohttp, so the SDK
   * pip step is skipped for them. Plugin requirements.txt still installs. */
  installSdk?: boolean;
}): string | null {
  const { pythonBin } = opts;
  const installSdk = opts.installSdk ?? true;
  const stamp = readPythonDepsStamp(opts.stampDir);
  let changed = false;
  if (installSdk && opts.sdkPythonDir && existsSync(join(opts.sdkPythonDir, "pyproject.toml"))) {
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
