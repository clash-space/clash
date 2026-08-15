import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  directorCaptureFrameId,
  directorCaptureTargetsStageRevision,
  reevaluateBenchmarkRun,
  runBenchmarkSuite,
} from "./runner";
import type { ArtifactBenchmarkSuite } from "./types";

it("binds a Director capture to the exact Stage revision, independent of JSON serialization order", () => {
  expect(
    directorCaptureTargetsStageRevision(
      {
        stageId: "premium-gadget-hero",
        sourceStageRevisionId: "director-stage-revision-v1:f18cc03071c28819",
      },
      {
        id: "premium-gadget-hero",
        revisionId: "director-stage-revision-v1:f18cc03071c28819",
      },
    ),
  ).toBe(true);
  expect(
    directorCaptureTargetsStageRevision(
      {
        stageId: "premium-gadget-hero",
        sourceStageRevisionId: "director-stage-revision-v1:f18cc03071c28819",
      },
      {
        id: "premium-gadget-hero",
        revisionId: "director-stage-revision-v1:other",
      },
    ),
  ).toBe(false);
  expect(directorCaptureFrameId({ label: "opening" })).toBe("opening");
  expect(directorCaptureFrameId({ artifactId: "legacy-opening" })).toBe(
    "legacy-opening",
  );
});

async function writeFakeClashPlugin(
  pluginRoot: string,
  options: { assetListDomainFailure?: boolean } = {},
): Promise<void> {
  const runtimeRoot = join(pluginRoot, "runtime");
  const assetListResult = options.assetListDomainFailure
    ? {
        isError: true,
        content: [{ type: "text", text: "Asset listing failed" }],
        structuredContent: {
          status: "failed",
          error: "Asset listing failed",
        },
      }
    : {
        content: [{ type: "text", text: "Found 0 Project Assets." }],
        structuredContent: { items: [] },
      };
  await mkdir(runtimeRoot, { recursive: true });
  await writeFile(
    join(runtimeRoot, "index.js"),
    [
      'const readline = require("node:readline")',
      "const lines = readline.createInterface({input:process.stdin,crlfDelay:Infinity})",
      'const send = (value) => process.stdout.write(JSON.stringify(value) + "\\n")',
      'lines.on("line", (line) => {',
      "  const message = JSON.parse(line)",
      '  if (message.method === "initialize") { send({jsonrpc:"2.0",id:message.id,result:{protocolVersion:"2025-06-18",capabilities:{tools:{}},serverInfo:{name:"fake-clash",version:"1.0.0"}}}); return }',
      '  if (message.method === "tools/call") {',
      '    if (message.params?.name !== "clash_assets_list") { send({jsonrpc:"2.0",id:message.id,error:{code:-32601,message:"unknown tool"}}); return }',
      `    send({jsonrpc:"2.0",id:message.id,result:${JSON.stringify(assetListResult)}})`,
      "  }",
      "})",
    ].join("\n"),
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
      "fs.mkdirSync(runDir, {recursive:true})",
      'const pluginSocket = process.env.CLASH_PLUGIN_HOST_SOCKET || path.join(process.env.CLASH_HOME, "sockets", "plugin-host.sock")',
      "fs.mkdirSync(path.dirname(pluginSocket), {recursive:true})",
      "fs.rmSync(pluginSocket, {force:true})",
      "const ipc = net.createServer((socket) => socket.end())",
      "ipc.listen(pluginSocket)",
      'const server = http.createServer((request, response) => { const chunks = []; request.on("data", (chunk) => chunks.push(chunk)); request.on("end", () => { let body = {}; if (request.method === "POST" && /\\/api\\/v1\\/projects\\/[^/]+\\/host-command$/.test(request.url || "")) { const command = JSON.parse(Buffer.concat(chunks).toString("utf8")); body = command.action === "ping" ? {pong:true} : {error:"unsupported"} } response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)) }) })',
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
      'if (argv[0] === "init") { const requested = argv.includes("--project") ? argv[argv.indexOf("--project") + 1] : undefined; let reused = false; let projectId = requested; if (fs.existsSync(marker)) { const source = fs.readFileSync(marker, "utf8"); projectId = /project_id\\s*=\\s*"([^"]+)"/.exec(source)?.[1]; reused = true } else { fs.mkdirSync(path.dirname(marker), {recursive:true}); fs.writeFileSync(marker, "schema_version = 1\\nproject_id = " + JSON.stringify(projectId) + "\\nworkspace_id = \\"managed:test\\"\\nstore = \\"managed\\"\\n") } process.stdout.write(JSON.stringify({projectId,markerPath:marker,workspaceId:"managed:test",reused}) + "\\n"); process.exit(0) }',
      "if (!fs.existsSync(marker)) process.exit(43)",
      "const tracePath = process.env.CLASH_CLI_TRACE_PATH",
      "const startedAt = new Date().toISOString()",
      'if (tracePath) fs.appendFileSync(tracePath, JSON.stringify({type:"clash.cli.started",startedAt,pid:process.pid,cwd:process.cwd(),argv}) + "\\n")',
      'if (argv.length === 1 && argv[0] === "--help") { process.stdout.write("Clash root help\\n"); process.exit(0) }',
      'else if (argv.length === 2 && argv[1] === "--help") { process.stdout.write("Clash " + argv[0] + " help\\n"); process.exit(0) }',
      'else if (argv[0] === "director" && argv[1] === "schema" && argv.length === 3 && argv[2] === "--help") { process.stdout.write("Clash director schema help\\n"); process.exit(0) }',
      'else if (argv[0] === "director" && argv[1] === "schema" && argv.length === 3 && argv[2] === "--json") { process.stdout.write(JSON.stringify({schemaVersion:1,contract:"state",source:"@clash/shared-types",jsonSchema:{type:"object"}}) + "\\n"); process.exit(0) }',
      'else if (argv[0] === "director" && argv[1] === "schema" && argv.length === 5 && argv[2] === "--contract" && argv[4] === "--json") { process.stdout.write(JSON.stringify({schemaVersion:1,contract:argv[3],source:"@clash/shared-types",jsonSchema:{type:"object"}}) + "\\n"); process.exit(0) }',
      'else if (argv[0] === "director" && argv[1] === "schema") { fs.writeFileSync(path.join(process.cwd(), "unbounded-director-schema-invoked.txt"), JSON.stringify(argv)); process.stdout.write("unbounded director schema invocation\\n"); process.exit(0) }',
      'else if (argv[0] === "timeline" && argv[1] === "schema" && argv.length === 3 && argv[2] === "--help") { process.stdout.write("Clash timeline schema help\\n"); process.exit(0) }',
      'else if (argv[0] === "timeline" && argv[1] === "schema" && argv.length === 3 && argv[2] === "--json") { process.stdout.write(JSON.stringify({testContract:"timeline-schema"}) + "\\n"); process.exit(0) }',
      'else if (argv[0] === "timeline" && argv[1] === "schema") { fs.writeFileSync(path.join(process.cwd(), "unbounded-timeline-schema-invoked.txt"), JSON.stringify(argv)); process.stdout.write("unbounded timeline schema invocation\\n"); process.exit(0) }',
      'else if (argv[0] === "timeline" && argv[1] === "validate" && argv.includes("domain-fail.timeline.yaml")) process.exit(7)',
      'else if (argv[0] === "timeline" && argv[1] === "validate" && argv.includes("--file") && argv.includes("--json")) { process.stdout.write(JSON.stringify({ok:true}) + "\\n"); process.exit(0) }',
      'else if (argv[0] === "timeline" && argv[1] === "create") { fs.writeFileSync(path.join(process.cwd(), "timeline-create-invoked.txt"), JSON.stringify(argv)); process.stdout.write(JSON.stringify({ok:true}) + "\\n"); process.exit(0) }',
      'else if (argv[0] === "timeline" && argv[1] === "render" && argv.includes("background")) { fs.writeFileSync(path.join(process.cwd(), "active-cli-started.txt"), "yes"); process.on("SIGTERM", () => { fs.writeFileSync(path.join(process.cwd(), "active-cli-stopped.txt"), "yes"); process.exit(143) }); setInterval(() => {}, 1000) }',
      'else if (argv[0] === "timeline" && argv[1] === "render" && argv.includes("identity-env")) { fs.writeFileSync(path.join(process.cwd(), "trusted-cli-env.json"), JSON.stringify({localUser:process.env.CLASH_SESSION_AS_LOCAL_USER ?? null,agentMemberId:process.env.CLASH_AGENT_MEMBER_ID ?? null,agentName:process.env.CLASH_AGENT_NAME ?? null})); process.exit(0) }',
      'else if (argv[0] === "timeline" && argv[1] === "render" && argv.includes("failed-mcp")) process.exit(7)',
      'else if ((argv[0] === "timeline" && argv[1] === "render") || (argv[0] === "canvas" && argv[1] === "update")) { fs.writeFileSync(path.join(process.cwd(), argv[0] === "timeline" ? "outside-path-cli-invoked.txt" : "undeclared-cli-invoked.txt"), "yes"); if (tracePath) fs.appendFileSync(tracePath, JSON.stringify({type:"clash.cli.completed",startedAt,finishedAt:new Date().toISOString(),durationMs:1,pid:process.pid,cwd:process.cwd(),argv,exitCode:0,signal:null}) + "\\n"); process.exit(0) }',
      'if (!argv.includes("background")) process.exit(2)',
    ].join("\n"),
    "utf8",
  );
  await chmod(cliPath, 0o755);
}

