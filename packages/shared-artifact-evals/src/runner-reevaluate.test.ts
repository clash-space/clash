import { createHash } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DirectorStageStateSchema,
  projectDirectorStageReadToken,
} from "@clash/shared-types";

import * as runner from "./runner";
import type {
  ArtifactBenchmarkCase,
  ArtifactBenchmarkSuite,
  BenchmarkAgent,
  BenchmarkCaseReport,
} from "./types";

function benchmarkCase(): ArtifactBenchmarkCase {
  return {
    id: "reevaluate-case",
    title: "Reevaluate case",
    category: "timeline",
    outcome: {
      objective: "Produce one persisted report.",
      acceptanceCriteria: ["The report is present."],
      deliverables: [
        {
          artifactId: "result",
          kind: "report",
          description: "Persisted report",
        },
      ],
    },
    passScore: 100,
    timeoutMs: 10_000,
    skills: [],
    rubric: [
      {
        id: "result-exists",
        type: "artifact-exists",
        artifactId: "result",
        kind: "report",
        weight: 1,
        required: true,
      },
    ],
  };
}

function suite(): ArtifactBenchmarkSuite {
  return {
    schemaVersion: 1,
    id: "reevaluate-suite",
    title: "Reevaluate suite",
    cases: [benchmarkCase()],
  };
}

function agent(counterPath: string): BenchmarkAgent {
  return {
    command: process.execPath,
    args: [
      "-e",
      [
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        "const workspace = process.env.CLASH_BENCH_WORKSPACE",
        "const counterPath = process.env.COUNTER_PATH",
        'const count = Number(fs.existsSync(counterPath) ? fs.readFileSync(counterPath, "utf8") : "0")',
        "fs.writeFileSync(counterPath, String(count + 1))",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "artifact")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"reevaluate-case",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ].join(";"),
    ],
    env: { COUNTER_PATH: counterPath },
  };
}

async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

const directorStage = DirectorStageStateSchema.parse({
  schemaVersion: 1,
  scene: {
    backgroundColor: "#111111",
    grid: { visible: true, snap: false, size: 1 },
  },
  objects: [
    {
      id: "hero",
      name: "Hero",
      kind: "mannequin",
      visible: true,
      transform: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
      mannequin: {
        bodyType: "neutral",
        pose: { preset: "standing", joints: {} },
      },
    },
  ],
  cameras: [
    {
      id: "camera-a",
      name: "Camera A",
      position: [0, 1.6, 5],
      rotation: [0, 0, 0],
      fov: 50,
    },
  ],
  shots: [],
  activeCameraId: "camera-a",
  animation: { durationSeconds: 3, fps: 30, tracks: [] },
});

