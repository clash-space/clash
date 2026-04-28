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

import { mkdir, readdir, rm, stat, symlink, lstat, readlink } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./platform.js";

const GC_AGE_SECONDS = 7 * 24 * 60 * 60;
const PLUGIN_NAME = "clash-video-production";

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
  const cwd = join(paths().sessionsDir, sessionId);
  const pluginsDir = join(cwd, ".claude", "plugins");
  await mkdir(pluginsDir, { recursive: true });
  await ensurePluginLink(pluginsDir);
  return cwd;
}

/** Resolves the absolute path to dist/plugin/<name>/ in the bundled output. */
function bundledPluginSrc(): string {
  // After tsup bundling, this module lives at dist/<chunk>.js. The plugin
  // dir is dist/plugin/<name>/, sibling. import.meta.url resolves to the
  // chunk file regardless of which command invoked us.
  return fileURLToPath(new URL(`../plugin/${PLUGIN_NAME}/`, import.meta.url));
}

async function ensurePluginLink(pluginsDir: string): Promise<void> {
  const dst = join(pluginsDir, PLUGIN_NAME);
  const src = bundledPluginSrc();
  try {
    const st = await lstat(dst);
    if (st.isSymbolicLink()) {
      const target = await readlink(dst);
      if (target === src) return; // already correct
      await rm(dst, { force: true });
    } else if (st.isDirectory()) {
      // Old copy from a previous version. Remove and re-link to current.
      await rm(dst, { recursive: true, force: true });
    }
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  try {
    await symlink(src, dst, "dir");
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "EPERM" || (e as NodeJS.ErrnoException).code === "ENOSYS") {
      // FS doesn't support symlinks (Windows w/o developer mode, some
      // exotic mounts). Fall back to a recursive copy. Plugin is small
      // (~few KB), so the cost is negligible.
      const { cp } = await import("node:fs/promises");
      await cp(src, dst, { recursive: true });
      return;
    }
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
