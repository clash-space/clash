import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runBenchmarkSuite } from "./runner";

describe("benchmark Project Host gate", () => {
  it("classifies Host setup failure as infrastructure and never launches Codex", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-host-gate-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const pluginRoot = join(root, "plugin");
    const runtimeRoot = join(pluginRoot, "runtime");
    const agentStartedPath = join(root, "agent-started");
    const fakeCodex = join(root, "fake-codex");
    await Promise.all([
      mkdir(suiteRoot),
      mkdir(runtimeRoot, { recursive: true }),
    ]);
    await writeFile(
      join(runtimeRoot, "index.js"),
      "// fake MCP runtime\n",
      "utf8",
    );
    await writeFile(
      join(runtimeRoot, "local-api.cjs"),
      [
        'const fs = require("node:fs")',
        'const http = require("node:http")',
        'const net = require("node:net")',
        'const path = require("node:path")',
        "const runDir = process.env.CLASH_HOST_RUN_DIR",
        'const discovery = path.join(runDir, "host.json")',
        'const pluginSocket = process.env.CLASH_PLUGIN_HOST_SOCKET || path.join(process.env.CLASH_HOME, "sockets", "plugin-host.sock")',
        "fs.mkdirSync(path.dirname(pluginSocket), {recursive:true})",
        "fs.mkdirSync(runDir, {recursive:true})",
        "fs.rmSync(pluginSocket, {force:true})",
        "const ipc = net.createServer((socket) => socket.end())",
        "ipc.listen(pluginSocket)",
        'const server = http.createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end("{}") })',
        'server.listen(0, "127.0.0.1", () => { const port = server.address().port; fs.writeFileSync(discovery, JSON.stringify({endpoint:"http://127.0.0.1:" + port,pid:process.pid,profile:process.env.CLASH_PROFILE,launchMode:"user-service",startedBy:"plugin",agentCliPath:process.env.CLASH_CLI_ENTRY_PATH})) })',
        'process.on("SIGTERM", () => { server.close(); ipc.close(); fs.rmSync(discovery, {force:true}); fs.rmSync(pluginSocket, {force:true}); process.exit(0) })',
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      join(runtimeRoot, "clash-cli.cjs"),
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        "const argv = process.argv.slice(2)",
        'if (argv[0] === "init") { const projectId = argv[argv.indexOf("--project") + 1]; const markerPath = path.join(process.cwd(), ".clash", "project.toml"); fs.mkdirSync(path.dirname(markerPath), {recursive:true}); fs.writeFileSync(markerPath, "schema_version = 1\\nproject_id = " + JSON.stringify(projectId) + "\\nworkspace_id = \\"managed:gate\\"\\nstore = \\"managed\\"\\n"); process.stdout.write(JSON.stringify({projectId,markerPath,workspaceId:"managed:gate",reused:false}) + "\\n"); process.exit(0) }',
        "process.exit(2)",
      ].join("\n"),
      "utf8",
    );
    await chmod(join(runtimeRoot, "clash-cli.cjs"), 0o755);
    await writeFile(
      fakeCodex,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        `fs.writeFileSync(${JSON.stringify(agentStartedPath)}, "started")`,
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeCodex, 0o755);

    const report = await runBenchmarkSuite({
      suite: {
        schemaVersion: 1,
        id: "host-gate-suite",
        title: "Host gate suite",
        cases: [
          {
            id: "host-gate",
            title: "Host gate",
            category: "timeline",
            outcome: {
              objective: "Create a product-backed report.",
              acceptanceCriteria: ["The report is persisted."],
              deliverables: [
                {
                  artifactId: "report",
                  kind: "report",
                  description: "Product report",
                },
              ],
            },
            passScore: 100,
            timeoutMs: 10_000,
            skills: [],
            execution: {
              profile: "clash-host",
              requiredMcpTools: ["clash"],
            },
            rubric: [
              {
                id: "report",
                type: "artifact-exists",
                artifactId: "report",
                weight: 1,
                required: true,
              },
            ],
          },
        ],
      },
      suiteRoot,
      outputRoot,
      runId: "host-gate-run",
      maxInfrastructureAttempts: 1,
      agent: {
        adapter: "codex",
        command: fakeCodex,
        clashHost: { pluginRoot, profile: "dev" },
      },
    });

    expect(report.cases[0]).toMatchObject({
      status: "fail",
      agent: { status: "not-run" },
      failure: {
        classification: "infrastructure",
        phase: "project-host-setup",
      },
    });
    expect(report.cases[0]?.failure?.detail).toMatch(
      /Project Host did not answer ping/i,
    );
    await expect(lstat(agentStartedPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
    const caseRoot = join(outputRoot, "host-gate-run", "host-gate");
    expect(
      JSON.parse(
        await readFile(join(caseRoot, "clash-project-host.json"), "utf8"),
      ),
    ).toMatchObject({ status: "failed", initDisposition: "created" });
  });
});
