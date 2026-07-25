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

test("host runner executes the CLI shim published by the active local host", async () => {
  const module = await loadRunnerModule();
  assert.equal(typeof module.createHostCliRunner, "function");

  const root = await mkdtemp(join(tmpdir(), "clash-plugin-host-"));
  const runDir = join(root, "run");
  const workspace = join(root, "workspace");
  const cliPath = join(root, "clash-host-cli");
  await mkdir(runDir, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await writeFile(cliPath, [
    "#!/usr/bin/env node",
    "console.log(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }));",
    "",
  ].join("\n"), "utf8");
  await chmod(cliPath, 0o755);
  await writeFile(join(runDir, "host.json"), JSON.stringify({
    schemaVersion: 1,
    protocolVersion: 1,
    dataSchemaVersion: 1,
    hostId: "host-test",
    endpoint: "http://127.0.0.1:49321",
    pid: process.pid,
    launchMode: "desktop",
    startedBy: "desktop",
    agentCliPath: cliPath,
    startedAt: "2026-07-16T00:00:00.000Z",
    updatedAt: "2026-07-16T00:00:00.000Z"
  }), "utf8");

  const runner = (module.createHostCliRunner as (options: { runDir: string }) => (
    args: string[], cwd?: string
  ) => Promise<unknown>)({ runDir });
  assert.deepEqual(await runner(["projects", "list", "--json"], workspace), {
    args: ["projects", "list", "--json"],
    cwd: await realpath(workspace),
  });
});

test("host runner asks its host manager to bootstrap Clash when no Desktop host exists", async () => {
  const module = await loadRunnerModule();
  assert.equal(typeof module.createHostCliRunner, "function");
  const root = await mkdtemp(join(tmpdir(), "clash-plugin-bootstrap-"));
  const cliPath = join(root, "clash-plugin-cli");
  await writeFile(cliPath, [
    "#!/usr/bin/env node",
    "console.log(JSON.stringify({ source: 'plugin-host', args: process.argv.slice(2) }));",
    "",
  ].join("\n"), "utf8");
  await chmod(cliPath, 0o755);
  let ensures = 0;
  const runner = (module.createHostCliRunner as (options: Record<string, unknown>) => (
    args: string[], cwd?: string
  ) => Promise<unknown>)({
    hostManager: {
      ensureHost: async () => {
        ensures += 1;
        return {
          schemaVersion: 1,
          protocolVersion: 1,
          dataSchemaVersion: 1,
          hostId: "plugin-host",
          endpoint: "http://127.0.0.1:49322",
          pid: process.pid,
          launchMode: "plugin",
          startedBy: "plugin",
          agentCliPath: cliPath,
          ownerClientId: "plugin-1",
          startedAt: "2026-07-16T00:00:00.000Z",
          updatedAt: "2026-07-16T00:00:00.000Z",
        };
      },
    },
  });

  assert.deepEqual(await runner(["host", "status", "--json"]), {
    source: "plugin-host",
    args: ["host", "status", "--json"],
  });
  assert.equal(ensures, 1);
});
