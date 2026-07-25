import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const pluginRoot = join(import.meta.dirname, "..");
const repoRoot = join(pluginRoot, "..", "..");

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

test("ships as one installable Codex plugin package", () => {
  const manifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
  const mcp = JSON.parse(readFileSync(join(pluginRoot, ".mcp.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8"));

  assert.equal(manifest.name, "clash-timeline");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.equal(manifest.skills, "./skills/");
  assert.deepEqual(manifest.interface.capabilities, ["Interactive", "Write"]);
  assert.deepEqual(mcp, {
    mcpServers: {
      "clash-timeline": {
        command: "node",
        args: ["./runtime/index.js"],
        cwd: ".",
      },
    },
  });
  assert.equal(pkg.name, "@clash-space/timeline-plugin");
  assert.ok(pkg.files.includes("runtime"));
});

test("keeps plugin source inside the package and does not import Canvas MCP internals", () => {
  const source = filesUnder(join(pluginRoot, "src"))
    .filter((path) => path.endsWith(".ts") && !path.endsWith(".test.ts"))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /packages\/mcp-server|canvas-app|clash_canvas_/);
  assert.doesNotMatch(source, /from\s+["']\.\.\/\.\.\//);
});

test("Canvas App does not embed Timeline while the shared plugin keeps a headless Timeline CLI", () => {
  const canvasHtml = readFileSync(join(repoRoot, "packages", "mcp-server", "src", "canvas-app.ts"), "utf8");
  const canvasClient = readFileSync(join(repoRoot, "packages", "mcp-server", "src", "canvas-app-client.ts"), "utf8");
  const cliContract = readFileSync(join(repoRoot, "packages", "mcp-server", "src", "cli-contract.ts"), "utf8");

  assert.doesNotMatch(canvasHtml, /data-surface="timeline"|data-timeline-list/);
  assert.doesNotMatch(canvasClient, /clash_cli_timeline|refreshTimelines|renderTimelines/);
  assert.match(cliContract, /^\s*["']timeline["'],?$/m);
});
