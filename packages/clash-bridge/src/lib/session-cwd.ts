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

import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { paths } from "./platform.js";

const GC_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Returns the cwd path for a session; creates it (and its `.claude` skeleton)
 * if it doesn't already exist.
 */
export async function ensureSessionCwd(sessionId: string): Promise<string> {
  const cwd = join(paths().sessionsDir, sessionId);
  await mkdir(join(cwd, ".claude"), { recursive: true });
  return cwd;
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
