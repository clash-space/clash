import { access, cp, mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";

const pluginRoot = resolve(import.meta.dirname, "..");
const repoRoot = resolve(pluginRoot, "../..");
const sourceAgentsDir = resolve(
  repoRoot,
  "packages",
  "clash-bridge",
  "dist",
  "agents",
);
const targetAgentsDir = resolve(pluginRoot, "runtime", "agents");
const recursivePluginDir = resolve(sourceAgentsDir, "master-clash", "plugins");

await access(resolve(sourceAgentsDir, "manifest.json"));
await rm(targetAgentsDir, { recursive: true, force: true });
await mkdir(resolve(pluginRoot, "runtime"), { recursive: true });
await cp(sourceAgentsDir, targetAgentsDir, {
  recursive: true,
  filter: (source) =>
    source !== recursivePluginDir
    && !source.startsWith(`${recursivePluginDir}${sep}`),
});
