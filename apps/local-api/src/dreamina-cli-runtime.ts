import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import {
  createDreaminaCliRun,
  DreaminaCliCommandError,
  type DreaminaCliRun,
  type DreaminaCliRunResult,
} from "./dreamina-cli.js";

const execFileAsync = promisify(execFile);

export const DREAMINA_CLI_VERSION = "1.4.15";

export interface DreaminaCliPlatform {
  platform: NodeJS.Platform;
  arch: string;
}

export interface DreaminaCliArtifact {
  url: string;
  sha256: string;
}

interface DreaminaCliAuthItem {
  service: string;
  account: string;
  password: string;
}

interface DreaminaCliAuthEnvelope {
  version: 1;
  items: DreaminaCliAuthItem[];
}

export interface DreaminaCliAuthSandbox {
  run(input: {
    run: DreaminaCliRun;
    args: string[];
    options?: Parameters<DreaminaCliRun>[1];
    authState?: string;
  }): Promise<DreaminaCliRunResult>;
}

const RELEASE_BASE = `https://github.com/clash-space/clash/releases/download/dreamina-cli-v${DREAMINA_CLI_VERSION}`;

const DREAMINA_CLI_ARTIFACTS: Record<string, DreaminaCliArtifact> = {
  "darwin-x64": {
    url: `${RELEASE_BASE}/dreamina_cli_darwin_amd64`,
    sha256: "d1db1d121e6dc71643648bee2608855594cf64fd1f5a008da7d736df8f40fc6d",
  },
  "darwin-arm64": {
    url: `${RELEASE_BASE}/dreamina_cli_darwin_arm64`,
    sha256: "71342534d18601a56d2a98f95e846cfbe3b821491e0938d80f587a6842077eed",
  },
  "linux-x64": {
    url: `${RELEASE_BASE}/dreamina_cli_linux_amd64`,
    sha256: "7c2817bc844e5a93cc5c6e57f876ccaea91d438e520ad50f665a515e816c7dc6",
  },
  "linux-arm64": {
    url: `${RELEASE_BASE}/dreamina_cli_linux_arm64`,
    sha256: "696216eee0fe55ba5e5d781429a3eb304cfdb539823397742a4d1a7575ab1202",
  },
  "win32-x64": {
    url: `${RELEASE_BASE}/dreamina_cli_windows_amd64.exe`,
    sha256: "74c0de7a451f09d58f4429071015cde2d311d728e43b92ea9813741b4d2a15ac",
  },
};

function platformKey(platform: DreaminaCliPlatform): string {
  const arch = platform.arch === "aarch64" ? "arm64" : platform.arch === "amd64" ? "x64" : platform.arch;
  return `${platform.platform}-${arch}`;
}

function executableName(platform: DreaminaCliPlatform): string {
  return platform.platform === "win32" ? "dreamina.exe" : "dreamina";
}

export function dreaminaCliBinaryPath(dataDir: string, platform: DreaminaCliPlatform = process): string {
  return join(dataDir, "tools", "dreamina", DREAMINA_CLI_VERSION, executableName(platform));
}

export function dreaminaCliArtifact(platform: DreaminaCliPlatform = process): DreaminaCliArtifact {
  const artifact = DREAMINA_CLI_ARTIFACTS[platformKey(platform)];
  if (!artifact) {
    throw new Error(`Dreamina CLI is not available for ${platform.platform}/${platform.arch}.`);
  }
  return artifact;
}

const DREAMINA_SECURITY_UPSTREAM_PATH = "/usr/bin/security";

export function dreaminaSecurityShimExecutablePath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const suffix = String(uid).padStart(9, "0").slice(-9);
  const path = `/tmp/cs-${suffix}`;
  if (Buffer.byteLength(path) !== Buffer.byteLength(DREAMINA_SECURITY_UPSTREAM_PATH)) {
    throw new Error("Dreamina security shim path must preserve the upstream binary layout.");
  }
  return path;
}

function replaceAllExact(bytes: Uint8Array, from: string, to: string): { bytes: Uint8Array; count: number } {
  const source = Buffer.from(bytes);
  const needle = Buffer.from(from);
  const replacement = Buffer.from(to);
  if (needle.byteLength !== replacement.byteLength) throw new Error("Dreamina CLI patch length mismatch.");
  const output = Buffer.from(source);
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) >= 0) {
    replacement.copy(output, cursor);
    cursor += needle.byteLength;
    count += 1;
  }
  return { bytes: output, count };
}

function isPinnedArtifact(artifact: DreaminaCliArtifact): boolean {
  return Object.values(DREAMINA_CLI_ARTIFACTS).some((candidate) => candidate.sha256 === artifact.sha256);
}

