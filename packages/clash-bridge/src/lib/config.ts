/**
 * Credentials + machine-id persistence.
 *
 * `credentials.json` is mode 0600 (owner read/write only) — the runtime
 * token is a long-lived bearer credential and we don't want any
 * user/group on the box reading it. The directory is mode 0700 so the
 * file's permissions can't be evaded by traversing the parent.
 *
 * `machine-id` is just a UUID generated on first run and persisted —
 * survives daemon reinstalls but is per-user (same machine, different
 * unix user → different machine_id, by design; runtimes are per-user).
 */

import { mkdir, readFile, writeFile, chmod, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { paths } from "./platform.js";

export interface Credentials {
  /** API root, e.g. "https://api.clash.video". WS attach swaps https→wss. */
  serverUrl: string;
  /** Runtime row id returned by /exchange. */
  runtimeId: string;
  /** sk_machine_… — bearer token for /agents/runtime/_attach. */
  token: string;
  /**
   * `clsh_*` API key the spawned ACP agent uses to call clash REST APIs
   * (the bundled `clash` CLI / plugin hooks read it as CLASH_API_KEY).
   * Issued by the server during /exchange so the user never needs a
   * separate login step on the daemon machine.
   */
  agentApiKey?: string;
  /** Echoed for diagnostics; daemon also reads machineIdFile directly. */
  machineId: string;
  /** When this machine was first registered (unix seconds). */
  createdAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeCredentials(value: unknown): value is Credentials {
  if (!isRecord(value)) return false;
  return (
    typeof value.serverUrl === "string"
    && typeof value.runtimeId === "string"
    && typeof value.token === "string"
    && typeof value.machineId === "string"
    && typeof value.createdAt === "number"
    && (value.agentApiKey === undefined || typeof value.agentApiKey === "string")
  );
}

export async function readCreds(): Promise<Credentials | null> {
  await migrateLegacyConfigDir();
  try {
    const text = await readFile(paths().credsFile, "utf-8");
    const parsed = JSON.parse(text) as unknown;
    return isRuntimeCredentials(parsed) ? parsed : null;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/**
 * Pre-beta.12 daemons stored everything under
 * `~/Library/Application Support/clash/` (macOS) or `~/.config/clash/` (linux).
 * beta.12+ uses `~/.clash/` on every platform. Move the legacy creds + machine
 * id into the new spot the first time we see them, then delete the old dir
 * (it'll otherwise just sit there confusing future debugging).
 */
async function migrateLegacyConfigDir(): Promise<void> {
  const newDir = paths().configDir;
  // Already migrated if the new creds file exists.
  try { await readFile(paths().credsFile, "utf-8"); return; } catch { /* fall through */ }

  const legacyCandidates = [
    join(homedir(), "Library", "Application Support", "clash"),
    join(homedir(), ".config", "clash"),
  ].filter((p) => p !== newDir);

  for (const legacy of legacyCandidates) {
    let legacyCreds: string;
    try { legacyCreds = await readFile(join(legacy, "credentials.json"), "utf-8"); }
    catch { continue; }
    await mkdir(newDir, { recursive: true, mode: 0o700 });
    await writeFile(paths().credsFile, legacyCreds, { mode: 0o600 });
    // Also migrate machine-id so we re-attach as the same runtime.
    try {
      const mid = await readFile(join(legacy, "machine-id"), "utf-8");
      await writeFile(paths().machineIdFile, mid, { mode: 0o600 });
    } catch { /* legacy install never persisted one — fine */ }
    // Best-effort cleanup; if rm fails the user can `rm -rf` themselves.
    try { await rm(legacy, { recursive: true, force: true }); } catch { /* ignore */ }
    process.stderr.write(`→ migrated config from ${legacy} to ${newDir}\n`);
    return;
  }
}

export async function writeCreds(creds: Credentials): Promise<void> {
  const file = paths().credsFile;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  let existing: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as unknown;
    if (isRecord(parsed)) existing = parsed;
  } catch {
    // A missing or malformed old credential file is replaced by valid runtime credentials.
  }
  await writeFile(file, JSON.stringify({ ...existing, ...creds }, null, 2), { mode: 0o600 });
  // chmod again in case the file already existed with looser perms.
  await chmod(file, 0o600);
}

export async function deleteCreds(): Promise<void> {
  const { unlink } = await import("node:fs/promises");
  try {
    await unlink(paths().credsFile);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/**
 * Get-or-create the per-user machine fingerprint. Generated once and
 * persisted; survives daemon reinstalls but is not tied to hardware
 * (so a `~` restore from backup keeps the same id, which is what we
 * want — the user's runtime continues to be "the same machine").
 */
export async function getOrCreateMachineId(): Promise<string> {
  const file = paths().machineIdFile;
  try {
    const id = (await readFile(file, "utf-8")).trim();
    if (id.length >= 32) return id;
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const id = randomUUID();
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, id + "\n", { mode: 0o600 });
  return id;
}
