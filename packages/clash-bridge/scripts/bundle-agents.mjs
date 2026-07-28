#!/usr/bin/env node
/**
 * Build the bundled agent tree:
 *
 *   dist/agents/
 *   ├── manifest.json                         ← list of all agent templates + meta
 *   ├── master-clash/
 *   │   ├── runtime.json                      ← bridge-only (which CLI to spawn)
 *   │   └── template/                         ← what gets cp -R'd into the workspace
 *   │       ├── AGENTS.md
 *   │       ├── CLAUDE.md
 *   │       └── GEMINI.md
 *   ├── canvas-editor/...
 *   ...
 *
 * The plugin is the single source for both Skill content and MCP runtime.
 * Session startup links its canonical Skill directory into the selected
 * harness's native project discovery directory. MCP remains a separate tool
 * transport and never acts as a Skill reader.
 */

import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const ASSETS = join(root, "assets");
const DIST = join(root, "dist", "agents");
const REPO_ROOT = join(root, "..", "..");
const CLASH_PLUGIN_ROOT =
  process.env.CLASH_BUILTIN_PLUGIN_ROOT || join(REPO_ROOT, "plugins", "clash");

const LABELS = {
  "master-clash": {
    label: "Master Clash",
    summary: "Operates the Clash project through its native Skill and bundled MCP tools.",
  },
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
    // every agent template. Putting them in the shared SKILL is unreliable
    // because Claude
    // Code only loads skills on demand, but AGENTS.md is always read at
    // session start. Keep role-specific guidance in
    // assets/agents/<role>/AGENTS.md; cross-cutting rules go in the
    // prelude so a fix lands for every agent at once.
    const prelude = await readFile(join(ASSETS, "shared-cwd", "AGENTS-prelude.md"), "utf-8");
    const roleBody = await readFile(join(src, "AGENTS.md"), "utf-8");
    const nativeContract = prelude.trimEnd() + "\n\n" + roleBody;
    await Promise.all([
      writeFile(join(dstTpl, "AGENTS.md"), nativeContract),
      writeFile(join(dstTpl, "CLAUDE.md"), nativeContract),
      writeFile(join(dstTpl, "GEMINI.md"), nativeContract),
    ]);
    await cp(join(src, "runtime.json"), join(dst, "runtime.json"));
    const runtime = JSON.parse(await readFile(join(dst, "runtime.json"), "utf-8"));
    for (const pluginId of runtime.plugins ?? []) {
      if (pluginId !== "clash") {
        throw new Error(`unknown built-in agent plugin: ${pluginId}`);
      }
      const pluginDst = join(dst, "plugins", pluginId);
      const pluginRuntimeSrc = join(CLASH_PLUGIN_ROOT, "runtime");
      const nestedAgentsDir = join(pluginRuntimeSrc, "agents");
      await Promise.all([
        cp(join(CLASH_PLUGIN_ROOT, ".codex-plugin"), join(pluginDst, ".codex-plugin"), { recursive: true }),
        cp(join(CLASH_PLUGIN_ROOT, ".mcp.json"), join(pluginDst, ".mcp.json")),
        cp(join(CLASH_PLUGIN_ROOT, "skills"), join(pluginDst, "skills"), { recursive: true }),
        cp(pluginRuntimeSrc, join(pluginDst, "runtime"), {
          recursive: true,
          filter: (source) =>
            source !== nestedAgentsDir
            && !source.startsWith(`${nestedAgentsDir}${sep}`),
        }),
      ]);
    }
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
