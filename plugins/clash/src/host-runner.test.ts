import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadRunnerModule(): Promise<Record<string, unknown>> {
  try {
    return await import("./host-runner.js") as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function makeCli(root: string): Promise<string> {
  const cliPath = join(root, "clash-client-cli");
  await writeFile(cliPath, [
    "#!/usr/bin/env node",
    "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), apiUrl: process.env.CLASH_API_URL, traceOrigin: process.env.CLASH_CLI_TRACE_ORIGIN }));",
    "",
  ].join("\n"), "utf8");
  await chmod(cliPath, 0o755);
  return cliPath;
}

function host(endpoint = "http://127.0.0.1:49321") {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    dataSchemaVersion: 1,
    hostId: "daemon-test",
    endpoint,
    pid: process.pid,
    launchMode: "user-service",
    startedBy: "plugin",
    profile: "prod",
    agentCliPath: "/tmp/daemon-published-old-cli",
    startedAt: "2026-08-07T00:00:00.000Z",
    updatedAt: "2026-08-07T00:00:00.000Z",
  };
}

test("host runner executes its bundled CLI against the ensured daemon endpoint", async () => {
  const module = await loadRunnerModule();
  const root = await mkdtemp(join(tmpdir(), "clash-runner-bundled-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const command = await makeCli(root);
  let ensures = 0;
  const runner = (module.createHostCliRunner as (options: Record<string, unknown>) => (
    args: string[], cwd?: string
  ) => Promise<unknown>)({
    command,
    hostManager: {
      ensureHost: async () => {
        ensures += 1;
        return host();
      },
    },
  });

  assert.deepEqual(await runner(["projects", "list", "--json"], workspace), {
    args: ["projects", "list", "--json"],
    cwd: await realpath(workspace),
    apiUrl: "http://127.0.0.1:49321",
    traceOrigin: "mcp-transport",
  });
  assert.equal(ensures, 1);
});

test("an explicit API URL bypasses local daemon startup", async () => {
  const module = await loadRunnerModule();
  const root = await mkdtemp(join(tmpdir(), "clash-runner-explicit-"));
  const command = await makeCli(root);
  let ensures = 0;
  const runner = (module.createHostCliRunner as (options: Record<string, unknown>) => (
    args: string[], cwd?: string
  ) => Promise<unknown>)({
    command,
    env: { ...process.env, CLASH_API_URL: "https://clash.example.test" },
    hostManager: {
      ensureHost: async () => {
        ensures += 1;
        return host();
      },
    },
  });

  assert.deepEqual(await runner(["projects", "list", "--json"]), {
    args: ["projects", "list", "--json"],
    cwd: process.cwd(),
    apiUrl: "https://clash.example.test",
    traceOrigin: "mcp-transport",
  });
  assert.equal(ensures, 0);
});

test("runner-provided CLI entry is the MCP peer executable", async () => {
  const module = await loadRunnerModule();
  const root = await mkdtemp(join(tmpdir(), "clash-runner-agent-cli-"));
  const command = await makeCli(root);
  const runner = (module.createHostCliRunner as (options: Record<string, unknown>) => (
    args: string[], cwd?: string
  ) => Promise<unknown>)({
    env: {
      ...process.env,
      CLASH_API_URL: "http://127.0.0.1:49321",
      CLASH_CLI_ENTRY_PATH: command,
    },
  });

  assert.deepEqual(await runner(["timeline", "list", "--json"]), {
    args: ["timeline", "list", "--json"],
    cwd: process.cwd(),
    apiUrl: "http://127.0.0.1:49321",
    traceOrigin: "mcp-transport",
  });
});

test("a non-executable bundled CLI is launched through Node", async () => {
  const module = await loadRunnerModule();
  const root = await mkdtemp(join(tmpdir(), "clash-runner-node-cli-"));
  const bundledCliPath = join(root, "clash-cli.cjs");
  await writeFile(bundledCliPath, [
    "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), apiUrl: process.env.CLASH_API_URL, traceOrigin: process.env.CLASH_CLI_TRACE_ORIGIN }));",
    "",
  ].join("\n"), "utf8");
  const runner = (module.createHostCliRunner as (options: Record<string, unknown>) => (
    args: string[], cwd?: string
  ) => Promise<unknown>)({
    bundledCliPath,
    env: { ...process.env, CLASH_API_URL: "http://127.0.0.1:49321" },
  });

  assert.deepEqual(await runner(["canvas", "list", "--json"]), {
    args: ["canvas", "list", "--json"],
    cwd: process.cwd(),
    apiUrl: "http://127.0.0.1:49321",
    traceOrigin: "mcp-transport",
  });
});

test("host runner defaults every product tool to the ACP session workspace", async () => {
  const module = await loadRunnerModule();
  const root = await mkdtemp(join(tmpdir(), "clash-plugin-workspace-"));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, ".clash"), { recursive: true });
  await writeFile(join(workspace, ".clash", "project.toml"), [
    "schema_version = 1",
    'project_id = "project-workspace"',
    "",
  ].join("\n"));
  const command = await makeCli(root);
  const runner = (module.createHostCliRunner as (options: Record<string, unknown>) => (
    args: string[], cwd?: string
  ) => Promise<unknown>)({
    command,
    env: {
      ...process.env,
      CLASH_WORKSPACE_ROOT: workspace,
      CLASH_PROJECT_ID: "project-workspace",
    },
    hostManager: { ensureHost: async () => host() },
  });

  assert.deepEqual(await runner(["canvas", "list", "--json"]), {
    args: ["canvas", "list", "--json"],
    cwd: await realpath(workspace),
    apiUrl: "http://127.0.0.1:49321",
    traceOrigin: "mcp-transport",
  });
});
