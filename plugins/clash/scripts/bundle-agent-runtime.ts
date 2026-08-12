import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const pluginRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pluginRoot, "../..");
const sourceAgentsDir = resolve(repoRoot, "packages", "cli", "assets", "agents");
const targetAgentsDir = resolve(pluginRoot, "runtime", "agents");

const labels: Record<string, { label: string; summary: string }> = {
  clash: {
    label: "Clash",
    summary: "Operates the Clash project through its native Skill and bundled MCP tools.",
  },
};

await rm(targetAgentsDir, { recursive: true, force: true });
await mkdir(targetAgentsDir, { recursive: true });

const ids = (await readdir(sourceAgentsDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name);
const agents: Array<{ id: string; label: string; summary: string; agent_id: string }> = [];

for (const id of ids) {
  const source = resolve(sourceAgentsDir, id, "runtime.json");
  const targetDir = resolve(targetAgentsDir, id);
  await mkdir(targetDir, { recursive: true });
  await cp(source, resolve(targetDir, "runtime.json"));
  const runtime = JSON.parse(await readFile(source, "utf8")) as { agent_id: string };
  const metadata = labels[id] ?? { label: id, summary: "" };
  agents.push({ id, ...metadata, agent_id: runtime.agent_id });
}

await writeFile(
  resolve(targetAgentsDir, "manifest.json"),
  `${JSON.stringify({ agents }, null, 2)}\n`,
  "utf8",
);