function traceRequiredSuite(): ArtifactBenchmarkSuite {
  return {
    schemaVersion: 1,
    id: "trusted-cli-trace-suite",
    title: "Trusted CLI trace suite",
    cases: [
      {
        id: "trusted-cli-trace",
        title: "Trusted CLI trace",
        category: "timeline",
        outcome: {
          objective: "Create a report after rendering the Timeline.",
          acceptanceCriteria: ["The Timeline render command really ran."],
          deliverables: [
            {
              artifactId: "result",
              kind: "report",
              description: "Agent report",
            },
          ],
        },
        passScore: 100,
        timeoutMs: 10_000,
        skills: [],
        execution: {
          profile: "clash-host",
          requiredProductOperations: ["timeline.render"],
          requiredCliCommands: ["timeline render"],
        },
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
      },
    ],
  };
}

function directorSchemaDiscoverySuite(
  transport: "auto" | "cli" = "cli",
): ArtifactBenchmarkSuite {
  const suite = traceRequiredSuite();
  suite.id = `trusted-director-schema-${transport}-suite`;
  suite.title = `Trusted Director schema ${transport} suite`;
  suite.cases[0]!.id = `trusted-director-schema-${transport}`;
  suite.cases[0]!.title = `Trusted Director schema ${transport}`;
  suite.cases[0]!.category = "director";
  suite.cases[0]!.execution = {
    profile: "clash-host",
    transport,
    requiredProductOperations: ["director.get", "director.mutate"],
  };
  return suite;
}

function timelineSchemaDiscoverySuite(
  transport: "auto" | "cli" = "cli",
): ArtifactBenchmarkSuite {
  const suite = traceRequiredSuite();
  suite.id = `trusted-timeline-schema-${transport}-suite`;
  suite.title = `Trusted Timeline schema ${transport} suite`;
  suite.cases[0]!.id = `trusted-timeline-schema-${transport}`;
  suite.cases[0]!.title = `Trusted Timeline schema ${transport}`;
  suite.cases[0]!.execution = {
    profile: "clash-host",
    transport,
    requiredProductOperations: ["timeline.get", "timeline.save"],
  };
  return suite;
}

function mcpTraceRequiredSuite(): ArtifactBenchmarkSuite {
  const suite = traceRequiredSuite();
  suite.id = "trusted-mcp-trace-suite";
  suite.title = "Trusted MCP trace suite";
  suite.cases[0]!.id = "trusted-mcp-trace";
  suite.cases[0]!.title = "Trusted MCP trace";
  suite.cases[0]!.execution = {
    profile: "clash-host",
    requiredProductOperations: ["timeline.render"],
    requiredMcpTools: ["clash_timeline_render"],
  };
  return suite;
}

function directMcpTraceRequiredSuite(): ArtifactBenchmarkSuite {
  const suite = traceRequiredSuite();
  suite.id = "trusted-direct-mcp-trace-suite";
  suite.title = "Trusted direct MCP trace suite";
  suite.cases[0]!.id = "trusted-direct-mcp-trace";
  suite.cases[0]!.title = "Trusted direct MCP trace";
  suite.cases[0]!.execution = {
    profile: "clash-host",
    requiredProductOperations: ["asset.list"],
    requiredMcpTools: ["clash_assets_list"],
  };
  return suite;
}

function forbiddenOperationSuite(input: {
  transport: "mcp" | "cli";
  operation: "asset.list" | "timeline.validate";
}): ArtifactBenchmarkSuite {
  const suite = traceRequiredSuite();
  suite.id = `forbidden-${input.transport}-operation-suite`;
  suite.title = `Forbidden ${input.transport.toUpperCase()} operation suite`;
  suite.cases[0]!.id = `forbidden-${input.transport}-operation`;
  suite.cases[0]!.title = `Forbidden ${input.transport.toUpperCase()} operation`;
  suite.cases[0]!.execution = {
    profile: "clash-host",
    transport: input.transport,
    forbiddenProductOperations: [input.operation],
  };
  return suite;
}

type ClashTransport = "auto" | "mcp" | "cli";

function transportIsolationSuite(
  transport: ClashTransport,
): ArtifactBenchmarkSuite {
  const requiredProductOperations = [
    ...(transport === "mcp" || transport === "auto" ? ["asset.list"] : []),
    ...(transport === "cli" || transport === "auto" ? ["timeline.render"] : []),
  ];
  return {
    schemaVersion: 1,
    id: `transport-${transport}-suite`,
    title: `Transport ${transport} suite`,
    cases: [
      {
        id: `transport-${transport}`,
        title: `Transport ${transport}`,
        category: "mixed",
        outcome: {
          objective: `Complete the ${transport} transport case.`,
          acceptanceCriteria: ["The requested Clash operation completes."],
          deliverables: [
            {
              artifactId: "result",
              kind: "report",
              description: "Agent report",
            },
          ],
        },
        passScore: 100,
        timeoutMs: 10_000,
        skills: [],
        execution: {
          profile: "clash-host",
          transport,
          requiredProductOperations,
        },
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
      },
    ],
  };
}