async function createFakeClashRuntime(root: string): Promise<{
  pluginRoot: string;
  fakeCodex: string;
  agentCounterPath: string;
}> {
  const pluginRoot = join(root, "clash-plugin");
  const runtimeRoot = join(pluginRoot, "runtime");
  const fakeCodex = join(root, "fake-codex");
  const agentCounterPath = join(root, "host-agent-count.txt");
  const productStage = {
    id: "reevaluate-stage",
    name: "Reevaluate Stage",
    owner: { kind: "project" as const },
    revisionId: "reevaluate-stage-revision-v1",
    state: directorStage,
  };
  const receipt = `${projectDirectorStageReadToken(productStage)}:receipt:test-host`;
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(join(runtimeRoot, "index.js"), "// test runtime\n", "utf8");
  await writeFile(
    join(runtimeRoot, "local-api.cjs"),
    [
      'const fs = require("node:fs")',
      'const http = require("node:http")',
      'const net = require("node:net")',
      'const path = require("node:path")',
      "const runDir = process.env.CLASH_HOST_RUN_DIR",
      'const discovery = path.join(runDir, "host.json")',
      'const starts = path.join(process.env.CLASH_HOME, "host-start-count.txt")',
      "fs.mkdirSync(runDir, {recursive:true})",
      'fs.writeFileSync(starts, String(Number(fs.existsSync(starts) ? fs.readFileSync(starts, "utf8") : "0") + 1))',
      'const pluginSocket = path.join(process.env.CLASH_HOME, "sockets", "plugin-host.sock")',
      "fs.mkdirSync(path.dirname(pluginSocket), {recursive:true})",
      "fs.rmSync(pluginSocket, {force:true})",
      "const ipc = net.createServer((socket) => socket.end())",
      "ipc.listen(pluginSocket)",
      'const server = http.createServer((_request, response) => { response.setHeader("content-type", "application/json"); response.end("{}") })',
      'server.listen(0, "127.0.0.1", () => { const port = server.address().port; fs.writeFileSync(discovery, JSON.stringify({endpoint:"http://127.0.0.1:" + port,pid:process.pid,profile:process.env.CLASH_PROFILE,launchMode:"user-service",startedBy:"plugin",agentCliPath:process.env.CLASH_CLI_ENTRY_PATH})) })',
      'process.on("SIGTERM", () => { server.close(); ipc.close(); fs.rmSync(discovery, {force:true}); fs.rmSync(pluginSocket, {force:true}); process.exit(0) })',
    ].join("\n"),
    "utf8",
  );
  const cliPath = join(runtimeRoot, "clash-cli.cjs");
  await writeFile(
    cliPath,
    [
      `#!${process.execPath}`,
      'const crypto = require("node:crypto")',
      'const fs = require("node:fs")',
      'const http = require("node:http")',
      'const net = require("node:net")',
      'const path = require("node:path")',
      "const argv = process.argv.slice(2)",
      'const command = argv.join(" ")',
      'const marker = path.join(process.cwd(), ".clash", "project.toml")',
      'if (argv[0] === "init") { const requested = argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : undefined; let reused = false; let projectId = requested; if (fs.existsSync(marker)) { const source = fs.readFileSync(marker, "utf8"); projectId = /project_id\\s*=\\s*"([^"]+)"/.exec(source)?.[1]; reused = true } else { fs.mkdirSync(path.dirname(marker), {recursive:true}); fs.writeFileSync(marker, "schema_version = 1\\nproject_id = " + JSON.stringify(projectId) + "\\nworkspace_id = \\"managed:test\\"\\nstore = \\"managed\\"\\n") } process.stdout.write(JSON.stringify({projectId,workspaceId:"managed:test",reused}) + "\\n"); process.exit(0) }',
      'const projectId = /project_id\\s*=\\s*"([^"]+)"/.exec(fs.readFileSync(marker, "utf8"))?.[1]',
      'const socketRoot = path.join(process.env.CLASH_HOME, "sockets")',
      'const key = crypto.createHash("sha256").update(projectId).digest("hex").slice(0, 32)',
      'const pidPath = path.join(socketRoot, key + ".pid")',
      'const mcpPath = path.join(socketRoot, key + ".mcp.json")',
      'const socketPath = path.join(socketRoot, key + ".sock")',
      'if (command === "canvas disconnect") { const pid = Number(fs.readFileSync(pidPath, "utf8")); process.kill(pid, "SIGTERM"); process.exit(0) }',
      'if (command !== "canvas connect") process.exit(2)',
      "fs.mkdirSync(socketRoot, {recursive:true})",
      "fs.rmSync(socketPath, {force:true})",
      `const stage = ${JSON.stringify(productStage)}`,
      `const receipt = ${JSON.stringify(receipt)}`,
      'const server = net.createServer((connection) => { let data = ""; connection.on("data", (chunk) => { data += chunk.toString(); if (!data.includes("\\n")) return; const request = JSON.parse(data.slice(0, data.indexOf("\\n"))); if (request.action === "ping") return connection.end(JSON.stringify({pong:true}) + "\\n"); if (request.action === "list_director_stages") return connection.end(JSON.stringify({stages:[stage],versions:{[stage.id]:receipt}}) + "\\n"); connection.end(JSON.stringify({error:"unsupported"}) + "\\n") }) })',
      'const mcpServer = http.createServer((request, response) => { if (request.url !== "/health") { response.statusCode = 404; return response.end() } response.setHeader("content-type", "application/json"); response.end(JSON.stringify({status:"ok",transport:"streamable-http",endpoint:"/mcp"})) })',
      'mcpServer.listen(0, "127.0.0.1", () => { const port = mcpServer.address().port; server.listen(socketPath, () => { fs.writeFileSync(pidPath, String(process.pid)); fs.writeFileSync(mcpPath, JSON.stringify({url:"http://127.0.0.1:" + port + "/mcp"})) }) })',
      "const cleanup = () => { server.close(); mcpServer.close(); fs.rmSync(pidPath, {force:true}); fs.rmSync(mcpPath, {force:true}); fs.rmSync(socketPath, {force:true}); process.exit(0) }",
      'process.on("SIGTERM", cleanup)',
      "setInterval(() => {}, 1000)",
    ].join("\n"),
    "utf8",
  );
  await chmod(cliPath, 0o755);
  await writeFile(
    fakeCodex,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs")',
      'const path = require("node:path")',
      "const workspace = process.env.CLASH_BENCH_WORKSPACE",
      "const counter = process.env.AGENT_COUNTER_PATH",
      'fs.writeFileSync(counter, String(Number(fs.existsSync(counter) ? fs.readFileSync(counter, "utf8") : "0") + 1))',
      `fs.writeFileSync(path.join(workspace, "stage.json"), ${JSON.stringify(JSON.stringify(directorStage))})`,
      'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"host-reevaluate-case",artifacts:[{id:"stage",kind:"director-stage",path:"stage.json"}]}))',
      'process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"mcp_tool_call",server:"clash",tool:"clash_director_create",arguments:{},status:"completed",error:null}}) + "\\n")',
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeCodex, 0o755);
  return { pluginRoot, fakeCodex, agentCounterPath };
}

