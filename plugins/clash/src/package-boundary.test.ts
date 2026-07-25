import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("plugin manifest starts one bundled MCP runtime and keeps product state in the shared local host", async () => {
  const manifest = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
  const mcp = JSON.parse(await readFile(new URL("../.mcp.json", import.meta.url), "utf8"));

  assert.equal(manifest.name, "clash");
  assert.equal(manifest.mcpServers, "./.mcp.json");
  assert.deepEqual(mcp.mcpServers.clash, {
    command: "node",
    args: ["./runtime/index.js"],
    cwd: ".",
  });
});