async function runTransportIsolationCase(transport: ClashTransport): Promise<{
  caseRoot: string;
  observation: {
    config: Record<string, string>;
    rawHostEnvironment: Record<string, string>;
    privateClashEnvironment: Record<string, string>;
    cliEntryPath: string | null;
    pathEntries: string[];
  };
  report: Awaited<ReturnType<typeof runBenchmarkSuite>>;
}> {
  const root = await mkdtemp(join(tmpdir(), `clash-transport-${transport}-`));
  const suiteRoot = join(root, "suite");
  const outputRoot = join(root, "runs");
  const pluginRoot = join(root, "plugin");
  const fakeAgent = join(root, "fake-agent");
  await Promise.all([mkdir(suiteRoot), writeFakeClashPlugin(pluginRoot)]);
  await writeFile(
    fakeAgent,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs")',
      'const path = require("node:path")',
      'const childProcess = require("node:child_process")',
      "const workspace = process.env.CLASH_BENCH_WORKSPACE",
      "const transport = process.env.TEST_CLASH_TRANSPORT",
      "const argv = process.argv.slice(2)",
      'const config = Object.fromEntries(argv.flatMap((value, index) => { if (value !== "-c") return []; const entry = argv[index + 1] || ""; const separator = entry.indexOf("="); return separator < 0 ? [] : [[entry.slice(0, separator), entry.slice(separator + 1)]] }))',
      'const rawHostKeys = ["CLASH_PROFILE","CLASH_HOME","CLASH_LOCAL_DATA_DIR","CLASH_API_URL","CLASH_NODE_EXEC_PATH","CLASH_WORKSPACE_ROOT","CLASH_AGENT_MEMBER_ID","CLASH_AGENT_NAME","CLASH_PLUGIN_HOST_SOCKET"]',
      "const rawHostEnvironment = Object.fromEntries(rawHostKeys.flatMap((key) => process.env[key] === undefined ? [] : [[key, process.env[key]]]))",
      'const privateClashEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith("CLASH_") && !key.startsWith("CLASH_BENCH_")))',
      'const observation = {config,rawHostEnvironment,privateClashEnvironment,cliEntryPath:process.env.CLASH_CLI_ENTRY_PATH || null,pathEntries:(process.env.PATH || "").split(path.delimiter)}',
      'fs.writeFileSync(path.join(workspace, "transport-observation.json"), JSON.stringify(observation))',
      "const callMcp = () => new Promise((resolveCall, rejectCall) => {",
      '  const commandValue = config["mcp_servers.clash.command"]',
      '  const argsValue = config["mcp_servers.clash.args"]',
      '  const cwdValue = config["mcp_servers.clash.cwd"]',
      '  if (!commandValue || !argsValue || !cwdValue) { rejectCall(new Error("missing Clash MCP config")); return }',
      '  const mcp = childProcess.spawn(JSON.parse(commandValue), JSON.parse(argsValue), {cwd:JSON.parse(cwdValue),env:process.env,stdio:["pipe","pipe","inherit"]})',
      '  let buffer = ""',
      "  let completed = false",
      '  const send = (value) => mcp.stdin.write(JSON.stringify(value) + "\\n")',
      '  mcp.stdout.on("data", (chunk) => { buffer += chunk.toString("utf8"); for (;;) { const newline = buffer.indexOf("\\n"); if (newline < 0) break; const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); const message = JSON.parse(line); if (message.id === 1) { send({jsonrpc:"2.0",method:"notifications/initialized"}); send({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"clash_assets_list",arguments:{cwd:workspace}}}); continue } if (message.id === 2 && !message.error && message.result?.isError !== true) { completed = true; mcp.stdin.end() } } })',
      '  mcp.once("error", rejectCall)',
      '  mcp.once("close", () => completed ? resolveCall() : rejectCall(new Error("Clash MCP call did not complete")))',
      '  send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"fake-agent",version:"1.0.0"}}})',
      "})",
      ";(async () => {",
      '  if (transport === "mcp" || transport === "auto") await callMcp()',
      '  if (transport === "cli" || transport === "auto") childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline","render","--timeline","smoke","--json"], {cwd:workspace,stdio:"ignore"})',
      '  fs.writeFileSync(path.join(workspace, "result.txt"), "transport completed")',
      '  fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      "})().catch((error) => { console.error(error); process.exit(41) })",
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeAgent, 0o755);
  const runId = `transport-${transport}-run`;
  const report = await runBenchmarkSuite({
    suite: transportIsolationSuite(transport),
    suiteRoot,
    outputRoot,
    runId,
    maxInfrastructureAttempts: 1,
    agent: {
      adapter: "codex",
      command: fakeAgent,
      env: {
        TEST_CLASH_TRANSPORT: transport,
        ...(transport === "mcp"
          ? {
              CLASH_API_URL: "http://forged.invalid",
              CLASH_HOME: "/forged/clash-home",
              CLASH_LOCAL_DATA_DIR: "/forged/local-data",
              CLASH_WORKSPACE_ROOT: "/forged/workspace",
              CLASH_CLI_ENTRY_PATH: "/forged/clash",
              CLASH_FUTURE_HOST_CAPABILITY: "forged-authority",
            }
          : {}),
      },
      clashHost: { pluginRoot, profile: "dev" },
    },
  });
  const caseRoot = join(outputRoot, runId, `transport-${transport}`);
  const observation = JSON.parse(
    await readFile(
      join(report.cases[0]!.workspace, "transport-observation.json"),
      "utf8",
    ),
  ) as {
    config: Record<string, string>;
    rawHostEnvironment: Record<string, string>;
    privateClashEnvironment: Record<string, string>;
    cliEntryPath: string | null;
    pathEntries: string[];
  };
  return { caseRoot, observation, report };
}