describe("benchmark reevaluation", () => {
  it("reevaluates a persisted case without launching the agent or changing its trajectory and workspace", async () => {
    expect(
      typeof (runner as Record<string, unknown>).reevaluateBenchmarkRun,
    ).toBe("function");

    const root = await mkdtemp(join(tmpdir(), "clash-bench-reevaluate-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const counterPath = join(root, "agent-count.txt");
    await mkdir(suiteRoot);
    const benchmarkSuite = suite();
    const initial = await runner.runBenchmarkSuite({
      suite: benchmarkSuite,
      suiteRoot,
      outputRoot,
      runId: "persisted-run",
      agent: agent(counterPath),
    });
    const initialCase = initial.cases[0]!;
    const originalAgent = structuredClone(initialCase.agent);
    const originalWorkspace = initialCase.workspace;
    const originalArtifactSha = await sha256(
      join(originalWorkspace, "result.txt"),
    );
    const originalStdoutSha = await sha256(initialCase.agent.stdoutPath);
    const originalStderrSha = await sha256(initialCase.agent.stderrPath);
    const runManifestBefore = await readFile(
      join(outputRoot, "persisted-run", "run-manifest.json"),
      "utf8",
    );

    const reevaluate = (
      runner as unknown as {
        reevaluateBenchmarkRun(input: {
          suite: ArtifactBenchmarkSuite;
          suiteRoot: string;
          outputRoot: string;
          runId: string;
          caseId: string;
        }): Promise<BenchmarkCaseReport>;
      }
    ).reevaluateBenchmarkRun;
    const report = await reevaluate({
      suite: benchmarkSuite,
      suiteRoot,
      outputRoot,
      runId: "persisted-run",
      caseId: "reevaluate-case",
    });

    expect(report).toMatchObject({
      id: "reevaluate-case",
      status: "pass",
      attempt: 1,
      agent: originalAgent,
    });
    expect(await readFile(counterPath, "utf8")).toBe("1");
    expect(report.workspace).toBe(originalWorkspace);
    expect(await sha256(join(originalWorkspace, "result.txt"))).toBe(
      originalArtifactSha,
    );
    expect(await sha256(report.agent.stdoutPath)).toBe(originalStdoutSha);
    expect(await sha256(report.agent.stderrPath)).toBe(originalStderrSha);
    expect(
      await readFile(
        join(outputRoot, "persisted-run", "run-manifest.json"),
        "utf8",
      ),
    ).toBe(runManifestBefore);
  });

  it("reuses the persisted Clash home for trusted product readback without rerunning Codex", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-host-reevaluate-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    await mkdir(suiteRoot);
    const { pluginRoot, fakeCodex, agentCounterPath } =
      await createFakeClashRuntime(root);
    const benchmarkSuite: ArtifactBenchmarkSuite = {
      schemaVersion: 1,
      id: "host-reevaluate-suite",
      title: "Host reevaluate suite",
      cases: [
        {
          id: "host-reevaluate-case",
          title: "Host reevaluate case",
          category: "director",
          outcome: {
            objective: "Persist a Director Stage.",
            acceptanceCriteria: ["The Stage matches trusted product state."],
            deliverables: [
              {
                artifactId: "stage",
                kind: "director-stage",
                description: "Director Stage",
              },
            ],
          },
          passScore: 100,
          timeoutMs: 10_000,
          skills: [],
          execution: {
            profile: "clash-host",
            requiredMcpTools: ["clash_director_create"],
            requiredCapabilities: ["director-stage"],
            preflight: {
              status: "ready",
              checks: [
                {
                  capability: "director-stage",
                  status: "available",
                  detail: "The project daemon exposes Director Stage readback.",
                },
              ],
            },
            requiredProductOperations: ["director.create"],
            evidence: { traceRequired: true, submissionRequired: true },
            productReadback: {
              required: true,
              mechanism: "director-stage-and-render-receipt",
              artifactIds: ["stage"],
              description: "Read the Stage from the project daemon.",
            },
          },
          rubric: [
            {
              id: "stage-valid",
              type: "director-stage",
              artifactId: "stage",
              weight: 1,
              required: true,
            },
          ],
        },
      ],
    };
    const initial = await runner.runBenchmarkSuite({
      suite: benchmarkSuite,
      suiteRoot,
      outputRoot,
      runId: "host-run",
      agent: {
        adapter: "codex",
        command: fakeCodex,
        env: { AGENT_COUNTER_PATH: agentCounterPath },
        clashHost: { pluginRoot, profile: "dev" },
      },
    });
    expect(initial.status).toBe("pass");
    const originalAgent = structuredClone(initial.cases[0]!.agent);
    const caseRoot = join(outputRoot, "host-run", "host-reevaluate-case");
    expect(
      await readFile(
        join(caseRoot, "clash-home", "host-start-count.txt"),
        "utf8",
      ),
    ).toBe("1");

    const report = await runner.reevaluateBenchmarkRun({
      suite: benchmarkSuite,
      suiteRoot,
      outputRoot,
      runId: "host-run",
      caseId: "host-reevaluate-case",
    });

    expect(report).toMatchObject({
      status: "pass",
      agent: originalAgent,
      execution: {
        status: "pass",
        productReadback: {
          status: "pass",
          matchedArtifactIds: ["stage"],
        },
      },
    });
    expect(await readFile(agentCounterPath, "utf8")).toBe("1");
    expect(
      await readFile(
        join(caseRoot, "clash-home", "host-start-count.txt"),
        "utf8",
      ),
    ).toBe("2");
  });
});
