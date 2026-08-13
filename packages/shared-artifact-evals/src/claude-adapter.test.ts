import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createClaudeAgentAdapter, runBenchmarkSuite } from "./runner";

const execFileAsync = promisify(execFile);

describe("Claude Code headless adapter", () => {
  it("constructs a first-class Claude agent without changing the Codex default", () => {
    expect(createClaudeAgentAdapter({ model: "sonnet" })).toEqual({
      adapter: "claude",
      model: "sonnet",
    });
  });

  it("advertises Claude as a supported CLI adapter", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--help"],
      { cwd: new URL("..", import.meta.url) },
    );

    expect(stdout).toContain("--agent codex|claude|pi|command");
    expect(stdout).toContain("Agent model override");
  });

  it("runs Claude in print mode with discoverable skills and captures stream-json", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-claude-adapter-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const skillRoot = join(suiteRoot, "skills", "test-skill");
    const fakeClaude = join(root, "fake-claude");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: test-skill\ndescription: Test skill\n---\nUse this skill.\n",
      "utf8",
    );
    await writeFile(
      fakeClaude,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const workspace = process.env.CLASH_BENCH_WORKSPACE',
        'fs.writeFileSync(path.join(workspace, "claude-observation.json"), JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),home:process.env.HOME,initCwd:process.env.INIT_CWD,skill:fs.existsSync(path.join(workspace, ".claude", "skills", "test-skill", "SKILL.md")),sharedSkill:fs.existsSync(path.join(workspace, ".agents", "skills", "test-skill", "SKILL.md")),promptPath:process.env.CLASH_BENCH_PROMPT_PATH}))',
        'fs.writeFileSync(path.join(workspace, "result.txt"), "claude artifact")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"claude-portable",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        'process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,num_turns:2,result:"done",usage:{input_tokens:31,cache_read_input_tokens:7,output_tokens:11}}) + "\\n")',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeClaude, 0o755);

    const report = await runBenchmarkSuite({
      suite: {
        schemaVersion: 1,
        id: "claude-suite",
        title: "Claude suite",
        cases: [
          {
            id: "claude-portable",
            title: "Claude portable",
            category: "timeline",
            outcome: {
              objective: "Create a report through Claude Code.",
              acceptanceCriteria: ["The report exists."],
              deliverables: [
                { artifactId: "result", kind: "report", description: "Result" },
              ],
            },
            passScore: 100,
            timeoutMs: 10_000,
            skills: ["skills/test-skill"],
            rubric: [
              {
                id: "result",
                type: "artifact-exists",
                artifactId: "result",
                weight: 1,
                required: true,
              },
            ],
          },
        ],
      },
      suiteRoot,
      outputRoot,
      runId: "claude-run",
      agent: createClaudeAgentAdapter({ command: fakeClaude }),
    });

    expect(report.status).toBe("pass");
    const workspace = report.cases[0]!.workspace;
    const caseRoot = dirname(workspace);
    const observation = JSON.parse(
      await readFile(join(workspace, "claude-observation.json"), "utf8"),
    ) as {
      argv: string[];
      cwd: string;
      home?: string;
      initCwd?: string;
      skill: boolean;
      sharedSkill: boolean;
      promptPath: string;
    };
    expect(observation.cwd).not.toBe(workspace);
    expect(observation.skill).toBe(true);
    expect(observation.sharedSkill).toBe(true);
    expect(observation.initCwd).toBeUndefined();
    expect(observation.promptPath).toBe(join(observation.cwd, "OUTCOME.md"));
    expect(observation.argv).toEqual(expect.arrayContaining([
      "--print",
      "--verbose",
      "--no-session-persistence",
      "--output-format",
      "stream-json",
      "--permission-mode",
      "dontAsk",
      "--setting-sources",
      "project,local",
    ]));
    expect(observation.argv).not.toContain("--dangerously-skip-permissions");
    expect(observation.argv.at(-1)).toContain("Create a report through Claude Code.");
    expect(report.cases[0]?.agent.stdoutPath).toBe(
      join(caseRoot, "logs", "events.jsonl"),
    );
    const trajectory = JSON.parse(
      await readFile(join(caseRoot, "logs", "trajectory.json"), "utf8"),
    ) as {
      sourceTraces: Array<{ kind: string }>;
      turns: Array<{ status: string }>;
      usage: Record<string, number>;
      summary: { turnCount: number };
    };
    expect(trajectory.sourceTraces).toContainEqual(
      expect.objectContaining({ kind: "claude-events" }),
    );
    expect(trajectory.turns).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
    expect(trajectory.usage).toMatchObject({
      turnCount: 2,
      inputTokens: 31,
      cachedInputTokens: 7,
      outputTokens: 11,
    });
    expect(trajectory.summary.turnCount).toBe(2);
  });

  it("treats a Claude result error as an agent failure even when the CLI exits zero", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-claude-result-error-"));
    const suiteRoot = join(root, "suite");
    const fakeClaude = join(root, "fake-claude");
    await mkdir(suiteRoot);
    await writeFile(
      fakeClaude,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const workspace = process.env.CLASH_BENCH_WORKSPACE',
        'fs.writeFileSync(path.join(workspace, "result.txt"), "untrusted")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"claude-error",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        'process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:true,num_turns:1,result:"Invalid API key",total_cost_usd:0,usage:{input_tokens:0,cache_read_input_tokens:0,output_tokens:0}}) + "\\n")',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeClaude, 0o755);

    const report = await runBenchmarkSuite({
      suite: {
        schemaVersion: 1,
        id: "claude-error-suite",
        title: "Claude error suite",
        cases: [
          {
            id: "claude-error",
            title: "Claude error",
            category: "timeline",
            outcome: {
              objective: "Create a report.",
              acceptanceCriteria: ["The report exists."],
              deliverables: [
                { artifactId: "result", kind: "report", description: "Result" },
              ],
            },
            passScore: 100,
            timeoutMs: 10_000,
            skills: [],
            rubric: [
              {
                id: "result",
                type: "artifact-exists",
                artifactId: "result",
                weight: 1,
                required: true,
              },
            ],
          },
        ],
      },
      suiteRoot,
      outputRoot: join(root, "runs"),
      runId: "claude-error-run",
      agent: createClaudeAgentAdapter({ command: fakeClaude }),
    });

    expect(report.status).toBe("fail");
    expect(report.cases[0]?.agent).toMatchObject({
      status: "failed",
      exitCode: 0,
      error: "Invalid API key",
    });
  });

  it("verifies the Project Host first and binds the Clash stdio MCP server", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-claude-host-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const pluginRoot = join(root, "plugin");
    const runtimeRoot = join(pluginRoot, "runtime");
    const fakeClaude = join(root, "fake-claude");
    await Promise.all([
      mkdir(suiteRoot),
      mkdir(runtimeRoot, { recursive: true }),
    ]);
    await writeFile(join(runtimeRoot, "index.js"), "// fake MCP runtime\n", "utf8");
    await writeFile(
      join(runtimeRoot, "local-api.cjs"),
      [
        'const fs = require("node:fs")',
        'const http = require("node:http")',
        'const net = require("node:net")',
        'const path = require("node:path")',
        'const runDir = process.env.CLASH_HOST_RUN_DIR',
        'const discovery = path.join(runDir, "host.json")',
        'const pluginSocket = process.env.CLASH_PLUGIN_HOST_SOCKET || path.join(process.env.CLASH_HOME, "sockets", "plugin-host.sock")',
        'fs.mkdirSync(path.dirname(pluginSocket), {recursive:true})',
        'fs.mkdirSync(runDir, {recursive:true})',
        'fs.rmSync(pluginSocket, {force:true})',
        'const ipc = net.createServer((socket) => socket.end())',
        'ipc.listen(pluginSocket)',
        'const server = http.createServer((request, response) => { const chunks = []; request.on("data", (chunk) => chunks.push(chunk)); request.on("end", () => { let body = {}; if (request.method === "POST" && /\\/api\\/v1\\/projects\\/[^/]+\\/host-command$/.test(request.url || "")) { const command = JSON.parse(Buffer.concat(chunks).toString("utf8")); body = command.action === "ping" ? {pong:true} : {error:"unsupported"} } response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)) }) })',
        'server.listen(0, "127.0.0.1", () => { const port = server.address().port; fs.writeFileSync(discovery, JSON.stringify({endpoint:"http://127.0.0.1:" + port,pid:process.pid,profile:process.env.CLASH_PROFILE,launchMode:"user-service",startedBy:"plugin",agentCliPath:process.env.CLASH_CLI_ENTRY_PATH})) })',
        'process.on("SIGTERM", () => { server.close(); ipc.close(); fs.rmSync(discovery, {force:true}); fs.rmSync(pluginSocket, {force:true}); process.exit(0) })',
      ].join("\n"),
      "utf8",
    );
    const fakeClashCli = join(runtimeRoot, "clash-cli.cjs");
    await writeFile(
      fakeClashCli,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const argv = process.argv.slice(2)',
        'const marker = path.join(process.cwd(), ".clash", "project.toml")',
        'if (argv[0] === "init") { const projectId = argv[argv.indexOf("--project") + 1]; fs.mkdirSync(path.dirname(marker), {recursive:true}); fs.writeFileSync(marker, "schema_version = 1\\nproject_id = " + JSON.stringify(projectId) + "\\nworkspace_id = \\"managed:claude\\"\\nstore = \\"managed\\"\\n"); process.stdout.write(JSON.stringify({projectId,markerPath:marker,workspaceId:"managed:claude",reused:false}) + "\\n"); process.exit(0) }',
        'if (!fs.existsSync(marker)) process.exit(43)',
        'process.exit(2)',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeClashCli, 0o755);
    await writeFile(
      fakeClaude,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const workspace = process.env.CLASH_BENCH_WORKSPACE',
        'const argv = process.argv.slice(2)',
        'const configIndex = argv.indexOf("--mcp-config")',
        'const config = configIndex >= 0 ? JSON.parse(argv[configIndex + 1]) : null',
        'const readyPath = path.join(workspace, ".clash", "headless-host-ready.json")',
        'if (!fs.existsSync(readyPath)) process.exit(71)',
        'fs.writeFileSync(path.join(workspace, "claude-host-observation.json"), JSON.stringify({argv,config,ready:JSON.parse(fs.readFileSync(readyPath,"utf8")),env:{CLASH_PROFILE:process.env.CLASH_PROFILE,CLASH_HOME:process.env.CLASH_HOME,CLASH_API_URL:process.env.CLASH_API_URL,CLASH_WORKSPACE_ROOT:process.env.CLASH_WORKSPACE_ROOT,CLASH_AGENT_MEMBER_ID:process.env.CLASH_AGENT_MEMBER_ID,CLASH_AGENT_NAME:process.env.CLASH_AGENT_NAME}}))',
        'fs.writeFileSync(path.join(workspace, "result.txt"), "host artifact")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"claude-host",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        'process.stdout.write(JSON.stringify({type:"system",subtype:"init",cwd:process.cwd(),tools:["mcp__clash__clash_composition"]}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"assistant",message:{role:"assistant",content:[{type:"tool_use",id:"toolu_1",name:"mcp__clash__clash_composition",input:{kind:"director-stage",operation:"clash_director_create",arguments:{stageId:"stage"}}}]}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"user",message:{role:"user",content:[{type:"tool_result",tool_use_id:"toolu_1",is_error:false,content:[{type:"text",text:"created"}]}]}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"result",subtype:"success",is_error:false,num_turns:1,result:"done",usage:{input_tokens:10,cache_read_input_tokens:2,output_tokens:3}}) + "\\n")',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakeClaude, 0o755);

    const report = await runBenchmarkSuite({
      suite: {
        schemaVersion: 1,
        id: "claude-host-suite",
        title: "Claude host suite",
        cases: [
          {
            id: "claude-host",
            title: "Claude host",
            category: "director",
            outcome: {
              objective: "Create a report after the Clash Project Host is ready.",
              acceptanceCriteria: ["The report is persisted."],
              deliverables: [
                { artifactId: "result", kind: "report", description: "Result" },
              ],
            },
            passScore: 100,
            timeoutMs: 10_000,
            skills: [],
            execution: {
              profile: "clash-host",
              requiredProductOperations: ["director.create"],
              requiredMcpTools: ["clash_director_create"],
            },
            rubric: [
              {
                id: "result",
                type: "artifact-exists",
                artifactId: "result",
                weight: 1,
                required: true,
              },
            ],
          },
        ],
      },
      suiteRoot,
      outputRoot,
      runId: "claude-host-run",
      maxInfrastructureAttempts: 1,
      agent: createClaudeAgentAdapter({
        command: fakeClaude,
        clashHost: { pluginRoot, profile: "dev" },
      }),
    });

    expect(report.status).toBe("pass");
    expect(report.cases[0]?.execution).toMatchObject({
      status: "pass",
      observedMcpTools: ["clash_director_create"],
      missingMcpTools: [],
      missingProductOperations: [],
    });
    const workspace = report.cases[0]!.workspace;
    const observation = JSON.parse(
      await readFile(join(workspace, "claude-host-observation.json"), "utf8"),
    ) as {
      argv: string[];
      config: {
        mcpServers: {
          clash: { command: string; args: string[]; cwd: string; env: Record<string, string> };
        };
      };
      ready: { status: string; projectId: string };
      env: Record<string, string>;
    };
    expect(observation.ready.status).toBe("ready");
    expect(observation.argv).toContain("--strict-mcp-config");
    expect(observation.argv.at(-2)).toBe("--");
    expect(observation.argv.at(-1)).toContain(
      "Create a report after the Clash Project Host is ready.",
    );
    const resolvedPluginRoot = await realpath(pluginRoot);
    expect(observation.config.mcpServers.clash).toMatchObject({
      command: process.execPath,
      args: [join(resolvedPluginRoot, "runtime", "index.js")],
      cwd: resolvedPluginRoot,
      env: {
        CLASH_PROFILE: "dev",
        CLASH_WORKSPACE_ROOT: observation.env.CLASH_WORKSPACE_ROOT,
        CLASH_AGENT_MEMBER_ID: observation.env.CLASH_AGENT_MEMBER_ID,
        CLASH_AGENT_NAME: observation.env.CLASH_AGENT_NAME,
      },
    });
    expect(observation.env.CLASH_WORKSPACE_ROOT).toBeDefined();
    expect(observation.env.CLASH_API_URL).toMatch(/^http:\/\/127\.0\.0\.1:/u);
    expect(observation.config.mcpServers.clash.env.CLASH_HOME).toBe(
      observation.env.CLASH_HOME,
    );
    const trajectory = JSON.parse(
      await readFile(join(dirname(workspace), "logs", "trajectory.json"), "utf8"),
    ) as { actions: Array<{ kind: string; operation: string; status: string }> };
    expect(trajectory.actions.filter(({ kind }) => kind === "mcp")).toEqual([
      expect.objectContaining({
        operation: "clash/clash_director_create",
        status: "started",
      }),
      expect.objectContaining({
        operation: "clash/clash_director_create",
        status: "succeeded",
      }),
    ]);
  });
});
