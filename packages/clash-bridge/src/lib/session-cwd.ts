/**
 * Per-project workspace management.
 *
 * Each spawned ACP agent runs with cwd
 *   `~/.clash/projects/<encoded-project-id>/`
 * — never the user's shell pwd and never a per-session directory.
 * The path segment is URI-encoded to avoid collisions; `.clash/project.toml`
 * stores the canonical project id.
 *
 * Each agent template has its own bundled AGENTS.md system prompt + chosen
 * ACP runtime (claude-agent-acp by default; could be
 * openclaw / hermes / … per `dist/agents/<id>/runtime.json`).
 *
 * Per-project directories keep project files, local artifacts, agent tool
 * state, and transcripts pointed at the same stable root. Sessions remain
 * separate local DB rows and ACP session ids; they do not create separate cwd.
 *
 * Project directories are not GC'd on session end. Deleting a project should
 * be an explicit product action.
 */

import { mkdir, readFile, cp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "./platform.js";

/** Used when the caller doesn't supply a project id (e.g. Quick connect). */
const DEFAULT_PROJECT = "_default";

/** Bridge's bundled `dist/agents/` root. */
function bundledAgentsDir(): string {
  // After tsup bundles, this module lives in `dist/<chunk>.js`, so the
  // agent tree is the SIBLING `dist/agents/` — i.e. ./agents/ from here.
  // Source-tree callers run from `src/lib/*`, so look at the built
  // dist/agents folder too. The package build emits it before publish, and
  // local tests can run `pnpm --filter @clash-space/bridge bundle:agents`
  // without needing to bundle TS first.
  const candidates = [
    new URL("./agents/", import.meta.url),
    new URL("../../dist/agents/", import.meta.url),
  ];
  for (const candidate of candidates) {
    const path = fileURLToPath(candidate);
    if (existsSync(path)) return path;
  }
  return fileURLToPath(candidates[0]);
}

export interface AgentTemplateManifest {
  id: string;
  label: string;
  summary: string;
  agent_id: string;
}

/** Read the bundled agent manifest. Used by daemon hello + picker. */
export async function listBundledAgents(): Promise<AgentTemplateManifest[]> {
  try {
    const text = await readFile(join(bundledAgentsDir(), "manifest.json"), "utf-8");
    const json = JSON.parse(text) as { agents?: AgentTemplateManifest[] };
    return json.agents ?? [];
  } catch {
    return [];
  }
}

/**
 * Resolve an agent template id to its bundled `runtime.json` (which ACP
 * CLI to spawn). Returns null when the id isn't a known bundled agent
 * template — caller should treat that as a 404-equivalent error.
 */
export async function readAgentRuntime(agentTemplateId: string): Promise<{ agent_id: string } | null> {
  try {
    const text = await readFile(join(bundledAgentsDir(), agentTemplateId, "runtime.json"), "utf-8");
    return JSON.parse(text) as { agent_id: string };
  } catch {
    return null;
  }
}

/**
 * Ensure the project workspace exists and return its absolute path.
 * Idempotent — safe to call on every spawn.
 *
 * Layout:
 *   ~/.clash/projects/<encoded-project-id>/
 *     AGENTS.md
 *     .clash/project.toml
 *     .claude/
 *       skills/...
 *       commands/...
 */
export async function ensureAgentCwd(agentTemplateId: string, projectId?: string): Promise<string> {
  const canonicalProjectId = projectId && projectId.length > 0 ? projectId : DEFAULT_PROJECT;
  const projectPathSegment = projectIdPathSegment(canonicalProjectId);
  const cwd = join(paths().projectsDir, projectPathSegment);
  await mkdir(cwd, { recursive: true });
  await ensureProjectWorkspaceLayout(cwd);
  await installAgentTemplate(agentTemplateId, cwd);
  await writeProjectMarker(cwd, canonicalProjectId);
  return cwd;
}

async function ensureProjectWorkspaceLayout(cwd: string): Promise<void> {
  await Promise.all([
    mkdir(join(cwd, "drafts"), { recursive: true }),
    mkdir(join(cwd, "projections", "text"), { recursive: true }),
    mkdir(join(cwd, "projections", "timelines"), { recursive: true }),
    mkdir(join(cwd, "projections", "storyboards"), { recursive: true }),
    mkdir(join(cwd, "projections", "prompts"), { recursive: true }),
    mkdir(join(cwd, "projections", "metadata"), { recursive: true }),
    mkdir(join(cwd, "timelines"), { recursive: true }),
    mkdir(join(cwd, "sessions"), { recursive: true }),
    mkdir(join(cwd, "assets", "links"), { recursive: true }),
    mkdir(join(cwd, "runtime"), { recursive: true }),
  ]);
}

/** Filesystem-safe form of an arbitrary id (no slashes, no leading dots). */
function sanitize(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/^\.+/, "");
}

function projectIdPathSegment(id: string): string {
  const encoded = encodeURIComponent(id).replace(/\./g, "%2E");
  return encoded || DEFAULT_PROJECT;
}

/**
 * Copy the bundled agent template into the project cwd. Reapplied every
 * spawn so an upgraded daemon refreshes stale prompts / skills automatically.
 * Per-project files with non-overlapping names are preserved; matching bundled
 * names get overwritten.
 */
async function installAgentTemplate(agentTemplateId: string, cwd: string): Promise<void> {
  const templateId = sanitize(agentTemplateId);
  const tpl = join(bundledAgentsDir(), templateId, "template");
  try {
    await cp(tpl, cwd, { recursive: true, force: true });
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`unknown agent template: ${templateId}`);
    }
    throw e;
  }
}

async function writeProjectMarker(cwd: string, projectId: string): Promise<void> {
  const markerDir = join(cwd, ".clash");
  await mkdir(markerDir, { recursive: true });
  await writeFile(
    join(markerDir, "project.toml"),
    [
      "schema_version = 1",
      `project_id = ${JSON.stringify(projectId)}`,
      `workspace_id = ${JSON.stringify(`managed:${projectIdPathSegment(projectId)}`)}`,
      'store = "managed"',
      "",
      "[sync]",
      'mode = "local"',
      "",
    ].join("\n"),
    "utf-8",
  );
}

// v1 does not auto-migrate old cwd layouts into a hidden archive directory.
// Project cwd creation is explicit and stable under ~/.clash/projects/<encoded-id>.

/**
 * Project cwd is durable product state. Function name kept for the daemon's
 * existing call site; it intentionally does not delete project directories.
 */
export async function gcOldSessions(): Promise<{ removed: number }> {
  return { removed: 0 };
}
