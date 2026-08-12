import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { basename } from "node:path";

/**
 * Which Node runs the local daemon.
 *
 * The daemon owns the machine's long-lived host: SQLite stores, plugin runtime,
 * HTTP surface. It used to inherit `process.execPath`, which coupled it to
 * whoever started it -- the Electron shell's bundled Node from the GUI, an
 * arbitrary nvm version from a shell, the CI image's Node otherwise. The same
 * daemon code then ran on different runtimes, and `node:sqlite` is not the same
 * feature across them.
 *
 * Resolution is explicit and verifiable instead: an operator override wins, a
 * plain supported launcher runtime is kept, and an unsupported runtime fails
 * loudly rather than starting a host nobody can reason about. Desktop may
 * explicitly pin its Electron executable in Node mode through the detached
 * launcher after validating the embedded Node version separately.
 */

export type DaemonNodeRuntimeSource = "explicit" | "launcher" | "discovered";

export interface DaemonNodeRuntime {
  readonly nodePath: string;
  readonly version?: string;
  readonly source: DaemonNodeRuntimeSource;
  readonly inheritedFromLauncher: boolean;
  /** Why the launcher runtime was not used, when it was not. */
  readonly reason?: string;
}

export interface ResolveDaemonNodeRuntimeOptions {
  execPath?: string;
  env?: Record<string, string | undefined>;
  /** Minimum supported version, as `>=x.y.z`. */
  supportedRange: string;
  /** Fallbacks to probe, in order, when the launcher runtime cannot be used. */
  candidates?: readonly string[];
  probeVersion?: (nodePath: string) => string | undefined;
  fileExists?: (path: string) => boolean;
}

function parseMinimum(range: string): [number, number, number] {
  const match = /^>=\s*(\d+)\.(\d+)\.(\d+)/u.exec(range.trim());
  if (!match) throw new Error(`Unsupported Node range: ${range}`);
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Optional exclusive upper bound, as `<major` or `<major.minor.patch`. */
function parseExclusiveMaximum(range: string): [number, number, number] | undefined {
  const match = /<\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?/u.exec(range);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compare(a: [number, number, number], b: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (a[index]! !== b[index]!) return a[index]! - b[index]!;
  }
  return 0;
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(version.trim());
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function satisfies(version: string | undefined, range: string): boolean {
  if (!version) return false;
  const actual = parseVersion(version);
  if (!actual) return false;
  if (compare(actual, parseMinimum(range)) < 0) return false;
  // An upper bound is the whole point: `>=x` alone silently adopts whatever
  // newer Node a machine happens to have, which is how discovery picked up a
  // Node the stores were never verified against.
  const maximum = parseExclusiveMaximum(range);
  if (maximum && compare(actual, maximum) >= 0) return false;
  return true;
}

export function isDaemonNodeVersionSupported(
  version: string | undefined,
  supportedRange: string,
): boolean {
  return satisfies(version, supportedRange);
}

/**
 * Automatic discovery never adopts an Electron binary. Desktop's explicit,
 * version-checked Node-mode launch is handled by the detached launcher.
 */
function isElectronRuntime(
  execPath: string | undefined,
  env: Record<string, string | undefined>,
): boolean {
  if (env.ELECTRON_RUN_AS_NODE) return true;
  if (!execPath) return false;
  const name = basename(execPath).toLowerCase();
  if (name === "electron" || name.startsWith("electron")) return true;
  return /\.app\/contents\/(macos|frameworks)\//iu.test(execPath)
    || /[\\/]electron[\\/]dist[\\/]/iu.test(execPath);
}

function defaultProbeVersion(nodePath: string): string | undefined {
  try {
    return execFileSync(nodePath, ["--version"], {
      encoding: "utf8",
      timeout: 5_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function resolveDaemonNodeRuntime(
  options: ResolveDaemonNodeRuntimeOptions,
): DaemonNodeRuntime {
  const env = options.env ?? {};
  const probeVersion = options.probeVersion ?? defaultProbeVersion;
  const fileExists = options.fileExists ?? existsSync;

  const explicit = env.CLASH_DAEMON_NODE_PATH?.trim();
  if (explicit) {
    const version = probeVersion(explicit);
    if (!satisfies(version, options.supportedRange)) {
      throw new Error(
        `Pinned daemon Node ${version ?? "unknown"} at ${explicit} does not satisfy ${options.supportedRange}.`,
      );
    }
    return {
      nodePath: explicit,
      version,
      source: "explicit",
      inheritedFromLauncher: false,
    };
  }

  const execPath = options.execPath;
  let reason: string | undefined;
  if (isElectronRuntime(execPath, env)) {
    reason = "launcher is an Electron runtime, which belongs to the GUI shell";
  } else if (execPath) {
    const version = probeVersion(execPath);
    if (satisfies(version, options.supportedRange)) {
      return { nodePath: execPath, version, source: "launcher", inheritedFromLauncher: true };
    }
    reason = `launcher Node ${version ?? "unknown"} does not satisfy ${options.supportedRange}`;
  } else {
    reason = "no launcher runtime was provided";
  }

  for (const candidate of options.candidates ?? []) {
    if (options.fileExists && !fileExists(candidate)) continue;
    const version = probeVersion(candidate);
    if (satisfies(version, options.supportedRange)) {
      return { nodePath: candidate, version, source: "discovered", inheritedFromLauncher: false, reason };
    }
  }

  throw new Error(
    `No Node runtime satisfying ${options.supportedRange} was found for the Clash daemon `
      + `(${reason ?? "no candidates"}). Set CLASH_DAEMON_NODE_PATH to pin one.`,
  );
}

/**
 * Where to look for a daemon runtime when the launcher's cannot be adopted.
 *
 * nvm's concrete version directories are offered because they are immutable, so
 * pinning one is stable. `current`, `default`, and the alias symlinks are never
 * offered: they move when a shell switches versions, which would reintroduce the
 * exact coupling this module removes.
 */
export function defaultDaemonNodeCandidates(
  env: Record<string, string | undefined> = {},
  deps: { listNvmVersions?: (nvmRoot: string) => readonly string[] } = {},
): readonly string[] {
  const candidates: string[] = [];
  const home = env.HOME?.trim();
  if (home) {
    // A runtime the product installed for itself outranks anything ambient.
    candidates.push(`${home}/.local/share/clash/runtime/bin/node`);

    const nvmRoot = env.NVM_DIR?.trim() || `${home}/.nvm`;
    const listVersions = deps.listNvmVersions ?? defaultListNvmVersions;
    const versions = [...listVersions(nvmRoot)]
      .filter((entry) => /^v\d+\.\d+\.\d+$/u.test(entry))
      .sort(compareVersionDesc);
    for (const version of versions) {
      candidates.push(`${nvmRoot}/versions/node/${version}/bin/node`);
    }
  }
  candidates.push("/usr/local/bin/node", "/opt/homebrew/bin/node", "/usr/bin/node");
  return candidates;
}

function compareVersionDesc(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  return -compare(left, right);
}

function defaultListNvmVersions(nvmRoot: string): readonly string[] {
  try {
    return readdirSync(`${nvmRoot}/versions/node`);
  } catch {
    return [];
  }
}
