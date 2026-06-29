#!/usr/bin/env node
/**
 * Build the bundled agent tree:
 *
 *   dist/agents/
 *   ├── manifest.json                         ← list of all agent templates + meta
 *   ├── master-clash/
 *   │   ├── runtime.json                      ← bridge-only (which CLI to spawn)
 *   │   └── template/                         ← what gets cp -R'd into the workspace
 *   │       ├── CLAUDE.md
 *   │       └── .claude/
 *   │           ├── skills/                   ← from assets/shared-cwd
 *   │           └── commands/
 *   ├── canvas-editor/...
 *   ...
 *
 * The single agent template inherits the shared `.claude/` config plus
 * its own AGENTS.md product contract.
 */

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const ASSETS = join(root, "assets");
const DIST = join(root, "dist", "agents");

const LABELS = {
  "master-clash": { label: "Master Clash", summary: "Runs the Clash project through the local clash CLI." },
};

async function main() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  const ids = (await readdir(join(ASSETS, "agents"))).filter((n) => !n.startsWith("."));
  const manifest = [];

  for (const id of ids) {
    const src = join(ASSETS, "agents", id);
    const dst = join(DIST, id);
    const dstTpl = join(dst, "template");
    await mkdir(dstTpl, { recursive: true });

    // Compose AGENTS.md = shared prelude (universal agent rules) + this
    // role's body. The prelude pins behaviors that have to hold across
    // every agent template (must `clash room say` when @-mentioned, etc.)
    // — putting them in the shared SKILL is unreliable because Claude
    // Code only loads skills on demand, but AGENTS.md is always read at
    // session start. Keep role-specific guidance in
    // assets/agents/<role>/AGENTS.md; cross-cutting rules go in the
    // prelude so a fix lands for every agent at once.
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

  await writeFile(join(DIST, "manifest.json"), JSON.stringify({ agents: manifest }, null, 2));
  process.stdout.write(`bundled ${ids.length} agents → dist/agents/\n`);
}

main().catch((e) => {
  process.stderr.write(`bundle-agents failed: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
