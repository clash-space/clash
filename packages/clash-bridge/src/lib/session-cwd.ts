/**
 * Per-session working directory management.
 *
 * Every spawned ACP agent runs with cwd = `~/.clash/sessions/<session-id>/`
 * — never the user's pwd. Three reasons:
 *
 *   1. Plugin / settings injection. We need a writable `.claude/` dir to
 *      drop our plugin into; doing that in the user's project would
 *      pollute their repo.
 *   2. Isolation. Two parallel sessions don't see each other's transcripts
 *      or tool-call state.
 *   3. Stable transcript paths. Resume-from-disk needs the cwd to be the
 *      same next time; the user's pwd is whatever terminal they ran
 *      `npx` from this morning.
 *
 * Cleanup is GC'd, not eager — a 7-day-old session dir is removed on the
 * next daemon startup. Eager rm-on-dispose would lose the transcript that
 * powers Resume.
 */

import { mkdir, readdir, rm, stat, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./platform.js";

const GC_AGE_SECONDS = 7 * 24 * 60 * 60;
const DIR_NAME_LEN = 12;

/**
 * Derive a short, filesystem-friendly dir name from any session id. UUIDs
 * are 36 chars and look unwieldy when listed in `~/.clash/sessions/`;
 * 12 hex chars (48 bits) are short enough to scan visually but still
 * have enough entropy to avoid practical collisions. Deterministic so
 * the same session_id always maps to the same dir (resume / GC work).
 */
function dirNameFor(sessionId: string): string {
  if (/^[a-f0-9]{1,12}$/i.test(sessionId)) return sessionId.toLowerCase();
  return createHash("sha256").update(sessionId).digest("hex").slice(0, DIR_NAME_LEN);
}

/**
 * Returns the cwd path for a session; creates it (and its `.claude` skeleton)
 * if it doesn't already exist. Also installs the bundled clash plugin into
 * `.claude/plugins/<name>/` so the spawned ACP agent picks up our skills,
 * commands, and SessionStart hook.
 *
 * Plugin is installed as a symlink to dist/plugin/<name>/ — saves disk and
 * makes plugin updates automatic when the user upgrades the daemon. Falls
 * back to copying if symlink isn't available (Windows; FS without symlink
 * permission).
 */
export async function ensureSessionCwd(sessionId: string): Promise<string> {
  const cwd = join(paths().sessionsDir, dirNameFor(sessionId));
  await mkdir(cwd, { recursive: true });
  await installCcConfig(cwd);
  return cwd;
}

/**
 * Copy the bundled CC configuration tree into the session cwd. This
 * lays out files at the paths Claude Code actually scans:
 *
 *   <cwd>/CLAUDE.md                          system prompt
 *   <cwd>/.claude/skills/<name>/SKILL.md     auto-loadable skills
 *   <cwd>/.claude/commands/<name>.md         user-invokable /commands
 *
 * Earlier versions used the openclaw "plugin" format
 * (<cwd>/.claude/plugins/clash-video-production/openclaw.plugin.json
 * + skills below it). CC ignores that format — only openclaw / acpx
 * read it. Putting the files at CC's canonical paths is what actually
 * makes the spawned Claude Code aware that it's running as a clash
 * agent.
 *
 * `cp -R` is reapplied every spawn so a stale tree from a prior
 * version of clash-bridge gets refreshed. Per-session hand-edits are
 * preserved on the same session id (we only overwrite identically-
 * named files in the bundled tree).
 */
async function installCcConfig(cwd: string): Promise<void> {
  const src = fileURLToPath(new URL("../cc-config/", import.meta.url));
  try {
    await cp(src, cwd, { recursive: true, force: true });
  } catch (e: unknown) {
    // Missing bundle would only happen in a broken dev install; don't
    // crash spawn — the agent just won't have skills/commands set up.
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw e;
  }
}


/**
 * Best-effort: drop session directories not touched in `GC_AGE_SECONDS`.
 * Called by the daemon on startup so reboots reclaim disk without an
 * explicit timer. Errors are swallowed — a stuck dir is preferable to a
 * crashed daemon.
 */
export async function gcOldSessions(): Promise<{ removed: number }> {
  const root = paths().sessionsDir;
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