function patchDreaminaCliBytes(bytes: Uint8Array, platform: DreaminaCliPlatform, pinned: boolean): Uint8Array {
  if (platform.platform !== "darwin") return bytes;
  const shimPath = dreaminaSecurityShimExecutablePath();
  const alreadyPatched = Buffer.from(bytes).indexOf(Buffer.from(shimPath)) >= 0;
  if (alreadyPatched) return bytes;
  const patched = replaceAllExact(bytes, DREAMINA_SECURITY_UPSTREAM_PATH, shimPath);
  if (pinned && patched.count !== 1) {
    throw new Error(`Dreamina CLI auth patch expected one storage callsite, received ${patched.count}.`);
  }
  return patched.count === 1 ? patched.bytes : bytes;
}

function upstreamSha256(bytes: Uint8Array, platform: DreaminaCliPlatform): string {
  let normalized = bytes;
  if (platform.platform === "darwin") {
    const restored = replaceAllExact(bytes, dreaminaSecurityShimExecutablePath(), DREAMINA_SECURITY_UPSTREAM_PATH);
    normalized = restored.count === 1 ? restored.bytes : bytes;
  }
  return createHash("sha256").update(normalized).digest("hex");
}

async function downloadVerifiedArtifact(artifact: DreaminaCliArtifact, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const response = await fetchImpl(artifact.url);
  if (!response.ok) {
    throw new Error(`Dreamina CLI download failed: ${response.status} ${response.statusText}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== artifact.sha256) {
    throw new Error(`Dreamina CLI checksum mismatch: expected ${artifact.sha256}, received ${checksum}.`);
  }
  return bytes;
}

async function managedDarwinBinaryIsValid(binary: string): Promise<boolean> {
  try {
    const bytes = await readFile(binary);
    if (Buffer.from(bytes).indexOf(Buffer.from(dreaminaSecurityShimExecutablePath())) < 0) return false;
    await execFileAsync("/usr/bin/codesign", ["--verify", "--strict", binary]);
    return true;
  } catch {
    return false;
  }
}

async function ensurePinnedDarwinRuntime(options: {
  binary: string;
  artifact: DreaminaCliArtifact;
  fetch: typeof fetch;
}): Promise<{ installed: boolean }> {
  const upstreamPath = `${options.binary}.upstream`;
  let upstream: Uint8Array | null = await readFile(upstreamPath).catch(() => null);
  let downloaded = false;
  if (!upstream || createHash("sha256").update(upstream).digest("hex") !== options.artifact.sha256) {
    const candidate = await readFile(options.binary).catch(() => null);
    if (candidate && upstreamSha256(candidate, { platform: "darwin", arch: process.arch }) === options.artifact.sha256) {
      upstream = replaceAllExact(candidate, dreaminaSecurityShimExecutablePath(), DREAMINA_SECURITY_UPSTREAM_PATH).bytes;
    } else {
      upstream = Buffer.from(await downloadVerifiedArtifact(options.artifact, options.fetch));
      downloaded = true;
    }
    const stagedUpstream = `${upstreamPath}.${randomUUID()}.tmp`;
    await writeFile(stagedUpstream, upstream, { mode: 0o600 });
    await chmod(stagedUpstream, 0o600);
    await rename(stagedUpstream, upstreamPath);
  }
  if (!upstream) throw new Error("Dreamina CLI upstream artifact is unavailable.");
  if (await managedDarwinBinaryIsValid(options.binary)) return { installed: downloaded };

  const patched = patchDreaminaCliBytes(upstream, { platform: "darwin", arch: process.arch }, true);
  const staged = `${options.binary}.${randomUUID()}.tmp`;
  await writeFile(staged, patched, { mode: 0o755 });
  await chmod(staged, 0o755);
  await execFileAsync("/usr/bin/codesign", ["--force", "--sign", "-", staged]);
  await rename(staged, options.binary);
  return { installed: true };
}

export async function ensureDreaminaCliRuntime(options: {
  dataDir: string;
  platform?: NodeJS.Platform;
  arch?: string;
  fetch?: typeof fetch;
  artifact?: DreaminaCliArtifact;
}): Promise<{ binary: string; version: string; installed: boolean }> {
  const platform = {
    platform: options.platform ?? process.platform,
    arch: options.arch ?? process.arch,
  };
  const artifact = options.artifact ?? dreaminaCliArtifact(platform);
  const binary = dreaminaCliBinaryPath(options.dataDir, platform);
  const versionDir = join(options.dataDir, "tools", "dreamina", DREAMINA_CLI_VERSION);
  await mkdir(versionDir, { recursive: true });
  if (platform.platform === "darwin" && isPinnedArtifact(artifact)) {
    const result = await ensurePinnedDarwinRuntime({
      binary,
      artifact,
      fetch: options.fetch ?? fetch,
    });
    await stat(binary);
    return { binary, version: DREAMINA_CLI_VERSION, installed: result.installed };
  }
  const existingBytes = await readFile(binary).catch(() => null);
  if (existingBytes && upstreamSha256(existingBytes, platform) === artifact.sha256) {
    const patched = patchDreaminaCliBytes(existingBytes, platform, isPinnedArtifact(artifact));
    if (!Buffer.from(patched).equals(existingBytes)) {
      const staged = `${binary}.${randomUUID()}.tmp`;
      await writeFile(staged, patched, { mode: 0o755 });
      await chmod(staged, 0o755);
      await rename(staged, binary);
    }
    return { binary, version: DREAMINA_CLI_VERSION, installed: false };
  }

  const upstreamBytes = await downloadVerifiedArtifact(artifact, options.fetch ?? fetch);
  const staged = join(versionDir, `.${executableName(platform)}.${randomUUID()}.tmp`);
  try {
    const bytes = patchDreaminaCliBytes(upstreamBytes, platform, isPinnedArtifact(artifact));
    await writeFile(staged, bytes, { mode: 0o755 });
    if (platform.platform !== "win32") await chmod(staged, 0o755);
    await rename(staged, binary);
  } catch (error) {
    await unlink(staged).catch(() => undefined);
    throw error;
  }
  await stat(binary);
  return { binary, version: DREAMINA_CLI_VERSION, installed: true };
}

function parseAuthEnvelope(value: string): DreaminaCliAuthEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Dreamina OAuth state in Clash database is invalid. Reconnect Dreamina OAuth.");
  }
  const raw = parsed as Partial<DreaminaCliAuthEnvelope>;
  if (raw.version !== 1 || !Array.isArray(raw.items) || raw.items.length === 0) {
    throw new Error("Dreamina OAuth state in Clash database is invalid. Reconnect Dreamina OAuth.");
  }
  const items = raw.items.map((item) => {
    if (!item || typeof item.service !== "string" || !item.service || typeof item.account !== "string" || !item.account || typeof item.password !== "string" || !item.password) {
      throw new Error("Dreamina OAuth state in Clash database is invalid. Reconnect Dreamina OAuth.");
    }
    return { service: item.service, account: item.account, password: item.password };
  });
  return { version: 1, items };
}

const DREAMINA_SECURITY_SHIM_SOURCE = String.raw`import fs from "node:fs";

const statePath = process.env.CLASH_DREAMINA_AUTH_FILE;
if (!statePath) throw new Error("CLASH_DREAMINA_AUTH_FILE is required");

function load() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { version: 1, items: [] }; }
}
function save(state) {
  const staged = statePath + "." + process.pid + ".tmp";
  fs.writeFileSync(staged, JSON.stringify(state), { mode: 0o600 });
  fs.renameSync(staged, statePath);
  fs.chmodSync(statePath, 0o600);
}
function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}
function shellWords(line) {
  const words = [];
  let word = "";
  let quote = "";
  let escaped = false;
  let started = false;
  for (const char of line.trim()) {
    if (escaped) { word += char; escaped = false; started = true; continue; }
    if (char === "\\" && quote !== "'") { escaped = true; started = true; continue; }
    if (quote) { if (char === quote) quote = ""; else word += char; started = true; continue; }
    if (char === "'" || char === '"') { quote = char; started = true; continue; }
    if (/\s/.test(char)) { if (started) { words.push(word); word = ""; started = false; } continue; }
    word += char; started = true;
  }
  if (started) words.push(word);
  return words;
}
function missing() {
  process.stderr.write("security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.\n");
  process.exitCode = 44;
}
function execute(args) {
  const command = args[0];
  const service = valueAfter(args, "-s");
  const account = valueAfter(args, "-a") ?? valueAfter(args, "-wa");
  const state = load();
  if (command === "add-generic-password") {
    const password = valueAfter(args, "-w");
    if (!service || !account || password === undefined) throw new Error("invalid add-generic-password request");
    state.items = state.items.filter((item) => item.service !== service || item.account !== account);
    state.items.push({ service, account, password });
    save(state);
    return;
  }
  if (command === "find-generic-password") {
    const item = state.items.find((candidate) => candidate.service === service && candidate.account === account);
    if (!item) return missing();
    process.stdout.write(item.password + "\n");
    return;
  }
  if (command === "delete-generic-password") {
    const before = state.items.length;
    state.items = state.items.filter((item) => item.service !== service || (account && item.account !== account));
    if (state.items.length === before) return missing();
    save(state);
    return;
  }
  if (command === "default-keychain") { process.stdout.write('"' + statePath + '"\n'); return; }
  if (command === "dump-keychain") {
    for (const item of state.items) {
      process.stdout.write('keychain: "' + statePath + '"\nclass: "genp"\nattributes:\n    "acct"<blob>="' + item.account + '"\n    "svce"<blob>="' + item.service + '"\n');
    }
    return;
  }
  throw new Error("unsupported security shim command: " + String(command));
}