async function runSealedMcpTraceCase(input: {
  testRootPrefix: string;
  runId: string;
  timelineId?: string;
  expectCliFailure?: boolean;
}): Promise<{
  suite: ArtifactBenchmarkSuite;
  suiteRoot: string;
  outputRoot: string;
  caseRoot: string;
  report: Awaited<ReturnType<typeof runBenchmarkSuite>>;
}> {
  const root = await mkdtemp(join(tmpdir(), input.testRootPrefix));
  const suiteRoot = join(root, "suite");
  const outputRoot = join(root, "runs");
  const pluginRoot = join(root, "plugin");
  const fakeAgent = join(root, "fake-agent");
  const timelineId = input.timelineId ?? "sealed-mcp";
  await Promise.all([mkdir(suiteRoot), writeFakeClashPlugin(pluginRoot)]);
  await writeFile(
    fakeAgent,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs")',
      'const path = require("node:path")',
      'const childProcess = require("node:child_process")',
      "const workspace = process.env.CLASH_BENCH_WORKSPACE",
      "let failed = false",
      `try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "render", "--timeline", ${JSON.stringify(timelineId)}, "--json"], {cwd:workspace,env:{...process.env,CLASH_CLI_TRACE_ORIGIN:"mcp-transport"},stdio:"ignore"}) } catch { failed = true }`,
      `if (failed !== ${input.expectCliFailure === true ? "true" : "false"}) process.exit(29)`,
      'fs.writeFileSync(path.join(workspace, "result.txt"), "sealed MCP invocation")',
      'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"trusted-mcp-trace",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeAgent, 0o755);
  const suite = mcpTraceRequiredSuite();
  const report = await runBenchmarkSuite({
    suite,
    suiteRoot,
    outputRoot,
    runId: input.runId,
    maxInfrastructureAttempts: 1,
    agent: {
      adapter: "codex",
      command: fakeAgent,
      clashHost: { pluginRoot, profile: "dev" },
    },
  });
  return {
    suite,
    suiteRoot,
    outputRoot,
    caseRoot: join(outputRoot, input.runId, "trusted-mcp-trace"),
    report,
  };
}

async function runDirectMcpTraceCase(
  runId: string,
  options: {
    forbidden?: boolean;
    domainFailure?: boolean;
  } = {},
): Promise<{
  suite: ArtifactBenchmarkSuite;
  suiteRoot: string;
  outputRoot: string;
  caseRoot: string;
  report: Awaited<ReturnType<typeof runBenchmarkSuite>>;
}> {
  const root = await mkdtemp(join(tmpdir(), "clash-direct-mcp-trace-"));
  const suiteRoot = join(root, "suite");
  const outputRoot = join(root, "runs");
  const pluginRoot = join(root, "plugin");
  const fakeAgent = join(root, "fake-agent");
  await Promise.all([
    mkdir(suiteRoot),
    writeFakeClashPlugin(pluginRoot, {
      assetListDomainFailure: options.domainFailure,
    }),
  ]);
  await writeFile(
    fakeAgent,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs")',
      'const path = require("node:path")',
      'const childProcess = require("node:child_process")',
      'const config = (key) => { const prefix = key + "="; const value = process.argv.find((argument) => argument.startsWith(prefix)); return value ? JSON.parse(value.slice(prefix.length)) : undefined }',
      'const command = config("mcp_servers.clash.command")',
      'const args = config("mcp_servers.clash.args")',
      'const cwd = config("mcp_servers.clash.cwd")',
      "if (!command || !Array.isArray(args) || !cwd) process.exit(31)",
      'const mcp = childProcess.spawn(command, args, {cwd,env:process.env,stdio:["pipe","pipe","inherit"]})',
      'let buffer = ""',
      "let completed = false",
      'const send = (value) => mcp.stdin.write(JSON.stringify(value) + "\\n")',
      'mcp.stdout.on("data", (chunk) => {',
      '  buffer += chunk.toString("utf8")',
      "  for (;;) {",
      '    const newline = buffer.indexOf("\\n")',
      "    if (newline < 0) break",
      "    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)",
      "    const message = JSON.parse(line)",
      '    if (message.id === 1) { send({jsonrpc:"2.0",method:"notifications/initialized"}); send({jsonrpc:"2.0",id:2,method:"tools/call",params:{name:"clash_assets_list",arguments:{cwd:process.env.CLASH_BENCH_WORKSPACE}}}); continue }',
      `    if (message.id !== 2${options.domainFailure ? "" : " || message.error || message.result?.isError === true"}) continue`,
      "    completed = true",
      "    const workspace = process.env.CLASH_BENCH_WORKSPACE",
      '    fs.writeFileSync(path.join(workspace, "result.txt"), "real MCP result")',
      '    fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      "    mcp.stdin.end()",
      "  }",
      "})",
      'mcp.on("close", () => process.exit(completed ? 0 : 32))',
      'send({jsonrpc:"2.0",id:1,method:"initialize",params:{protocolVersion:"2025-06-18",capabilities:{},clientInfo:{name:"fake-agent",version:"1.0.0"}}})',
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeAgent, 0o755);
  const suite = options.forbidden
    ? forbiddenOperationSuite({ transport: "mcp", operation: "asset.list" })
    : directMcpTraceRequiredSuite();
  const report = await runBenchmarkSuite({
    suite,
    suiteRoot,
    outputRoot,
    runId,
    maxInfrastructureAttempts: 1,
    agent: {
      adapter: "codex",
      command: fakeAgent,
      clashHost: { pluginRoot, profile: "dev" },
    },
  });
  return {
    suite,
    suiteRoot,
    outputRoot,
    caseRoot: join(outputRoot, runId, suite.cases[0]!.id),
    report,
  };
}

async function runTrustedCliAgentCase(input: {
  testRootPrefix: string;
  runId: string;
  suite: ArtifactBenchmarkSuite;
  script: string[];
}): Promise<{
  caseRoot: string;
  report: Awaited<ReturnType<typeof runBenchmarkSuite>>;
}> {
  const root = await mkdtemp(join(tmpdir(), input.testRootPrefix));
  const suiteRoot = join(root, "suite");
  const outputRoot = join(root, "runs");
  const pluginRoot = join(root, "plugin");
  const fakeAgent = join(root, "fake-agent");
  await Promise.all([mkdir(suiteRoot), writeFakeClashPlugin(pluginRoot)]);
  await writeFile(
    fakeAgent,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs")',
      'const path = require("node:path")',
      'const childProcess = require("node:child_process")',
      "const workspace = process.env.CLASH_BENCH_WORKSPACE",
      ...input.script,
    ].join("\n"),
    "utf8",
  );
  await chmod(fakeAgent, 0o755);
  const report = await runBenchmarkSuite({
    suite: input.suite,
    suiteRoot,
    outputRoot,
    runId: input.runId,
    maxInfrastructureAttempts: 1,
    agent: {
      adapter: "codex",
      command: fakeAgent,
      clashHost: { pluginRoot, profile: "dev" },
    },
  });
  return {
    caseRoot: join(outputRoot, input.runId, input.suite.cases[0]!.id),
    report,
  };
}

