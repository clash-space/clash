import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeWorkspaceBundleManifest } from "@clash/shared-runtime";
import { describe, expect, it } from "vitest";
import {
  DirectorStageStateSchema,
  markActionAssetBindingAuthority,
  markDocumentAssetAuthority,
  markGeneratorAuthority,
  markProjectAssetAuthority,
  projectDirectorStageReadToken,
} from "@clash/shared-types";
import { LoroDoc } from "loro-crdt";

import { verifyBenchmarkAttempt } from "./attempt-manifest";
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

function sha256Bytes(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createInputWorkspace(root: string) {
  await mkdir(root, { recursive: true });
  const doc = new LoroDoc();
  doc.setPeerId(1);
  markProjectAssetAuthority(doc);
  markActionAssetBindingAuthority(doc);
  markGeneratorAuthority(doc);
  markDocumentAssetAuthority(doc);
  doc.commit();
  const snapshot = Buffer.from(
    doc.export({
      mode: "shallow-snapshot",
      frontiers: doc.oplogFrontiers(),
    }),
  );
  await writeFile(join(root, "project.bin"), snapshot);
  return writeWorkspaceBundleManifest(root, {
    schemaVersion: 1,
    kind: "clash.workspace.bundle",
    source: {
      projectId: "host-reevaluate-project",
      display: { name: "Host reevaluate fixture" },
    },
    content: {
      workspaceRoot: "workspace",
      project: {
        path: "project.bin",
        codec: "loro-shallow-snapshot",
        codecVersion: 1,
      },
      resources: [],
      documentBodies: [],
      textRevisions: [],
    },
    semanticRequirements: {
      generatorDefinitions: [],
      modelReferences: [],
    },
    files: [
      {
        path: "project.bin",
        role: "project",
        bytes: snapshot.byteLength,
        sha256: sha256Bytes(snapshot),
        mode: "0644",
      },
    ],
    excluded: [],
  });
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
  const receiptPrefix = `${projectDirectorStageReadToken(productStage)}:receipt:test-host-`;
  await Promise.all([
    mkdir(runtimeRoot, { recursive: true }),
    mkdir(join(pluginRoot, ".codex-plugin"), { recursive: true }),
  ]);
  await writeFile(
    join(pluginRoot, ".codex-plugin", "plugin.json"),
    `${JSON.stringify({ name: "clash-test", version: "1.0.0" }, null, 2)}\n`,
    "utf8",
  );
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
      'const startCount = Number(fs.existsSync(starts) ? fs.readFileSync(starts, "utf8") : "0") + 1',
      "fs.writeFileSync(starts, String(startCount))",
      'const pluginSocket = path.join(process.env.CLASH_HOME, "sockets", "plugin-host.sock")',
      "fs.mkdirSync(path.dirname(pluginSocket), {recursive:true})",
      "fs.rmSync(pluginSocket, {force:true})",
      "const ipc = net.createServer((socket) => socket.end())",
      "ipc.listen(pluginSocket)",
      `const stage = ${JSON.stringify(productStage)}`,
      `const receipt = ${JSON.stringify(receiptPrefix)} + startCount`,
      'const server = http.createServer((request, response) => { const chunks = []; request.on("data", (chunk) => chunks.push(chunk)); request.on("end", () => { let body = {}; if (request.method === "POST" && /\\/api\\/v1\\/projects\\/[^/]+\\/host-command$/.test(request.url || "")) { const command = JSON.parse(Buffer.concat(chunks).toString("utf8")); body = command.action === "ping" ? {pong:true} : command.action === "list_director_stages" ? {stages:[stage],versions:{[stage.id]:receipt}} : {error:"unsupported"} } response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)) }) })',
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
      'const fs = require("node:fs")',
      'const path = require("node:path")',
      "const argv = process.argv.slice(2)",
      'const marker = path.join(process.cwd(), ".clash", "project.toml")',
      'if (argv[0] === "workspace" && argv[1] === "import") { const source = argv[2]; const target = argv[argv.indexOf("--into") + 1]; fs.mkdirSync(path.join(target, ".clash"), {recursive:true}); fs.writeFileSync(path.join(target, ".clash", "project.toml"), "schema_version = 1\\nproject_id = \\"host-reevaluate-project\\"\\nworkspace_id = \\"managed:test\\"\\nstore = \\"managed\\"\\n"); fs.writeFileSync(path.join(process.env.CLASH_HOME, "import-source.txt"), source); process.stdout.write(JSON.stringify({projectId:"host-reevaluate-project",workspaceId:"managed:test"}) + "\\n"); process.exit(0) }',
      'if (argv[0] === "workspace" && argv[1] === "export") { const output = argv[argv.indexOf("--out") + 1]; const source = fs.readFileSync(path.join(process.env.CLASH_HOME, "import-source.txt"), "utf8"); fs.cpSync(source, output, {recursive:true}); process.stdout.write(JSON.stringify({path:output}) + "\\n"); process.exit(0) }',
      'if (argv[0] === "init") { const requested = argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : undefined; let reused = false; let projectId = requested; if (fs.existsSync(marker)) { const source = fs.readFileSync(marker, "utf8"); projectId = /project_id\\s*=\\s*"([^"]+)"/.exec(source)?.[1]; reused = true } else { fs.mkdirSync(path.dirname(marker), {recursive:true}); fs.writeFileSync(marker, "schema_version = 1\\nproject_id = " + JSON.stringify(projectId) + "\\nworkspace_id = \\"managed:test\\"\\nstore = \\"managed\\"\\n") } process.stdout.write(JSON.stringify({projectId,workspaceId:"managed:test",reused}) + "\\n"); process.exit(0) }',
      'if (argv[0] === "director" && argv[1] === "create") process.exit(0)',
      "process.exit(2)",
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
      'if (process.argv.includes("--version")) { process.stdout.write("codex-cli 1.0.0\\n"); process.exit(0) }',
      "const workspace = process.env.CLASH_BENCH_WORKSPACE",
      "const counter = process.env.AGENT_COUNTER_PATH",
      'require("node:child_process").execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["director", "create", "--stage", "reevaluate-stage", "--json"], {cwd:workspace,env:{...process.env,CLASH_CLI_TRACE_ORIGIN:"mcp-transport"},stdio:"ignore"})',
      'fs.writeFileSync(counter, String(Number(fs.existsSync(counter) ? fs.readFileSync(counter, "utf8") : "0") + 1))',
      `fs.writeFileSync(path.join(workspace, "stage.json"), ${JSON.stringify(JSON.stringify(directorStage))})`,
      'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"host-reevaluate-case",artifacts:[{id:"stage",kind:"director-stage",path:"stage.json"}]}))',
      'process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"host-reevaluate"}) + "\\n")',
      'process.stdout.write(JSON.stringify({type:"turn.started"}) + "\\n")',
      'process.stdout.write(JSON.stringify({type:"item.completed",item:{id:"director-create",type:"mcp_tool_call",server:"clash",tool:"clash_director_create",arguments:{},status:"completed",error:null}}) + "\\n")',
      'process.stdout.write(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,cached_input_tokens:0,cache_write_input_tokens:0,output_tokens:1,reasoning_output_tokens:0}}) + "\\n")',
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

  it("reevaluates sealed product readback without rerunning Codex or the Host", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-host-reevaluate-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    await mkdir(suiteRoot);
    const inputWorkspace = await createInputWorkspace(
      join(suiteRoot, "environment"),
    );
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
                  detail: "The Project Host exposes Director Stage readback.",
                },
              ],
            },
            requiredProductOperations: ["director.create"],
            evidence: { traceRequired: true, submissionRequired: true },
            productReadback: {
              required: true,
              mechanism: "director-stage-and-render-receipt",
              artifactIds: ["stage"],
              description: "Read the Stage from the Project Host.",
            },
            environment: {
              profile: "clash-agent-environment-v1",
              track: "functional",
              initialState: {
                workspace: {
                  format: "clash-workspace-v1",
                  path: "environment",
                  bundleDigest: inputWorkspace.integrity.bundleDigest,
                },
              },
              outputs: {
                modifiedWorkspace: true,
                rawTrajectory: true,
                normalizedTrajectory: "clash-normalized-v1",
                atifTrajectory: "ATIF-v1.7-when-supported",
                otlpTrace: "otlp-json",
                attempt: "clash-attempt-v1",
              },
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
        model: "gpt-5.6-sol",
        env: { AGENT_COUNTER_PATH: agentCounterPath },
        clashHost: { pluginRoot, profile: "dev" },
      },
    });
    expect(initial.status).toBe("pass");
    const originalAgent = structuredClone(initial.cases[0]!.agent);
    const caseRoot = join(outputRoot, "host-run", "host-reevaluate-case");
    const hostStartCountPath = join(
      caseRoot,
      "clash-home",
      "host-start-count.txt",
    );
    const hostStartCountBefore = await readFile(hostStartCountPath, "utf8");
    const attemptPath = join(caseRoot, "attempt.json");
    const attemptBytesBefore = await readFile(attemptPath);
    const verifiedBefore = await verifyBenchmarkAttempt({
      caseRoot,
      suiteRoot,
    });
    const readbackBytesBefore = new Map(
      await Promise.all(
        verifiedBefore.record.evidence.readback.map(async ({ path }) => [
          path,
          await readFile(join(caseRoot, path)),
        ] as const),
      ),
    );
    expect([...readbackBytesBefore.keys()]).toEqual([
      "director-readback.json",
    ]);
    await Promise.all(
      [
        "evaluation-evidence",
        "evaluations",
        "aggregates",
        "rewards",
        "result-bundle.json",
      ].map((path) => rm(join(caseRoot, path), { recursive: true, force: true })),
    );

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
    expect(await readFile(hostStartCountPath, "utf8")).toBe(
      hostStartCountBefore,
    );
    expect(await readFile(attemptPath)).toEqual(attemptBytesBefore);
    await Promise.all(
      [...readbackBytesBefore].map(async ([path, bytes]) => {
        expect(await readFile(join(caseRoot, path))).toEqual(bytes);
      }),
    );
    expect(await verifyBenchmarkAttempt({ caseRoot, suiteRoot })).toEqual(
      verifiedBefore,
    );
    expect(
      (await readdir(join(caseRoot, "evaluations", "sha256"))).filter(
        (name) => name.endsWith(".json"),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      (await readdir(join(caseRoot, "aggregates", "sha256"))).filter(
        (name) => name.endsWith(".json"),
      ).length,
    ).toBeGreaterThan(0);
  }, 15_000);
});
