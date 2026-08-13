import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);

async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50));
  }
  assert.fail("timed out waiting for plugin runtime cleanup");
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function isHealthy(endpoint: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", endpoint));
    const body = (await response.json()) as { ok?: unknown; mode?: unknown };
    return response.ok && body.ok === true && body.mode === "local";
  } catch {
    return false;
  }
}

test("bundled CLI and peer plugin MCP share one persistent Clash daemon", async () => {
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const clashHome = await mkdtemp(join(tmpdir(), "clash-plugin-runtime-"));
  const workspace = await mkdtemp(join(tmpdir(), "clash-plugin-workspace-"));
  assert.equal(relative(clashHome, workspace).startsWith(".."), true);
  const env = {
    ...process.env,
    CLASH_HOME: clashHome,
    CLASH_PROFILE: "prod",
    CLASH_LOCAL_DATA_DIR: join(clashHome, "local-api"),
  };
  let daemonPid: number | undefined;

  try {
    const firstCli = await execFileAsync(
      process.execPath,
      ["runtime/dispatcher.js", "projects", "list", "--json"],
      { cwd: pluginRoot, env, timeout: 20_000 },
    );
    assert.doesNotThrow(() => JSON.parse(firstCli.stdout));
    const firstRecord = JSON.parse(
      await readFile(join(clashHome, "run", "host.json"), "utf8"),
    );
    daemonPid = firstRecord.pid;
    assert.equal(firstRecord.launchMode, "user-service");
    assert.equal(firstRecord.startedBy, "cli");
    assert.equal(firstRecord.profile, "prod");
    assert.equal(processExists(firstRecord.pid), true);
    assert.equal(await isHealthy(firstRecord.endpoint), true);

    const client = new Client({ name: "clash-runtime-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: "node",
      args: ["runtime/dispatcher.js", "mcp"],
      cwd: pluginRoot,
      stderr: "pipe",
      env,
    });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
        "clash",
        "clash_assets",
        "clash_canvas",
        "clash_composition",
        "clash_workspace_init",
      ]);
      for (const name of [
        "clash_studio_open",
        "clash_canvas_open",
        "clash_canvas_snapshot",
        "clash_timeline_open",
        "clash_director_open",
      ])
        assert.equal(
          tools.tools.some((tool) => tool.name === name),
          false,
        );
      assert.equal(
        tools.tools.some((tool) => tool.name === "clash"),
        true,
      );
      assert.equal(
        tools.tools.some((tool) => tool.name === "clash_workspace_init"),
        true,
      );
      assert.equal(
        tools.tools.some((tool) => tool.name.startsWith("clash_cli_")),
        false,
      );
      await assert.rejects(
        client.listResources(),
        (error: unknown) => (error as { code?: number }).code === -32601,
      );

      const initialized = await client.callTool({
        name: "clash_workspace_init",
        arguments: { cwd: workspace, projectId: "native-init-smoke" },
      });
      assert.notEqual(initialized.isError, true, JSON.stringify(initialized));
      assert.match(
        await readFile(join(workspace, ".clash", "project.toml"), "utf8"),
        /project_id = "native-init-smoke"/,
      );

      const selected = await client.callTool({
        name: "clash",
        arguments: { command: "canvas" },
      });
      assert.notEqual(selected.isError, true, JSON.stringify(selected));
      const listed = await client.callTool({
        name: "clash_canvas",
        arguments: {
          operation: "list",
          arguments: { cwd: workspace },
        },
      });
      assert.notEqual(listed.isError, true, JSON.stringify(listed));
      const timelineContracts = await client.callTool({
        name: "clash_composition",
        arguments: { kind: "timeline" },
      });
      assert.notEqual(
        timelineContracts.isError,
        true,
        JSON.stringify(timelineContracts),
      );
      const record = JSON.parse(
        await readFile(join(clashHome, "run", "host.json"), "utf8"),
      );
      assert.equal(record.hostId, firstRecord.hostId);
      assert.equal(record.pid, firstRecord.pid);
      assert.equal(record.launchMode, "user-service");
      assert.equal(record.startedBy, "cli");
      assert.equal(record.profile, "prod");
      assert.match(record.agentCliPath, /agent-bin\/clash$/);

      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      const stableRecord = JSON.parse(
        await readFile(join(clashHome, "run", "host.json"), "utf8"),
      );
      assert.equal(
        stableRecord.hostId,
        record.hostId,
        "plugin discovery must not be overwritten by a second bundled server",
      );
      assert.equal(stableRecord.launchMode, "user-service");
      assert.equal(stableRecord.startedBy, "cli");
    } finally {
      await client.close().catch(() => undefined);
    }

    const afterMcp = JSON.parse(
      await readFile(join(clashHome, "run", "host.json"), "utf8"),
    );
    assert.equal(afterMcp.hostId, firstRecord.hostId);
    assert.equal(afterMcp.pid, firstRecord.pid);
    assert.equal(processExists(afterMcp.pid), true);
    assert.equal(await isHealthy(afterMcp.endpoint), true);

    await execFileAsync(
      process.execPath,
      ["runtime/dispatcher.js", "host", "status", "--json"],
      { cwd: pluginRoot, env, timeout: 20_000 },
    );
    const afterSecondCli = JSON.parse(
      await readFile(join(clashHome, "run", "host.json"), "utf8"),
    );
    assert.equal(afterSecondCli.hostId, firstRecord.hostId);
    assert.equal(afterSecondCli.pid, firstRecord.pid);
  } finally {
    if (daemonPid && processExists(daemonPid))
      process.kill(daemonPid, "SIGTERM");
    await waitUntil(async () => !daemonPid || !processExists(daemonPid));
    await Promise.all([
      rm(clashHome, { recursive: true, force: true }),
      rm(workspace, { recursive: true, force: true }),
    ]);
  }
});