if (process.argv[2] === "-i") {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => { input += chunk; });
  process.stdin.on("end", () => { for (const line of input.split(/\r?\n/).filter(Boolean)) execute(shellWords(line)); });
} else {
  execute(process.argv.slice(2));
}
`;

async function ensureSecurityShim(dataDir: string): Promise<{ executable: string; source: string }> {
  const toolsDir = join(dataDir, "tools", "dreamina");
  const source = join(toolsDir, "security-shim.mjs");
  const executable = dreaminaSecurityShimExecutablePath();
  await mkdir(toolsDir, { recursive: true });
  if ((await readFile(source, "utf8").catch(() => "")) !== DREAMINA_SECURITY_SHIM_SOURCE) {
    await writeFile(source, DREAMINA_SECURITY_SHIM_SOURCE, { mode: 0o600 });
    await chmod(source, 0o600);
  }
  const existing = await lstat(executable).catch(() => null);
  if (existing && (existing.isSymbolicLink() || (typeof process.getuid === "function" && existing.uid !== process.getuid()))) {
    throw new Error(`Unsafe Dreamina security shim path: ${executable}`);
  }
  const wrapper = '#!/bin/sh\nexec "$CLASH_DREAMINA_NODE" "$CLASH_DREAMINA_SECURITY_SHIM" "$@"\n';
  const staged = `${executable}.${randomUUID()}.tmp`;
  await writeFile(staged, wrapper, { mode: 0o700 });
  await chmod(staged, 0o700);
  await rename(staged, executable);
  return { executable, source };
}

/** Runs the patched self-hosted CLI against a per-call DB envelope, never macOS Keychain. */
export function createDatabaseDreaminaCliAuthSandbox(config: { dataDir: string }): DreaminaCliAuthSandbox {
  return {
    async run({ run, args, options, authState }) {
      const root = await mkdtemp(join(tmpdir(), "clash-dreamina-auth-"));
      const home = join(root, "home");
      const authFile = join(root, "oauth.json");
      try {
        await mkdir(home, { recursive: true });
        const initial = authState ? parseAuthEnvelope(authState) : { version: 1, items: [] } satisfies DreaminaCliAuthEnvelope;
        await writeFile(authFile, JSON.stringify(initial), { mode: 0o600 });
        await chmod(authFile, 0o600);
        const shim = await ensureSecurityShim(config.dataDir);
        let result: DreaminaCliRunResult;
        try {
          result = await run(args, {
            ...(options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
            env: {
              ...(options?.env ?? {}),
              HOME: home,
              ELECTRON_RUN_AS_NODE: "1",
              CLASH_DREAMINA_NODE: process.execPath,
              CLASH_DREAMINA_SECURITY_SHIM: shim.source,
              CLASH_DREAMINA_SECURITY_EXECUTABLE: shim.executable,
              CLASH_DREAMINA_AUTH_FILE: authFile,
            },
          });
        } catch (error) {
          if (options?.captureAuthState && error instanceof DreaminaCliCommandError) {
            const captured = parseAuthEnvelope(await readFile(authFile, "utf8"));
            error.result.authState = JSON.stringify(captured);
          }
          throw error;
        }
        if (!options?.captureAuthState) return result;
        const captured = parseAuthEnvelope(await readFile(authFile, "utf8"));
        return { ...result, authState: JSON.stringify(captured) };
      } finally {
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    },
  };
}

export function createManagedDreaminaCliRun(options: {
  dataDir: string;
  ensure?: () => Promise<{ binary: string; version: string; installed: boolean }>;
  createRun?: (binary: string) => DreaminaCliRun;
  loadAuthState?: () => Promise<string | undefined>;
  authSandbox?: DreaminaCliAuthSandbox;
}): DreaminaCliRun {
  let resolved: Promise<DreaminaCliRun> | undefined;
  return async (args, runOptions) => {
    resolved ??= (options.ensure?.() ?? ensureDreaminaCliRuntime({ dataDir: options.dataDir }))
      .then((runtime) => (options.createRun ?? createDreaminaCliRun)(runtime.binary));
    const rawRun = await resolved;
    const authState = runOptions?.authState === undefined
      ? await options.loadAuthState?.()
      : runOptions.authState ?? undefined;
    const authSandbox = options.authSandbox ?? createDatabaseDreaminaCliAuthSandbox({ dataDir: options.dataDir });
    return authSandbox.run({ run: rawRun, args, options: runOptions, authState });
  };
}
