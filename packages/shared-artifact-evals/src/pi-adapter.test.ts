import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { createPiAgentAdapter, runBenchmarkSuite } from "./runner";

const execFileAsync = promisify(execFile);

describe("Pi headless adapter", () => {
  it("constructs a first-class Pi agent", () => {
    expect(createPiAgentAdapter({
      model: "anthropic-proxy/claude-sonnet-5",
      skills: ["/tmp/remotion-best-practices"],
    })).toEqual({
      adapter: "pi",
      model: "anthropic-proxy/claude-sonnet-5",
      skills: ["/tmp/remotion-best-practices"],
    });
  });

  it("advertises Pi as a supported CLI adapter", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["--import", "tsx", "src/cli.ts", "--help"],
      { cwd: new URL("..", import.meta.url) },
    );

    expect(stdout).toContain("--agent codex|claude|pi|command");
    expect(stdout).toContain("--agent-skill <path>");
  });

  it("runs Pi in isolated JSON print mode with discoverable skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-pi-adapter-"));
    const suiteRoot = join(root, "suite");
    const outputRoot = join(root, "runs");
    const skillRoot = join(suiteRoot, "skills", "test-skill");
    const externalSkillRoot = join(root, "remotion-best-practices");
    const fakePi = join(root, "fake-pi");
    await mkdir(skillRoot, { recursive: true });
    await mkdir(externalSkillRoot, { recursive: true });
    await writeFile(
      join(skillRoot, "SKILL.md"),
      "---\nname: test-skill\ndescription: Test skill\n---\nUse this skill.\n",
      "utf8",
    );
    await writeFile(
      join(externalSkillRoot, "SKILL.md"),
      "---\nname: remotion-best-practices\ndescription: Remotion guidance\n---\nUse this skill.\n",
      "utf8",
    );
    await writeFile(
      fakePi,
      [
        `#!${process.execPath}`,
        'const fs = require("node:fs")',
        'const path = require("node:path")',
        'const workspace = process.env.CLASH_BENCH_WORKSPACE',
        'const redundantPayload = "REDUNDANT_MESSAGE_PAYLOAD".repeat(1000)',
        'fs.writeFileSync(path.join(workspace, "pi-observation.json"), JSON.stringify({argv:process.argv.slice(2),cwd:process.cwd(),skill:fs.existsSync(path.join(workspace, ".agents", "skills", "test-skill", "SKILL.md")),externalSkill:fs.existsSync(path.join(workspace, ".agents", "skills", "remotion-best-practices", "SKILL.md")),promptPath:process.env.CLASH_BENCH_PROMPT_PATH,prompt:fs.readFileSync(process.env.CLASH_BENCH_PROMPT_PATH,"utf8")}))',
        'fs.writeFileSync(path.join(workspace, "result.txt"), "pi artifact")',
        'fs.writeFileSync(path.join(workspace, "submission.json"), JSON.stringify({schemaVersion:1,taskId:"pi-portable",artifacts:[{id:"result",kind:"report",path:"result.txt"}]}))',
        'process.stdout.write(JSON.stringify({type:"session",version:3,id:"pi-test",timestamp:new Date().toISOString(),cwd:process.cwd()}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"message_start",message:{role:"assistant",content:[{type:"thinking",thinking:redundantPayload}],provider:"test-provider",model:"test-model",usage:{input:1,output:2}}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"message_update",assistantMessageEvent:{type:"toolcall_delta",delta:"x",partial:{content:[{type:"toolCall",arguments:{source:"x".repeat(20000)}}]}},message:{content:[{type:"toolCall",arguments:{source:"x".repeat(20000)}}]}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"thinking",thinking:redundantPayload}],provider:"test-provider",model:"test-model",usage:{input:1,output:2}}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"tool_execution_start",toolCallId:"bash-1",toolName:"bash",args:{command:"printf ok"}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"tool_execution_update",toolCallId:"bash-1",toolName:"bash",partialResult:{content:[{type:"text",text:redundantPayload}]}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"tool_execution_end",toolCallId:"bash-1",toolName:"bash",result:{content:[{type:"text",text:"ok"}]},isError:false}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"tool_execution_start",toolCallId:"clash-1",toolName:"clash_composition",args:{kind:"timeline",operation:"clash_timeline_create",arguments:{timelineId:"timeline"}}}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"tool_execution_end",toolCallId:"clash-1",toolName:"clash_composition",result:{content:[{type:"text",text:"created"}]},isError:false}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"turn_end",message:{role:"assistant",content:[{type:"thinking",thinking:redundantPayload}],usage:{input:31,cacheRead:7,output:11}},toolResults:[]}) + "\\n")',
        'process.stdout.write(JSON.stringify({type:"agent_end",messages:[{role:"assistant",content:[{type:"thinking",thinking:redundantPayload}]}]}) + "\\n")',
        'fs.mkdirSync(path.dirname(process.env.TEST_CLI_TRACE_PATH), {recursive:true})',
        'const largeCliArg = "x".repeat(1024)',
        'fs.appendFileSync(process.env.TEST_CLI_TRACE_PATH, JSON.stringify({type:"clash.cli.started",startedAt:new Date().toISOString(),pid:410,parentPid:409,cwd:workspace,argv:["canvas","update","--node","node-1","--content",largeCliArg,"--json"],origin:null}) + "\\n")',
        'fs.appendFileSync(process.env.TEST_CLI_TRACE_PATH, JSON.stringify({type:"clash.cli.completed",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),durationMs:1,pid:410,parentPid:409,cwd:workspace,argv:["canvas","update","--node","node-1","--content",largeCliArg,"--json"],exitCode:0,signal:null,origin:null}) + "\\n")',
        'fs.appendFileSync(process.env.TEST_CLI_TRACE_PATH, JSON.stringify({type:"clash.cli.started",startedAt:new Date().toISOString(),pid:412,parentPid:411,cwd:workspace,argv:["timeline","create","--timeline","timeline","--json"],origin:"mcp-transport"}) + "\\n")',
        'fs.appendFileSync(process.env.TEST_CLI_TRACE_PATH, JSON.stringify({type:"clash.cli.completed",startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),durationMs:1,pid:412,parentPid:411,cwd:workspace,argv:["timeline","create","--timeline","timeline","--json"],exitCode:0,signal:null,origin:"mcp-transport"}) + "\\n")',
      ].join("\n"),
      "utf8",
    );
    await chmod(fakePi, 0o755);

    const report = await runBenchmarkSuite({
      suite: {
        schemaVersion: 1,
        id: "pi-suite",
        title: "Pi suite",
        cases: [
          {
            id: "pi-portable",
            title: "Pi portable",
            category: "timeline",
            outcome: {
              objective: "Create a report through Pi.",
              acceptanceCriteria: ["The report exists."],
              deliverables: [
                { artifactId: "result", kind: "report", description: "Result" },
              ],
            },
            passScore: 100,
            timeoutMs: 10_000,
            skills: ["skills/test-skill"],
            execution: {
              profile: "clash-host",
              requiredProductOperations: ["timeline.create"],
              requiredMcpTools: ["clash_timeline_create"],
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
      runId: "pi-run",
      agent: createPiAgentAdapter({
        command: fakePi,
        skills: [externalSkillRoot],
        env: {
          TEST_CLI_TRACE_PATH: join(
            outputRoot,
            "pi-run",
            "pi-portable",
            "logs",
            "clash-cli-events.jsonl",
          ),
        },
      }),
    });

    expect(report.status, JSON.stringify(report, null, 2)).toBe("pass");
    expect(report.cases[0]?.execution).toMatchObject({
      status: "pass",
      observedProductOperations: [
        {
          operation: "timeline.create",
          transport: "mcp",
          invocation: "clash_timeline_create",
        },
      ],
      observedMcpTools: ["clash_timeline_create"],
      missingProductOperations: [],
      missingMcpTools: [],
      observedCliCommands: [
        "canvas update --node node-1 --content <arg:1024B sha256:49abd65bbf7f7e40c7055093ed2e3fd75f2f602f2c5fcf955c213e3135eb03f7> --json",
      ],
    });
    expect(report.cases[0]?.execution?.detail).not.toMatch(/0 required/u);
    const workspace = report.cases[0]!.workspace;
    const caseRoot = dirname(workspace);
    const observation = JSON.parse(
      await readFile(join(workspace, "pi-observation.json"), "utf8"),
    ) as {
      argv: string[];
      cwd: string;
      skill: boolean;
      externalSkill: boolean;
      promptPath: string;
      prompt: string;
    };
    expect(observation.cwd).not.toBe(workspace);
    expect(observation.cwd).toMatch(/clash-benchmark-workspace-/u);
    expect(observation.skill).toBe(true);
    expect(observation.externalSkill).toBe(true);
    expect(observation.promptPath).toBe(join(observation.cwd, "OUTCOME.md"));
    expect(observation.prompt).toContain("`remotion-best-practices`");
    expect(observation.prompt).toContain(
      `\`${join(observation.cwd, ".agents", "skills", "remotion-best-practices", "SKILL.md")}\``,
    );
    expect(observation.argv).toEqual(expect.arrayContaining([
      "--print",
      "--mode",
      "json",
      "--no-session",
      "--no-extensions",
      "--no-skills",
      "--no-context-files",
      "--approve",
      "--thinking",
      "medium",
    ]));
    const skillPaths = observation.argv.flatMap((value, index) =>
      value === "--skill" ? [observation.argv[index + 1]] : [],
    );
    expect(skillPaths).toEqual([
      join(observation.cwd, ".agents", "skills"),
    ]);
    expect(observation.argv.at(-1)).toContain("Create a report through Pi.");
    expect(report.cases[0]?.agent.stdoutPath).toBe(
      join(caseRoot, "logs", "events.jsonl"),
    );
    const recordedEvents = (await readFile(
      join(caseRoot, "logs", "events.jsonl"),
      "utf8",
    ))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(recordedEvents.some(({ type }) => type === "message_update")).toBe(
      false,
    );
    expect(
      recordedEvents.some(({ type }) => type === "tool_execution_update"),
    ).toBe(false);
    expect(JSON.stringify(recordedEvents)).not.toContain(
      "REDUNDANT_MESSAGE_PAYLOAD",
    );
    expect(recordedEvents).toContainEqual(expect.objectContaining({
      schemaVersion: 1,
      type: "benchmark.capture.compacted",
      droppedEventTypes: { message_update: 1, tool_execution_update: 1 },
      projectedEventTypes: {
        message_start: 1,
        message_end: 1,
        turn_end: 1,
        agent_end: 1,
      },
      droppedBytes: expect.any(Number),
      projectedBytesSaved: expect.any(Number),
    }));
    expect(recordedEvents).toContainEqual(expect.objectContaining({
      type: "message_end",
      message: expect.objectContaining({
        role: "assistant",
        provider: "test-provider",
        model: "test-model",
        contentSummary: [
          { type: "thinking", characterCount: 25_000 },
        ],
      }),
    }));
    expect(recordedEvents.map(({ type }) => type).filter(Boolean)).toEqual(
      expect.arrayContaining([
        "session",
        "tool_execution_start",
        "tool_execution_end",
        "turn_end",
        "agent_end",
      ]),
    );
    const trajectory = JSON.parse(
      await readFile(join(caseRoot, "logs", "trajectory.json"), "utf8"),
    ) as {
      sourceTraces: Array<{ kind: string }>;
      actions: Array<{ source: string; kind: string; status: string }>;
      usage: Record<string, number>;
    };
    expect(trajectory.sourceTraces).toContainEqual(
      expect.objectContaining({ kind: "pi-events" }),
    );
    expect(trajectory.actions).toEqual([
      expect.objectContaining({
        source: "clash-cli",
        kind: "cli",
        operation: "canvas update",
        status: "started",
      }),
      expect.objectContaining({
        source: "clash-cli",
        kind: "cli",
        operation: "canvas update",
        status: "succeeded",
      }),
      expect.objectContaining({ source: "pi", kind: "shell", status: "started" }),
      expect.objectContaining({ source: "pi", kind: "shell", status: "succeeded" }),
      expect.objectContaining({
        source: "pi",
        kind: "mcp",
        operation: "clash/clash_timeline_create",
        status: "started",
      }),
      expect.objectContaining({
        source: "pi",
        kind: "mcp",
        operation: "clash/clash_timeline_create",
        status: "succeeded",
      }),
    ]);
    expect(trajectory.usage).toMatchObject({
      turnCount: 1,
      inputTokens: 31,
      cachedInputTokens: 7,
      outputTokens: 11,
    });
  });
});
