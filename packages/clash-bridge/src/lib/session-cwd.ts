/**
 * Per-chat workspace management.
 *
 * Every spawned ACP agent runs with cwd = `~/.clash/workspaces/<id>/`
 * — never the user's pwd. Three reasons:
 *
 *   1. Plugin / settings injection. We need a writable `.claude/` dir to
 *      drop our config + skills into; doing that in the user's project
 *      would pollute their repo.
 *   2. Isolation. Two parallel chats don't see each other's transcripts
 *      or tool-call state.
 *   3. Stable transcript paths. Resume needs the cwd to be the same
 *      next time; the user's pwd is whatever terminal they ran `npx`
 *      from this morning.
 *
 * "Workspace" not "session" because Claude Code uses "session" for the
 * conversation transcript itself (acp_session_id). One workspace can
 * hold multiple CC sessions over its lifetime if the user resumes.
 *
 * Cleanup is GC'd, not eager — a 7-day-old workspace is removed on the
 * next daemon startup. Eager rm-on-dispose would lose the transcript
 * that powers Resume.
 */

import { mkdir, readdir, rm, stat, cp, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./platform.js";

const GC_AGE_SECONDS = 7 * 24 * 60 * 60;
const DIR_NAME_LEN = 12;

/**
 * Derive a short, filesystem-friendly dir name from any chat id. UUIDs
 * are 36 chars and look unwieldy when listed in `~/.clash/workspaces/`;
 * 12 hex chars (48 bits) are short enough to scan visually but still
 * have enough entropy to avoid practical collisions. Deterministic so
 * the same chat id always maps to the same workspace (resume / GC work).
 */
function dirNameFor(chatId: string): string {
  if (/^[a-f0-9]{1,12}$/i.test(chatId)) return chatId.toLowerCase();
  return createHash("sha256").update(chatId).digest("hex").slice(0, DIR_NAME_LEN);
}

/**
 * Return the workspace cwd path for a chat, creating it (and its
 * `.claude` skeleton) if missing. Also installs the bundled CC config
 * tree so the spawned agent picks up our CLAUDE.md, skills, and commands.
 *
 * Function name kept short — callers don't need the longer
 * `ensureChatWorkspace`.
 */
export async function ensureSessionCwd(chatId: string): Promise<string> {
  await migrateLegacySessionsDir();
  const cwd = join(paths().workspacesDir, dirNameFor(chatId));
  await mkdir(cwd, { recursive: true });
  await installCcConfig(cwd);
  return cwd;
}

/**
 * Pre-beta.26 daemons stored chat workspaces under `~/.clash/sessions/`
 * — confusingly named because CC uses "session" for the conversation
 * transcript. beta.26+ uses `~/.clash/workspaces/`. Move on first call
 * so existing chats keep their transcripts (resume continues to work).
 */
async function migrateLegacySessionsDir(): Promise<void> {
  const newDir = paths().workspacesDir;
  const oldDir = join(homedir(), ".clash", "sessions");
  if (oldDir === newDir) return;
  try { await stat(newDir); return; } catch { /* not yet present */ }
  try { await stat(oldDir); } catch { return; /* nothing to migrate */ }
  try {
    await rename(oldDir, newDir);
  } catch {
    // Cross-device move or perms — fall back to copy + leave old dir
    // alone so the user can clean it up manually if they care.
    await cp(oldDir, newDir, { recursive: true });
  }
}

/**
 * Copy the bundled CC configuration tree into the workspace cwd. This
 * lays out files at the paths Claude Code actually scans:
 *
 *   <cwd>/CLAUDE.md                          system prompt
 *   <cwd>/.claude/skills/<name>/SKILL.md     auto-loadable skills
 *   <cwd>/.claude/commands/<name>.md         user-invokable /commands
 *
 * Earlier versions used the openclaw "plugin" format which CC ignores.
 * Putting the files at CC's canonical paths is what actually makes the
 * spawned Claude Code aware that it's running as a clash agent.
 *
 * Reapplied every spawn so a stale tree from a prior bridge version
 * gets refreshed. Per-workspace hand-edits are preserved unless they
 * collide with a bundled file name.
 */
async function installCcConfig(cwd: string): Promise<void> {
  const src = fileURLToPath(new URL("../cc-config/", import.meta.url));
  try {
    await cp(src, cwd, { recursive: true, force: true });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}

/**
 * Best-effort: drop workspace directories not touched in `GC_AGE_SECONDS`.
 * Called by the daemon on startup so reboots reclaim disk without an
 * explicit timer. Errors are swallowed — a stuck dir is preferable to a
 * crashed daemon.
 *
 * Function name kept as `gcOldSessions` for back-compat with daemon's
 * call site; semantically it's "gc old workspaces" now.
 */
export async function gcOldSessions(): Promise<{ removed: number }> {
  const root = paths().workspacesDir;
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { removed: 0 };
    return { removed: 0 };
  }
  const cutoff = Math.floor(Date.now() / 1000) - GC_AGE_SECONDS;
  let removed = 0;
  for (const entry of entries) {
    const full = join(root, entry);
    try {
      const st = await stat(full);
      if (!st.isDirectory()) continue;
      if (Math.floor(st.mtimeMs / 1000) > cutoff) continue;
      await rm(full, { recursive: true, force: true });
      removed += 1;
    } catch {
      /* skip */
    }
  }
  return { removed };
}
