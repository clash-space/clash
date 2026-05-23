#!/usr/bin/env node
/**
 * Build the bundled crew tree:
 *
 *   dist/crew/
 *   ├── manifest.json                         ← list of all crew members + meta
 *   ├── director/
 *   │   ├── runtime.json                      ← bridge-only (which CLI to spawn)
 *   │   └── template/                         ← what gets cp -R'd into the workspace
 *   │       ├── CLAUDE.md
 *   │       └── .claude/
 *   │           ├── skills/                   ← from assets/shared-cwd
 *   │           └── commands/
 *   ├── canvas-editor/...
 *   ...
 *
 * Each crew member inherits the shared `.claude/` config plus their own
 * CLAUDE.md (the role-defining system prompt). Future customization
 * (per-member skills, per-member commands) layers on top of this same
 * shape.
 *
 * "Crew" because Director / Canvas Editor / Storyboard Artist are
 * literally video-production crew roles — matches the Clash domain.
 */

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const ASSETS = join(root, "assets");
const DIST = join(root, "dist", "crew");

const LABELS = {
  director:          { label: "Director",          summary: "Plans the video and orchestrates the other roles." },
  "canvas-editor":   { label: "Canvas Editor",     summary: "Adds / edits / reorders / deletes nodes on the canvas." },
  generator:         { label: "Generator",         summary: "Dispatches and tracks image / video / clip generation." },
  storyboard:        { label: "Storyboard Artist", summary: "Sketches a shot list and lays it on the canvas." },
  "project-manager": { label: "Project Manager",   summary: "Lists / creates / switches / deletes projects." },
};

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const ids = (await readdir(join(ASSETS, "crew"))).filter((n) => !n.startsWith("."));
  const manifest = [];

  for (const id of ids) {
    const src = join(ASSETS, "crew", id);
    const dst = join(DIST, id);
    const dstTpl = join(dst, "template");
    await mkdir(dstTpl, { recursive: true });

    // Compose AGENTS.md = shared prelude (universal crew rules) + this
    // role's body. The prelude pins behaviors that have to hold across
    // every crew member (must `clash room say` when @-mentioned, etc.)
    // — putting them in the shared SKILL is unreliable because Claude
    // Code only loads skills on demand, but AGENTS.md is always read at
    // session start. Keep role-specific guidance in
    // assets/crew/<role>/AGENTS.md; cross-cutting rules go in the
    // prelude so a fix lands for every crew at once.
    const prelude = await readFile(join(ASSETS, "shared-cwd", "AGENTS-prelude.md"), "utf-8");
    const roleBody = await readFile(join(src, "AGENTS.md"), "utf-8");
    await writeFile(join(dstTpl, "AGENTS.md"), prelude.trimEnd() + "\n\n" + roleBody);
    await cp(join(src, "runtime.json"), join(dst, "runtime.json"));
    // Copy `.claude/` but EXCLUDE the prelude file we already inlined.
    await cp(join(ASSETS, "shared-cwd", ".claude"), join(dstTpl, ".claude"), { recursive: true });

    const runtime = JSON.parse(await readFile(join(dst, "runtime.json"), "utf-8"));
    const meta = LABELS[id] ?? { label: id, summary: "" };
    manifest.push({
      id,
      label: meta.label,
      summary: meta.summary,
      agent_id: runtime.agent_id,
    });
  }

  await writeFile(join(DIST, "manifest.json"), JSON.stringify({ crew: manifest }, null, 2));
  process.stdout.write(`bundled ${ids.length} crew members → dist/crew/\n`);
}

main().catch((e) => {
  process.stderr.write(`bundle-crew failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
