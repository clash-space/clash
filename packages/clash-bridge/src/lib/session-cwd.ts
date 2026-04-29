/**
 * Per-crew-member, per-project workspace management.
 *
 * Each spawned ACP agent runs with cwd
 *   `~/.clash/crew/<member-id>/<project-id>/`
 * — never the user's pwd.
 *
 * "Crew" because Director / Canvas Editor / Storyboard Artist are
 * literally video-production crew roles, matching the Clash domain.
 * Each crew member has its own bundled CLAUDE.md system prompt + skill
 * set + chosen ACP runtime (claude-code-acp by default; could be
 * openclaw / hermes / … per `dist/crew/<id>/runtime.json`).
 *
 * Per-project subdir keeps memory and tool state isolated between
 * different clash projects — the Director chatting about project A
 * doesn't bleed context into project B.
 *
 * Workspaces are GC'd when untouched for 7 days. Eager rm-on-dispose
 * would lose the CC transcript that powers Resume.
 */

import { mkdir, readdir, readFile, rm, stat, cp, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./platform.js";

const GC_AGE_SECONDS = 7 * 24 * 60 * 60;
/** Used when the caller doesn't supply a project id (e.g. Quick connect). */
const DEFAULT_PROJECT = "_default";

/** Bridge's bundled `dist/crew/` root. */
function bundledCrewDir(): string {
  // After tsup bundles, this module lives in `dist/<chunk>.js`, so the
  // crew tree is the SIBLING `dist/crew/` — i.e. ./crew/ from here.
  // Source-tree callers see the same shape (build emits dist/crew/
  // before any code that touches this dir runs).
  return fileURLToPath(new URL("./crew/", import.meta.url));
}

export interface CrewMemberManifest {
  id: string;
  label: string;
  summary: string;
  agent_id: string;
}

/** Read the bundled crew manifest. Used by daemon hello + picker. */
export async function listBundledCrew(): Promise<CrewMemberManifest[]> {
  try {
    const text = await readFile(join(bundledCrewDir(), "manifest.json"), "utf-8");
    const json = JSON.parse(text) as { crew?: CrewMemberManifest[] };
    return json.crew ?? [];
  } catch {
    return [];
  }
}

/**
 * Resolve a crew-member id to its bundled `runtime.json` (which agent
 * CLI to spawn). Returns null when the id isn't a known bundled crew
 * member — caller should treat that as a 404-equivalent error.
 */
export async function readCrewRuntime(crewId: string): Promise<{ agent_id: string } | null> {
  try {
    const text = await readFile(join(bundledCrewDir(), crewId, "runtime.json"), "utf-8");
    return JSON.parse(text) as { agent_id: string };
  } catch {
    return null;
  }
}

/**
 * Ensure the workspace exists for (crew member, project) and return
 * its absolute path. Idempotent — safe to call on every spawn.
 *
 * Layout:
 *   ~/.clash/crew/<member-id>/<project-id>/
 *     CLAUDE.md
 *     .claude/
 *       skills/...
 *       commands/...
 */
export async function ensureCrewCwd(crewId: string, projectId?: string): Promise<string> {
  await migrateLegacyDirs();
  const proj = projectId && projectId.length > 0 ? sanitize(projectId) : DEFAULT_PROJECT;
  const cwd = join(paths().configDir, "crew", sanitize(crewId), proj);
  await mkdir(cwd, { recursive: true });
  await installCrewTemplate(crewId, cwd);
  return cwd;
}

/** Filesystem-safe form of an arbitrary id (no slashes, no leading dots). */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
}

/**
 * Copy the bundled crew member template (CLAUDE.md + .claude/) into
 * the workspace cwd. Reapplied every spawn so an upgraded daemon
 * refreshes stale prompts / skills automatically. Per-workspace hand
 * edits to non-overlapping files are preserved; matching names get
 * overwritten.
 */
async function installCrewTemplate(crewId: string, cwd: string): Promise<void> {
  const tpl = join(bundledCrewDir(), sanitize(crewId), "template");
  try {
    await cp(tpl, cwd, { recursive: true, force: true });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      // Bridge daemon was asked to spawn a crew member that isn't
      // bundled (custom crew, future). For v1 we fall back to bare cwd
      // and let CC behave as a vanilla agent — better than crashing.
      return;
    }
    throw e;
  }
}

/**
 * Pre-crew versions stored workspaces under
 *   ~/.clash/sessions/<id>/   (beta.20–25)
 *   ~/.clash/workspaces/<id>/ (beta.26 briefly)
 * Move both out of the way on first call so they don't sit around
 * confusing future debugging. We don't try to import them into the
 * crew structure — the chat ids don't match the new shape, and Resume
 * picker scans CC's projects dir directly so transcripts remain
 * reachable as long as the user doesn't manually rm them.
 */
async function migrateLegacyDirs(): Promise<void> {
  const archive = join(paths().configDir, ".legacy-archive");
  for (const oldName of ["sessions", "workspaces"]) {
    const old = join(paths().configDir, oldName);
    try { await stat(old); } catch { continue; }
    try {
      await mkdir(archive, { recursive: true });
      await rename(old, join(archive, oldName));
    } catch {
      /* best-effort; user can clean by hand */
    }
  }
}

/* Back-compat shim — daemon's existing call site uses the old name. */
export const ensureSessionCwd = ensureCrewCwd;

/**
 * Drop workspaces (under any crew member, any project) untouched for
 * 7+ days. Called from daemon startup. Errors swallowed so a stuck
 * dir doesn't crash daemon.
 *
 * Function name kept as `gcOldSessions` for back-compat with the
 * daemon's call site.
 */
export async function gcOldSessions(): Promise<{ removed: number }> {
  const root = join(paths().configDir, "crew");
  const cutoff = Math.floor(Date.now() / 1000) - GC_AGE_SECONDS;
  let removed = 0;
  let members: string[];
  try { members = await readdir(root); } catch { return { removed: 0 }; }
  for (const m of members) {
    const memberDir = join(root, m);
    let projects: string[];
    try { projects = await readdir(memberDir); } catch { continue; }
    for (const proj of projects) {
      const full = join(memberDir, proj);
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
  }
  return { removed };
}
