import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function waitUntil(check: () => Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  assert.fail("timed out waiting for plugin runtime cleanup");
}

test("built plugin runtime self-hosts profile-bound local-api without MCP Apps", async () => {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const clashHome = await mkdtemp(join(tmpdir(), "clash-plugin-runtime-"));
  const client = new Client({ name: "clash-runtime-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: "node",
    args: ["runtime/index.js"],
    cwd: pluginRoot,
    stderr: "pipe",
    env: {
      ...process.env,
      CLASH_HOME: clashHome,
      CLASH_PROFILE: "prod",
      CLASH_LOCAL_DATA_DIR: join(clashHome, "local-api"),
    },
  });

  try {
    await client.connect(transport);
    const tools = await client.listTools();
    for (const name of [
      "clash_studio_open",
      "clash_canvas_open",
      "clash_canvas_snapshot",
      "clash_timeline_open",
      "clash_director_open",
    ]) assert.equal(tools.tools.some((tool) => tool.name === name), false);
    await assert.rejects(
      client.listResources(),
      (error: unknown) => (error as { code?: number }).code === -32601,
    );

    const result = await client.callTool({
      name: "clash_cli_host",
      arguments: { args: ["status", "--json"] },
    });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    const record = JSON.parse(await readFile(join(clashHome, "run", "host.json"), "utf8"));
    assert.equal(record.launchMode, "plugin");
    assert.equal(record.startedBy, "plugin");
    assert.equal(record.profile, "prod");
    assert.match(record.agentCliPath, /agent-bin\/clash$/);

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    const stableRecord = JSON.parse(await readFile(join(clashHome, "run", "host.json"), "utf8"));
    assert.equal(stableRecord.hostId, record.hostId, "plugin discovery must not be overwritten by a second bundled server");
    assert.equal(stableRecord.launchMode, "plugin");
    assert.equal(stableRecord.startedBy, "plugin");
  } finally {
    await client.close().catch(() => undefined);
  }

  await waitUntil(async () => {
    try {
      await readFile(join(clashHome, "run", "host.json"), "utf8");
      return false;
    } catch (error) {
      return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
    }
  });
  await rm(clashHome, { recursive: true, force: true });
});
