import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");

test("ships as one installable Director Codex plugin", () => {
  const manifest = JSON.parse(readFileSync(join(root, ".codex-plugin", "plugin.json"), "utf8"));
  const mcp = JSON.parse(readFileSync(join(root, ".mcp.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(manifest.name, "clash-director");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(manifest.interface.capabilities, ["Read", "Write"]);
  assert.equal(manifest.interface.defaultPrompt.some((prompt: string) => /\bopen\b/i.test(prompt)), false);
  assert.equal(mcp.mcpServers["clash-director"].args[0], "./runtime/index.js");
  assert.deepEqual(mcp.mcpServers["clash-director"].env, { CLASH_PROFILE: "prod" });
  assert.equal(pkg.name, "@clash/director-plugin");
  assert.ok(pkg.files.includes("runtime"));
});
