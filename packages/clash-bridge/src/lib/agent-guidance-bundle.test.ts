import { access, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../..", import.meta.url));

let bundleRoot = "";
let bundledGuidance = "";
let isolatedPackage = "";

async function writeFakeClashPlugin(root: string): Promise<void> {
  await Promise.all([
    mkdir(join(root, ".codex-plugin"), { recursive: true }),
    mkdir(join(root, "skills", "clash"), { recursive: true }),
    mkdir(join(root, "runtime", "agents"), { recursive: true }),
  ]);
  await writeFile(join(root, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "clash",
    skills: "./skills/",
    mcpServers: "./.mcp.json",
  }));
  await writeFile(join(root, ".mcp.json"), JSON.stringify({
    mcpServers: {
      clash: {
        command: "node",
        args: ["./runtime/index.js"],
        cwd: ".",
      },
    },
  }));
  await writeFile(join(root, "skills", "clash", "SKILL.md"), [
    "---",
    "name: clash",
    "description: Test Clash product skill.",
    "---",
    "",
    "# Clash product skill",
    "",
    "clash timeline list --json",
    "clash timeline pull --timeline <id> --file timelines/<id>.timeline.yaml --json",
    "clash timeline apply --timeline <id> --file timelines/<id>.timeline.yaml --json",
    "data.timelineId",
  ].join("\n"));
  await writeFile(join(root, "runtime", "index.js"), "process.stdin.resume();\n");
  await writeFile(join(root, "runtime", "agents", "manifest.json"), "{}");
}

async function readMarkdownTree(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const contents = await Promise.all(entries.map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return readMarkdownTree(path);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return [await readFile(path, "utf8")];
  }));
  return contents.flat();
}

beforeAll(async () => {
  bundleRoot = await mkdtemp(join(tmpdir(), "clash-agent-guidance-"));
  isolatedPackage = join(bundleRoot, "clash-bridge");
  const pluginRoot = join(bundleRoot, "clash-plugin");
  await cp(join(packageRoot, "assets"), join(isolatedPackage, "assets"), { recursive: true });
  await cp(
    join(packageRoot, "scripts", "bundle-agents.mjs"),
    join(isolatedPackage, "scripts", "bundle-agents.mjs"),
  );
  await writeFakeClashPlugin(pluginRoot);
  await execFileAsync(process.execPath, [join(isolatedPackage, "scripts", "bundle-agents.mjs")], {
    env: {
      ...process.env,
      CLASH_BUILTIN_PLUGIN_ROOT: pluginRoot,
    },
  });
  bundledGuidance = (await readMarkdownTree(join(isolatedPackage, "dist", "agents"))).join("\n");
});

afterAll(async () => {
  if (bundleRoot) await rm(bundleRoot, { recursive: true, force: true });
});

it("bundles public Project Timeline guidance and rejects removed command spellings", () => {
  expect(bundledGuidance).toContain("clash timeline list --json");
  expect(bundledGuidance).toMatch(/clash timeline pull --timeline <[^>]+>/);
  expect(bundledGuidance).toMatch(/clash timeline apply --timeline <[^>]+>/);
  expect(bundledGuidance).toContain("timelines/<id>.timeline.yaml");
  expect(bundledGuidance).toContain("data.timelineId");

  expect(bundledGuidance).not.toMatch(/clash\s+canvas\s+timeline\s+(?:pull|push)\b/i);
  expect(bundledGuidance).not.toMatch(/clash\s+timeline\s+(?:history|content|restore)\b/i);
});

it("bundles one canonical Clash plugin skill and MCP runtime for built-in agents", async () => {
  const agentRoot = join(isolatedPackage, "dist", "agents", "master-clash");
  const [agentsContract, claudeContract, geminiContract, pluginSkill, pluginManifest, pluginMcp, runtime] = await Promise.all([
    readFile(join(agentRoot, "template", "AGENTS.md"), "utf8"),
    readFile(join(agentRoot, "template", "CLAUDE.md"), "utf8"),
    readFile(join(agentRoot, "template", "GEMINI.md"), "utf8"),
    readFile(join(agentRoot, "plugins", "clash", "skills", "clash", "SKILL.md"), "utf8"),
    readFile(join(agentRoot, "plugins", "clash", ".codex-plugin", "plugin.json"), "utf8"),
    readFile(join(agentRoot, "plugins", "clash", ".mcp.json"), "utf8"),
    readFile(join(agentRoot, "runtime.json"), "utf8"),
  ]);

  expect(claudeContract).toBe(agentsContract);
  expect(geminiContract).toBe(agentsContract);
  expect(pluginSkill).toContain("# Clash product skill");
  await expect(access(join(agentRoot, "template", ".agents", "skills", "clash", "SKILL.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(access(join(agentRoot, "template", ".claude", "skills", "clash", "SKILL.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect(pluginManifest).toContain('"name":"clash"');
  expect(pluginMcp).toContain('"./runtime/index.js"');
  expect(JSON.parse(runtime)).toMatchObject({
    agent_id: "codex-acp",
    plugins: ["clash"],
  });
  await expect(
    access(join(agentRoot, "plugins", "clash", "runtime", "agents")),
  ).rejects.toMatchObject({ code: "ENOENT" });
});

it("runtime-only cleanup preserves the already bundled agents", async () => {
  const cleanupRoot = await mkdtemp(join(tmpdir(), "clash-bridge-runtime-clean-"));
  const cleanupScript = join(packageRoot, "scripts", "clean-runtime.mjs");

  try {
    await mkdir(join(cleanupRoot, "agents", "master-clash"), { recursive: true });
    await writeFile(join(cleanupRoot, "agents", "manifest.json"), "{}");
    await writeFile(join(cleanupRoot, "agents", "master-clash", "runtime.json"), "{}");
    await writeFile(join(cleanupRoot, "stale-runtime.js"), "stale");
    await mkdir(join(cleanupRoot, "stale-chunks"), { recursive: true });
    await writeFile(join(cleanupRoot, "stale-chunks", "old.js"), "stale");

    await execFileAsync(process.execPath, [cleanupScript], {
      env: {
        ...process.env,
        CLASH_BRIDGE_DIST_DIR: cleanupRoot,
      },
    });

    await expect(access(join(cleanupRoot, "agents", "manifest.json"))).resolves.toBeUndefined();
    await expect(
      access(join(cleanupRoot, "agents", "master-clash", "runtime.json")),
    ).resolves.toBeUndefined();
    await expect(access(join(cleanupRoot, "stale-runtime.js"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(access(join(cleanupRoot, "stale-chunks"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    await rm(cleanupRoot, { recursive: true, force: true });
  }
});