async function resealTrace(input: {
  caseRoot: string;
  events: Array<Record<string, unknown>>;
  receipt?: Record<string, unknown>;
}): Promise<void> {
  const logsRoot = join(input.caseRoot, "logs");
  const traceText = input.events.length
    ? `${input.events.map((event) => JSON.stringify(event)).join("\n")}\n`
    : "";
  const receiptPath = join(logsRoot, "clash-cli-trace-receipt.json");
  const receipt =
    input.receipt ??
    (JSON.parse(await readFile(receiptPath, "utf8")) as Record<
      string,
      unknown
    >);
  await Promise.all([
    writeFile(join(logsRoot, "clash-cli-events.jsonl"), traceText, "utf8"),
    writeFile(
      receiptPath,
      `${JSON.stringify(
        {
          ...receipt,
          traceSha256: createHash("sha256").update(traceText).digest("hex"),
          eventCount: input.events.length,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
}

async function readTraceEvents(
  caseRoot: string,
): Promise<Array<Record<string, unknown>>> {
  return (
    await readFile(join(caseRoot, "logs", "clash-cli-events.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function readMcpTraceEvents(
  caseRoot: string,
): Promise<Array<Record<string, unknown>>> {
  return (
    await readFile(join(caseRoot, "logs", "clash-mcp-events.jsonl"), "utf8")
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

async function resealMcpTrace(input: {
  caseRoot: string;
  events: Array<Record<string, unknown>>;
}): Promise<void> {
  const logsRoot = join(input.caseRoot, "logs");
  const traceText = input.events.length
    ? `${input.events.map((event) => JSON.stringify(event)).join("\n")}\n`
    : "";
  const receiptPath = join(logsRoot, "clash-mcp-trace-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<
    string,
    unknown
  >;
  await Promise.all([
    writeFile(join(logsRoot, "clash-mcp-events.jsonl"), traceText, "utf8"),
    writeFile(
      receiptPath,
      `${JSON.stringify(
        {
          ...receipt,
          traceSha256: createHash("sha256").update(traceText).digest("hex"),
          eventCount: input.events.length,
        },
        null,
        2,
      )}\n`,
      "utf8",
    ),
  ]);
}

describe("runner-owned execution evidence", () => {
  it("keeps trusted CLI and raw Host authority private in an MCP-only lane", async () => {
    const run = await runTransportIsolationCase("mcp");

    expect(run.report.cases[0]).toMatchObject({
      status: "pass",
      agent: { status: "completed" },
      execution: {
        status: "pass",
        observedProductOperations: [
          {
            operation: "asset.list",
            transport: "mcp",
            invocation: "clash_assets_list",
          },
        ],
        missingProductOperations: [],
      },
    });
    expect(run.observation.rawHostEnvironment).toEqual({});
    expect(run.observation.privateClashEnvironment).toEqual({});
    expect(run.observation.cliEntryPath).toBeNull();
    expect(
      run.observation.pathEntries.some((entry) =>
        entry.includes("trusted-agent-cli"),
      ),
    ).toBe(false);
    expect(
      Object.keys(run.observation.config).some((key) =>
        key.startsWith("mcp_servers.clash.env."),
      ),
    ).toBe(false);
    await expect(
      readFile(
        join(run.caseRoot, "logs", "clash-mcp-trace-receipt.json"),
        "utf8",
      ),
    ).resolves.toContain('"source": "runner-mcp-relay"');
  }, 15_000);

  it("starts no MCP relay or Agent MCP configuration in a CLI-only lane", async () => {
    const run = await runTransportIsolationCase("cli");

    expect(run.report.cases[0]).toMatchObject({
      status: "pass",
      agent: { status: "completed" },
      execution: {
        status: "pass",
        observedProductOperations: [
          {
            operation: "timeline.render",
            transport: "cli",
            invocation: "timeline render --timeline smoke --json",
          },
        ],
        missingProductOperations: [],
      },
    });
    expect(run.observation.rawHostEnvironment).toEqual({});
    expect(run.observation.cliEntryPath).toMatch(
      /trusted-agent-cli[/\\]clash$/u,
    );
    expect(run.observation.pathEntries).toContain(
      dirname(run.observation.cliEntryPath!),
    );
    expect(
      Object.keys(run.observation.config).some((key) =>
        key.startsWith("mcp_servers.clash."),
      ),
    ).toBe(false);
    await expect(
      lstat(join(run.caseRoot, "logs", "clash-mcp-trace-receipt.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(run.caseRoot, "logs", "clash-cli-trace-receipt.json"),
        "utf8",
      ),
    ).resolves.toContain('"source": "runner-cli-proxy"');
  }, 15_000);

  it("executes root and group help through the sealed CLI proxy without treating navigation as product evidence", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-trusted-cli-help-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const pluginRoot = join(root, "plugin");
    const fakeAgent = join(root, "fake-agent");
    await Promise.all([mkdir(suiteRoot), writeFakeClashPlugin(pluginRoot)]);
    await writeFile(
      fakeAgent,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const childProcess = require("node:child_process")',
        "const workspace = process.env.CLASH_BENCH_WORKSPACE",
        'const invoke = (argv) => childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, argv, {cwd:workspace,encoding:"utf8"})',
        'const rootHelp = invoke(["--help"])',
        'const groupHelp = invoke(["timeline", "--help"])',
        'const advertisedAliasHelp = invoke(["asset", "--help"])',
        "let arbitraryHelpRejected = false",
        'try { invoke(["canvas", "update", "--help"]) } catch { arbitraryHelpRejected = true }',
        "let pathHelpRejected = false",
        'try { invoke(["..", "--help"]) } catch { pathHelpRejected = true }',
        "if (!arbitraryHelpRejected || !pathHelpRejected) process.exit(37)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), rootHelp + groupHelp + advertisedAliasHelp)',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"trusted-cli-trace",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeAgent, 0o755);

    const report = await runBenchmarkSuite({
      suite: traceRequiredSuite(),
      suiteRoot,
      outputRoot,
      runId: "trusted-cli-help",
      maxInfrastructureAttempts: 1,
      agent: {
        adapter: "codex",
        command: fakeAgent,
        clashHost: { pluginRoot, profile: "dev" },
      },
    });
    const benchmarkCase = report.cases[0]!;

    await expect(
      readFile(join(benchmarkCase.workspace, "result.txt"), "utf8"),
    ).resolves.toBe("Clash root help\nClash timeline help\nClash asset help\n");
    expect(benchmarkCase).toMatchObject({
      status: "fail",
      agent: { status: "completed" },
      execution: {
        status: "fail",
        observedCliCommands: [],
        missingCliCommands: ["timeline render"],
        observedProductOperations: [],
        missingProductOperations: ["timeline.render"],
      },
    });
    expect(
      (
        await readTraceEvents(
          join(outputRoot, "trusted-cli-help", "trusted-cli-trace"),
        )
      ).map((event) => ({ type: event.type, argv: event.argv })),
    ).toEqual([
      { type: "clash.cli.started", argv: ["--help"] },
      { type: "clash.cli.completed", argv: ["--help"] },
      { type: "clash.cli.started", argv: ["timeline", "--help"] },
      { type: "clash.cli.completed", argv: ["timeline", "--help"] },
      { type: "clash.cli.started", argv: ["asset", "--help"] },
      { type: "clash.cli.completed", argv: ["asset", "--help"] },
    ]);
  }, 15_000);

  it.each(["cli", "auto"] as const)(
    "runs bounded Director schema discovery through the sealed %s lane without satisfying Director operations",
    async (transport) => {
      const suite = directorSchemaDiscoverySuite(transport);
      const run = await runTrustedCliAgentCase({
        testRootPrefix: `clash-trusted-director-schema-${transport}-`,
        runId: `trusted-director-schema-${transport}`,
        suite,
        script: [
          'const invoke = (argv) => childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, argv, {cwd:workspace,encoding:"utf8"})',
          'const help = invoke(["director", "schema", "--help"])',
          'const state = JSON.parse(invoke(["director", "schema", "--json"]))',
          'const object = JSON.parse(invoke(["director", "schema", "--contract", "object", "--json"]))',
          'if (!help.includes("director schema help") || state.contract !== "state" || object.contract !== "object") process.exit(38)',
          'fs.writeFileSync(path.join(workspace, "result.txt"), "Director schemas discovered")',
          'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        ],
      });
      const benchmarkCase = run.report.cases[0]!;

      expect(benchmarkCase).toMatchObject({
        status: "fail",
        agent: { status: "completed" },
        execution: {
          status: "fail",
          observedProductOperations: [],
          missingProductOperations: ["director.get", "director.mutate"],
        },
      });
      expect(
        (await readTraceEvents(run.caseRoot)).map((event) => ({
          type: event.type,
          argv: event.argv,
        })),
      ).toEqual([
        {
          type: "clash.cli.started",
          argv: ["director", "schema", "--help"],
        },
        {
          type: "clash.cli.completed",
          argv: ["director", "schema", "--help"],
        },
        {
          type: "clash.cli.started",
          argv: ["director", "schema", "--json"],
        },
        {
          type: "clash.cli.completed",
          argv: ["director", "schema", "--json"],
        },
        {
          type: "clash.cli.started",
          argv: ["director", "schema", "--contract", "object", "--json"],
        },
        {
          type: "clash.cli.completed",
          argv: ["director", "schema", "--contract", "object", "--json"],
        },
      ]);
    },
    15_000,
  );

  it("rejects Director schema discovery when the case requires no Director product operation", async () => {
    const suite = traceRequiredSuite();
    const run = await runTrustedCliAgentCase({
      testRootPrefix: "clash-trusted-director-schema-unrelated-",
      runId: "trusted-director-schema-unrelated",
      suite,
      script: [
        "let rejected = 0",
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["director", "schema", "--help"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["director", "schema", "--json"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["director", "schema", "--contract", "object", "--json"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        "if (rejected !== 3) process.exit(39)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "Unrelated discovery rejected")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ],
    });

    expect(run.report.cases[0]).toMatchObject({
      agent: { status: "completed" },
      execution: {
        observedProductOperations: [],
        missingProductOperations: ["timeline.render"],
      },
    });
    expect(await readTraceEvents(run.caseRoot)).toEqual([]);
  }, 15_000);

  it("rejects extra and path-bearing Director schema arguments before invoking the real CLI", async () => {
    const suite = directorSchemaDiscoverySuite();
    const run = await runTrustedCliAgentCase({
      testRootPrefix: "clash-trusted-director-schema-bounds-",
      runId: "trusted-director-schema-bounds",
      suite,
      script: [
        "let rejected = 0",
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["director", "schema", "--json", "--unsafe"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["director", "schema", "--contract", "object", "--json", "../outside"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["director", "schema", "--contract", "unsafe", "--json"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        "if (rejected !== 3) process.exit(40)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "Unbounded schema calls rejected")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ],
    });

    expect(run.report.cases[0]).toMatchObject({
      agent: { status: "completed" },
      execution: {
        observedProductOperations: [],
        missingProductOperations: ["director.get", "director.mutate"],
      },
    });
    expect(await readTraceEvents(run.caseRoot)).toEqual([]);
    await expect(
      lstat(
        join(
          run.report.cases[0]!.workspace,
          "unbounded-director-schema-invoked.txt",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it.each(["cli", "auto"] as const)(
    "runs bounded Timeline schema discovery through the sealed %s lane without satisfying Timeline operations",
    async (transport) => {
      const suite = timelineSchemaDiscoverySuite(transport);
      const run = await runTrustedCliAgentCase({
        testRootPrefix: `clash-trusted-timeline-schema-${transport}-`,
        runId: `trusted-timeline-schema-${transport}`,
        suite,
        script: [
          'const invoke = (argv) => childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, argv, {cwd:workspace,encoding:"utf8"})',
          'const help = invoke(["timeline", "schema", "--help"])',
          'const schema = JSON.parse(invoke(["timeline", "schema", "--json"]))',
          'if (!help.includes("timeline schema help") || schema.testContract !== "timeline-schema") process.exit(41)',
          'fs.writeFileSync(path.join(workspace, "result.txt"), "Timeline schema discovered")',
          'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        ],
      });
      const benchmarkCase = run.report.cases[0]!;

      expect(benchmarkCase).toMatchObject({
        status: "fail",
        agent: { status: "completed" },
        execution: {
          status: "fail",
          observedProductOperations: [],
          missingProductOperations: ["timeline.get", "timeline.save"],
        },
      });
      expect(
        (await readTraceEvents(run.caseRoot)).map((event) => ({
          type: event.type,
          argv: event.argv,
        })),
      ).toEqual([
        {
          type: "clash.cli.started",
          argv: ["timeline", "schema", "--help"],
        },
        {
          type: "clash.cli.completed",
          argv: ["timeline", "schema", "--help"],
        },
        {
          type: "clash.cli.started",
          argv: ["timeline", "schema", "--json"],
        },
        {
          type: "clash.cli.completed",
          argv: ["timeline", "schema", "--json"],
        },
      ]);
    },
    15_000,
  );

  it("does not authorize Timeline create when the benchmark only requires Timeline save", async () => {
    const run = await runTrustedCliAgentCase({
      testRootPrefix: "clash-trusted-timeline-save-bounds-",
      runId: "trusted-timeline-save-bounds",
      suite: timelineSchemaDiscoverySuite(),
      script: [
        "let rejected = false",
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "create", "--id", "not-a-save", "--name", "Not a save", "--json"], {cwd:workspace,stdio:"ignore"}) } catch { rejected = true }',
        "if (!rejected) process.exit(45)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "Timeline create rejected")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ],
    });

    expect(run.report.cases[0]).toMatchObject({
      agent: { status: "completed" },
      execution: {
        observedProductOperations: [],
        missingProductOperations: ["timeline.get", "timeline.save"],
      },
    });
    expect(await readTraceEvents(run.caseRoot)).toEqual([]);
    await expect(
      lstat(
        join(run.report.cases[0]!.workspace, "timeline-create-invoked.txt"),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("rejects Timeline schema discovery when the case requires no Timeline product operation", async () => {
    const suite = directorSchemaDiscoverySuite();
    const run = await runTrustedCliAgentCase({
      testRootPrefix: "clash-trusted-timeline-schema-unrelated-",
      runId: "trusted-timeline-schema-unrelated",
      suite,
      script: [
        "let rejected = 0",
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "schema", "--help"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "schema", "--json"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        "if (rejected !== 2) process.exit(42)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "Unrelated Timeline discovery rejected")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ],
    });

    expect(run.report.cases[0]).toMatchObject({
      agent: { status: "completed" },
      execution: {
        observedProductOperations: [],
        missingProductOperations: ["director.get", "director.mutate"],
      },
    });
    expect(await readTraceEvents(run.caseRoot)).toEqual([]);
  }, 15_000);

  it.each(["cli", "auto"] as const)(
    "allows optional Timeline draft validation in a sealed %s lane without requiring it for success",
    async (transport) => {
      const run = await runTrustedCliAgentCase({
        testRootPrefix: `clash-trusted-timeline-validate-${transport}-`,
        runId: `trusted-timeline-validate-${transport}`,
        suite: timelineSchemaDiscoverySuite(transport),
        script: [
          'const draft = path.join(workspace, "draft.timeline.yaml")',
          'fs.writeFileSync(draft, "tracks: []\\n")',
          'const result = JSON.parse(childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "validate", "--file", "draft.timeline.yaml", "--json"], {cwd:workspace,encoding:"utf8"}))',
          "if (result.ok !== true) process.exit(44)",
          'fs.writeFileSync(path.join(workspace, "result.txt"), "Optional Timeline validation completed")',
          'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        ],
      });

      expect(run.report.cases[0]).toMatchObject({
        agent: { status: "completed" },
        execution: {
          observedProductOperations: [],
          missingProductOperations: ["timeline.get", "timeline.save"],
        },
      });
      expect(
        (await readTraceEvents(run.caseRoot)).map((event) => ({
          type: event.type,
          argv: event.argv,
          exitCode: event.exitCode,
        })),
      ).toEqual([
        {
          type: "clash.cli.started",
          argv: [
            "timeline",
            "validate",
            "--file",
            "draft.timeline.yaml",
            "--json",
          ],
          exitCode: undefined,
        },
        {
          type: "clash.cli.completed",
          argv: [
            "timeline",
            "validate",
            "--file",
            "draft.timeline.yaml",
            "--json",
          ],
          exitCode: 0,
        },
      ]);
    },
    15_000,
  );

  it.each([
    { label: "successful", file: "draft.timeline.yaml", failed: false },
    {
      label: "domain-failed",
      file: "domain-fail.timeline.yaml",
      failed: true,
    },
  ])(
    "fails ProductExecution for a $label forbidden CLI product operation",
    async ({ label, file, failed }) => {
      const suite = forbiddenOperationSuite({
        transport: "cli",
        operation: "timeline.validate",
      });
      const run = await runTrustedCliAgentCase({
        testRootPrefix: `clash-forbidden-cli-${label}-`,
        runId: `forbidden-cli-${label}`,
        suite,
        script: [
          `const draft = path.join(workspace, ${JSON.stringify(file)})`,
          'fs.writeFileSync(draft, "tracks: []\\n")',
          "let failed = false",
          `try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "validate", "--file", ${JSON.stringify(file)}, "--json"], {cwd:workspace,stdio:"ignore"}) } catch { failed = true }`,
          `if (failed !== ${failed ? "true" : "false"}) process.exit(46)`,
          'fs.writeFileSync(path.join(workspace, "result.txt"), "Forbidden CLI operation observed")',
          'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        ],
      });

      expect(run.report.cases[0]).toMatchObject({
        status: "fail",
        agent: { status: "completed" },
        execution: {
          status: "fail",
          forbiddenProductOperations: ["timeline.validate"],
          observedForbiddenProductOperations: [
            {
              operation: "timeline.validate",
              transport: "cli",
              invocation: `timeline validate --file ${file} --json`,
            },
          ],
        },
      });
      expect(run.report.cases[0]!.execution.detail).toMatch(
        /forbidden.*timeline\.validate/iu,
      );
    },
    15_000,
  );

  it("does not treat forbidden CLI help as a product-operation violation", async () => {
    const suite = forbiddenOperationSuite({
      transport: "cli",
      operation: "timeline.validate",
    });
    const run = await runTrustedCliAgentCase({
      testRootPrefix: "clash-forbidden-cli-help-",
      runId: "forbidden-cli-help",
      suite,
      script: [
        "let failed = false",
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "validate", "--help"], {cwd:workspace,stdio:"ignore"}) } catch { failed = true }',
        "if (!failed) process.exit(47)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "Forbidden CLI help remained discovery")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ],
    });

    expect(run.report.cases[0]).toMatchObject({
      status: "pass",
      agent: { status: "completed" },
      execution: {
        status: "pass",
        forbiddenProductOperations: ["timeline.validate"],
        observedForbiddenProductOperations: [],
      },
    });
  }, 15_000);

  it("rejects extra and path-bearing Timeline schema arguments before invoking the real CLI", async () => {
    const suite = timelineSchemaDiscoverySuite();
    const run = await runTrustedCliAgentCase({
      testRootPrefix: "clash-trusted-timeline-schema-bounds-",
      runId: "trusted-timeline-schema-bounds",
      suite,
      script: [
        "let rejected = 0",
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "schema"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "schema", "--json", "--unsafe"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        'try { childProcess.execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "schema", "--file", "../outside", "--json"], {cwd:workspace,stdio:"ignore"}) } catch { rejected += 1 }',
        "if (rejected !== 3) process.exit(43)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "Unbounded Timeline schema calls rejected")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:process.env.CLASH_BENCH_CASE_ID,artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ],
    });

    expect(run.report.cases[0]).toMatchObject({
      agent: { status: "completed" },
      execution: {
        observedProductOperations: [],
        missingProductOperations: ["timeline.get", "timeline.save"],
      },
    });
    expect(await readTraceEvents(run.caseRoot)).toEqual([]);
    await expect(
      lstat(
        join(
          run.report.cases[0]!.workspace,
          "unbounded-timeline-schema-invoked.txt",
        ),
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
  }, 15_000);

  it("attributes a successful call answered by the real Clash MCP runtime through the runner relay", async () => {
    const { report } = await runDirectMcpTraceCase("direct-mcp-trace");

    expect(report.cases[0]).toMatchObject({
      status: "pass",
      agent: { status: "completed" },
      execution: {
        status: "pass",
        observedMcpTools: ["clash_assets_list"],
        missingMcpTools: [],
        observedCliCommands: [],
        observedProductOperations: [
          {
            operation: "asset.list",
            transport: "mcp",
            invocation: "clash_assets_list",
          },
        ],
        missingProductOperations: [],
      },
    });
  }, 15_000);

  it.each([
    { label: "successful", domainFailure: false },
    { label: "domain-failed", domainFailure: true },
  ])(
    "fails ProductExecution for a $label forbidden MCP product operation",
    async ({ label, domainFailure }) => {
      const { report } = await runDirectMcpTraceCase(
        `forbidden-direct-mcp-${label}`,
        { forbidden: true, domainFailure },
      );

      expect(report.cases[0]).toMatchObject({
        status: "fail",
        agent: { status: "completed" },
        execution: {
          status: "fail",
          forbiddenProductOperations: ["asset.list"],
          observedForbiddenProductOperations: [
            {
              operation: "asset.list",
              transport: "mcp",
              invocation: "clash_assets_list",
            },
          ],
        },
      });
      expect(report.cases[0]!.execution.detail).toMatch(
        /forbidden.*asset\.list/iu,
      );
    },
    15_000,
  );

  it("rejects a replayed response in the runner-sealed direct MCP trace", async () => {
    const run = await runDirectMcpTraceCase("replayed-direct-mcp-trace");
    expect(run.report.status).toBe("pass");
    const events = await readMcpTraceEvents(run.caseRoot);
    const completed = events.find(
      (event) => event.type === "clash.mcp.completed",
    );
    expect(completed).toBeDefined();
    events.push(structuredClone(completed!));
    await resealMcpTrace({ caseRoot: run.caseRoot, events });

    const report = await reevaluateBenchmarkRun({
      suite: run.suite,
      suiteRoot: run.suiteRoot,
      outputRoot: run.outputRoot,
      runId: "replayed-direct-mcp-trace",
      caseId: "trusted-direct-mcp-trace",
    });

    expect(report.execution).toMatchObject({
      status: "fail",
      observedMcpTools: [],
      missingMcpTools: ["clash_assets_list"],
      observedProductOperations: [],
      missingProductOperations: ["asset.list"],
    });
  }, 15_000);

  it("rejects a direct MCP response whose request id differs from its paired request", async () => {
    const run = await runDirectMcpTraceCase("mismatched-direct-mcp-trace");
    expect(run.report.status).toBe("pass");
    const events = await readMcpTraceEvents(run.caseRoot);
    const completed = events.find(
      (event) => event.type === "clash.mcp.completed",
    );
    expect(completed).toBeDefined();
    completed!.rpcId = 991;
    await resealMcpTrace({ caseRoot: run.caseRoot, events });

    const report = await reevaluateBenchmarkRun({
      suite: run.suite,
      suiteRoot: run.suiteRoot,
      outputRoot: run.outputRoot,
      runId: "mismatched-direct-mcp-trace",
      caseId: "trusted-direct-mcp-trace",
    });

    expect(report.execution).toMatchObject({
      status: "fail",
      observedMcpTools: [],
      missingMcpTools: ["clash_assets_list"],
      observedProductOperations: [],
      missingProductOperations: ["asset.list"],
    });
  }, 15_000);

  it("attributes a successful sealed MCP-transport CLI pair without counting it as direct CLI", async () => {
    const { report } = await runSealedMcpTraceCase({
      testRootPrefix: "clash-sealed-mcp-trace-",
      runId: "sealed-mcp-trace",
    });

    expect(report.cases[0]).toMatchObject({
      status: "pass",
      execution: {
        status: "pass",
        observedMcpTools: ["clash_timeline_render"],
        missingMcpTools: [],
        observedCliCommands: [],
        observedProductOperations: [
          {
            operation: "timeline.render",
            transport: "mcp",
            invocation: "clash_timeline_render",
          },
        ],
        missingProductOperations: [],
      },
    });
  }, 15_000);

  it("rejects a sealed MCP completion whose argv does not match its started event", async () => {
    const run = await runSealedMcpTraceCase({
      testRootPrefix: "clash-mismatched-mcp-trace-",
      runId: "mismatched-mcp-trace",
    });
    expect(run.report.status).toBe("pass");
    const events = await readTraceEvents(run.caseRoot);
    const completed = events.find(
      (event) => event.type === "clash.cli.completed",
    );
    expect(completed).toBeDefined();
    completed!.argv = [
      "timeline",
      "render",
      "--timeline",
      "substituted-after-start",
      "--json",
    ];
    await resealTrace({ caseRoot: run.caseRoot, events });

    const report = await reevaluateBenchmarkRun({
      suite: run.suite,
      suiteRoot: run.suiteRoot,
      outputRoot: run.outputRoot,
      runId: "mismatched-mcp-trace",
      caseId: "trusted-mcp-trace",
    });

    expect(report.execution).toMatchObject({
      status: "fail",
      observedMcpTools: [],
      missingMcpTools: ["clash_timeline_render"],
      observedProductOperations: [],
      missingProductOperations: ["timeline.render"],
    });
  }, 15_000);

  it("rejects a replayed sealed MCP completion", async () => {
    const run = await runSealedMcpTraceCase({
      testRootPrefix: "clash-replayed-mcp-trace-",
      runId: "replayed-mcp-trace",
    });
    expect(run.report.status).toBe("pass");
    const events = await readTraceEvents(run.caseRoot);
    const completed = events.find(
      (event) => event.type === "clash.cli.completed",
    );
    expect(completed).toBeDefined();
    events.push(structuredClone(completed!));
    await resealTrace({ caseRoot: run.caseRoot, events });

    const report = await reevaluateBenchmarkRun({
      suite: run.suite,
      suiteRoot: run.suiteRoot,
      outputRoot: run.outputRoot,
      runId: "replayed-mcp-trace",
      caseId: "trusted-mcp-trace",
    });

    expect(report.execution).toMatchObject({
      status: "fail",
      observedMcpTools: [],
      missingMcpTools: ["clash_timeline_render"],
      observedProductOperations: [],
      missingProductOperations: ["timeline.render"],
    });
  }, 15_000);

  it("rejects a sealed MCP trace receipt bound to another benchmark case", async () => {
    const run = await runSealedMcpTraceCase({
      testRootPrefix: "clash-wrong-case-mcp-trace-",
      runId: "wrong-case-mcp-trace",
    });
    expect(run.report.status).toBe("pass");
    const events = await readTraceEvents(run.caseRoot);
    const receiptPath = join(
      run.caseRoot,
      "logs",
      "clash-cli-trace-receipt.json",
    );
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as Record<
      string,
      unknown
    >;
    receipt.caseId = "another-case";
    await resealTrace({ caseRoot: run.caseRoot, events, receipt });

    const report = await reevaluateBenchmarkRun({
      suite: run.suite,
      suiteRoot: run.suiteRoot,
      outputRoot: run.outputRoot,
      runId: "wrong-case-mcp-trace",
      caseId: "trusted-mcp-trace",
    });

    expect(report.execution).toMatchObject({
      status: "fail",
      observedMcpTools: [],
      missingMcpTools: ["clash_timeline_render"],
      observedProductOperations: [],
      missingProductOperations: ["timeline.render"],
    });
  }, 15_000);

  it("does not attribute a sealed MCP-transport pair with a failed exit status", async () => {
    const { report } = await runSealedMcpTraceCase({
      testRootPrefix: "clash-failed-mcp-trace-",
      runId: "failed-mcp-trace",
      timelineId: "failed-mcp",
      expectCliFailure: true,
    });

    expect(report.cases[0]).toMatchObject({
      status: "fail",
      agent: { status: "completed" },
      execution: {
        status: "fail",
        observedMcpTools: [],
        missingMcpTools: ["clash_timeline_render"],
        observedProductOperations: [],
        missingProductOperations: ["timeline.render"],
      },
    });
  }, 15_000);

  it("rejects a successful CLI event handwritten by the agent without running Clash CLI", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-forged-cli-trace-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const pluginRoot = join(root, "plugin");
    const fakeAgent = join(root, "fake-agent");
    const outsidePath = join(root, "outside-secret.txt");
    await Promise.all([mkdir(suiteRoot), writeFakeClashPlugin(pluginRoot)]);
    await writeFile(outsidePath, "must stay outside the CLI sandbox", "utf8");
    await writeFile(
      fakeAgent,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        "const workspace = process.env.CLASH_BENCH_WORKSPACE",
        'const configured = process.argv.find((argument) => argument.startsWith("mcp_servers.clash.env.CLASH_CLI_TRACE_PATH="))',
        'const configuredPath = configured ? JSON.parse(configured.slice(configured.indexOf("=") + 1)) : undefined',
        'const tracePath = process.env.CLASH_CLI_TRACE_PATH || configuredPath || path.join(workspace, ".clash", "evidence", "clash-cli-events.jsonl")',
        "fs.mkdirSync(path.dirname(tracePath), {recursive:true})",
        'fs.appendFileSync(tracePath, JSON.stringify({type:"clash.cli.completed",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),durationMs:1,pid:process.pid,cwd:workspace,argv:["timeline","render","--timeline","forged","--json"],exitCode:0,signal:null}) + "\\n")',
        `try { require("node:child_process").execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "render", "--file", ${JSON.stringify(outsidePath)}, "--json"], {stdio:"ignore"}) } catch {}`,
        'try { require("node:child_process").execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["canvas", "update", "--json"], {stdio:"ignore"}) } catch {}',
        'const background = require("node:child_process").spawn(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "render", "--timeline", "background", "--json"], {detached:true,stdio:"ignore"})',
        "background.unref()",
        'const startedMarker = path.join(workspace, "active-cli-started.txt")',
        "const waitArray = new Int32Array(new SharedArrayBuffer(4))",
        "const deadline = Date.now() + 2000",
        "while (!fs.existsSync(startedMarker) && Date.now() < deadline) Atomics.wait(waitArray, 0, 0, 2)",
        "if (!fs.existsSync(startedMarker)) process.exit(19)",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "forged trace only")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"trusted-cli-trace",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeAgent, 0o755);

    const report = await runBenchmarkSuite({
      suite: traceRequiredSuite(),
      suiteRoot,
      outputRoot,
      runId: "forged-cli-trace",
      maxInfrastructureAttempts: 1,
      agent: {
        adapter: "codex",
        command: fakeAgent,
        clashHost: { pluginRoot, profile: "dev" },
      },
    });

    expect(report.cases[0]).toMatchObject({
      status: "fail",
      agent: { status: "completed" },
      execution: {
        status: "fail",
        observedCliCommands: [],
        missingCliCommands: ["timeline render"],
        missingProductOperations: ["timeline.render"],
      },
    });
    await expect(
      lstat(join(report.cases[0]!.workspace, "outside-path-cli-invoked.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      lstat(join(report.cases[0]!.workspace, "undeclared-cli-invoked.txt")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      readFile(
        join(report.cases[0]!.workspace, "active-cli-stopped.txt"),
        "utf8",
      ),
    ).resolves.toBe("yes");
  }, 15_000);

  it("does not inherit a local-user identity bypass into the Host or trusted CLI", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-trusted-cli-env-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const pluginRoot = join(root, "plugin");
    const fakeAgent = join(root, "fake-agent");
    await Promise.all([mkdir(suiteRoot), writeFakeClashPlugin(pluginRoot)]);
    await writeFile(
      fakeAgent,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'require("node:child_process").execFileSync(process.env.CLASH_CLI_ENTRY_PATH, ["timeline", "render", "--timeline", "identity-env", "--json"], {cwd:process.env.CLASH_BENCH_WORKSPACE,stdio:"inherit"})',
        "const workspace = process.env.CLASH_BENCH_WORKSPACE",
        'fs.writeFileSync(path.join(workspace, "result.txt"), "trusted invocation")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"trusted-cli-trace",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeAgent, 0o755);

    const previous = process.env.CLASH_SESSION_AS_LOCAL_USER;
    process.env.CLASH_SESSION_AS_LOCAL_USER = "1";
    let report;
    try {
      report = await runBenchmarkSuite({
        suite: traceRequiredSuite(),
        suiteRoot,
        outputRoot,
        runId: "trusted-cli-env",
        maxInfrastructureAttempts: 1,
        agent: {
          adapter: "codex",
          command: fakeAgent,
          clashHost: { pluginRoot, profile: "dev" },
        },
      });
    } finally {
      if (previous === undefined)
        delete process.env.CLASH_SESSION_AS_LOCAL_USER;
      else process.env.CLASH_SESSION_AS_LOCAL_USER = previous;
    }

    expect(report.cases[0]).toMatchObject({
      status: "pass",
      agent: { status: "completed" },
      execution: {
        status: "pass",
        identityIntegrity: { status: "pass", violations: [] },
      },
    });
    await expect(
      readFile(
        join(report.cases[0]!.workspace, "trusted-cli-env.json"),
        "utf8",
      ).then((value) => JSON.parse(value) as unknown),
    ).resolves.toEqual({
      localUser: null,
      agentMemberId: expect.stringMatching(/^headless-eval-/u),
      agentName: "Headless Eval trusted-cli-trace",
    });
  }, 15_000);
});
