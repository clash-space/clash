import { createHash } from "node:crypto";
import {
  link,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  projectCodexAtifTrajectory,
  writeCodexAtifTrajectory,
  type CodexAtifInput,
} from "./atif";
import {
  projectAtifTrajectory,
  writeAtifTrajectory,
  type AtifProjectionInput,
} from "./index";

function jsonl(events: unknown[]): string {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function exactCodexEvents(): string {
  return jsonl([
    { type: "thread.started", thread_id: "codex-session-001" },
    { type: "turn.started" },
    {
      type: "item.completed",
      item: {
        id: "reasoning-1",
        type: "reasoning",
        text: "PRIVATE_REASONING_MUST_NOT_BE_RETAINED",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "message-1",
        type: "agent_message",
        text: "I will inspect the Stage and render it.",
      },
    },
    {
      type: "item.started",
      item: {
        id: "mcp-1",
        type: "mcp_tool_call",
        server: "clash",
        tool: "clash_director_get",
        arguments: { stageId: "hero-stage" },
        status: "in_progress",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "mcp-1",
        type: "mcp_tool_call",
        server: "clash",
        tool: "clash_director_get",
        arguments: { stageId: "hero-stage" },
        result: {
          content: [{ type: "text", text: "Stage ready" }],
          structured_content: { id: "hero-stage", revision: "rev-2" },
        },
        status: "completed",
      },
    },
    {
      type: "item.started",
      item: {
        id: "command-1",
        type: "command_execution",
        command: "pwd",
        aggregated_output: "",
        status: "in_progress",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "command-1",
        type: "command_execution",
        command: "pwd",
        aggregated_output: "workspace\n",
        exit_code: 0,
        status: "completed",
      },
    },
    {
      type: "turn.completed",
      usage: {
        input_tokens: 120,
        cached_input_tokens: 20,
        cache_write_input_tokens: 3,
        output_tokens: 30,
        reasoning_output_tokens: 5,
      },
    },
  ]);
}

function exactPiEvents(): string {
  return jsonl([
    {
      type: "session",
      version: 3,
      id: "pi-session-001",
      timestamp: "2026-08-15T08:00:00.000Z",
      cwd: "/private/pi-workspace",
    },
    { type: "agent_start" },
    { type: "turn_start" },
    {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        delta: "PRIVATE_PI_REASONING_MUST_NOT_BE_RETAINED",
      },
      message: {
        role: "assistant",
        content: [
          {
            type: "thinking",
            thinking: "PRIVATE_PI_REASONING_MUST_NOT_BE_RETAINED",
          },
        ],
      },
    },
    {
      type: "tool_execution_start",
      toolCallId: "pi-call-1",
      toolName: "clash_composition",
      args: {
        kind: "timeline",
        operation: "clash_timeline_get",
        arguments: { timelineId: "timeline-main" },
      },
    },
    {
      type: "tool_execution_end",
      toolCallId: "pi-call-1",
      toolName: "clash_composition",
      result: {
        content: [{ type: "text", text: "Timeline ready" }],
        details: { revisionId: "timeline-revision-2" },
      },
      isError: false,
    },
    {
      type: "turn_end",
      message: {
        role: "assistant",
        provider: "test-provider",
        model: "test-model",
        content: [
          {
            type: "thinking",
            thinking: "PRIVATE_PI_REASONING_MUST_NOT_BE_RETAINED",
            thinkingSignature: "PRIVATE_PI_SIGNATURE_MUST_NOT_BE_RETAINED",
          },
          { type: "text", text: "I inspected the Timeline." },
          {
            type: "toolCall",
            id: "pi-call-1",
            name: "clash_composition",
            arguments: {
              kind: "timeline",
              operation: "clash_timeline_get",
              arguments: { timelineId: "timeline-main" },
            },
          },
        ],
        usage: {
          input: 41,
          cacheRead: 7,
          cacheWrite: 3,
          output: 13,
          reasoning: 5,
          totalTokens: 69,
        },
      },
      toolResults: [],
    },
    {
      type: "agent_end",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "thinking",
              thinking: "PRIVATE_PI_REASONING_MUST_NOT_BE_RETAINED",
            },
          ],
        },
      ],
      willRetry: false,
    },
    { type: "agent_settled" },
  ]);
}

function input(
  source: CodexAtifInput["source"] = {
    kind: "text",
    text: exactCodexEvents(),
  },
): CodexAtifInput {
  return {
    adapter: "codex",
    publicPrompt: "Create and render the requested Clash Stage.",
    source,
    lockedAgent: {
      name: "codex",
      version: "codex-cli 0.147.0",
      model: "gpt-5.6-sol",
    },
  };
}

function piInput(
  source: AtifProjectionInput["source"] = {
    kind: "text",
    text: exactPiEvents(),
  },
): AtifProjectionInput {
  return {
    adapter: "pi",
    publicPrompt: "Inspect the requested Clash Timeline.",
    source,
    lockedAgent: {
      name: "pi",
      version: "0.80.7",
      model: "claude-sonnet-5",
    },
  };
}

describe("Pi ATIF v1.7 structured projection", () => {
  it("projects Pi turns, visible text, tool results, and usage without retaining reasoning", async () => {
    const projected = await projectAtifTrajectory(piInput());
    const trajectory = projected.trajectory;

    expect(trajectory).toMatchObject({
      schema_version: "ATIF-v1.7",
      session_id: "pi-session-001",
      agent: {
        name: "pi",
        version: "0.80.7",
        model_name: "claude-sonnet-5",
      },
      steps: [
        {
          step_id: 1,
          source: "user",
          message: "Inspect the requested Clash Timeline.",
        },
        {
          step_id: 2,
          source: "agent",
          message: "I inspected the Timeline.",
          model_name: "claude-sonnet-5",
          tool_calls: [
            {
              tool_call_id: "pi-call-1",
              function_name: "clash_composition",
              arguments: {
                kind: "timeline",
                operation: "clash_timeline_get",
                arguments: { timelineId: "timeline-main" },
              },
            },
          ],
          observation: {
            results: [
              {
                source_call_id: "pi-call-1",
                content: expect.stringContaining("Timeline ready"),
                extra: { status: "completed" },
              },
            ],
          },
          metrics: {
            prompt_tokens: 41,
            cached_tokens: 7,
            completion_tokens: 13,
            extra: {
              cache_write_input_tokens: 3,
              reasoning_output_tokens: 5,
            },
          },
        },
      ],
      final_metrics: {
        total_prompt_tokens: 41,
        total_cached_tokens: 7,
        total_completion_tokens: 13,
        total_steps: 2,
      },
      extra: {
        fidelity: "structured-projection",
        native_raw_retained: false,
        reasoning_content_retained: false,
      },
    });
    const serialized = JSON.stringify(trajectory);
    expect(serialized).not.toContain("PRIVATE_PI_REASONING");
    expect(serialized).not.toContain("PRIVATE_PI_SIGNATURE");
    expect(projected.source).toMatchObject({ format: "pi-events" });
  });

  it("publishes a Pi projection with the same hardened receipt contract", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "clash-pi-atif-writer-"));
    const sourcePath = join(caseRoot, "pi-events.jsonl");
    await writeFile(sourcePath, exactPiEvents(), "utf8");

    const receipt = await writeAtifTrajectory({
      ...piInput({ kind: "file", path: sourcePath }),
      outputDirectory: caseRoot,
    });
    const output = await readFile(join(caseRoot, "trajectory.atif.json"));

    expect(receipt).toMatchObject({
      schemaVersion: 1,
      kind: "clash.benchmark.atif-receipt",
      format: "ATIF-v1.7",
      path: "trajectory.atif.json",
      bytes: output.byteLength,
      sha256: createHash("sha256").update(output).digest("hex"),
      fidelity: "structured-projection",
      source: { format: "pi-events" },
    });
    expect(output.toString("utf8")).not.toContain("PRIVATE_PI_REASONING");
  });
});

describe("Codex ATIF v1.7 structured projection", () => {
  it("groups one Codex turn into an ATIF agent step with visible messages, calls, observations, and usage", async () => {
    const projected = await projectCodexAtifTrajectory(input());
    const trajectory = projected.trajectory;

    expect(trajectory.schema_version).toBe("ATIF-v1.7");
    expect(trajectory.session_id).toBe("codex-session-001");
    expect(trajectory.agent).toEqual({
      name: "codex",
      version: "codex-cli 0.147.0",
      model_name: "gpt-5.6-sol",
    });
    expect(trajectory.steps[0]).toMatchObject({
      step_id: 1,
      source: "user",
      message: "Create and render the requested Clash Stage.",
    });

    const agentStep = trajectory.steps[1]!;
    expect(agentStep).toMatchObject({
      source: "agent",
      message: "I will inspect the Stage and render it.",
      model_name: "gpt-5.6-sol",
      tool_calls: [
        {
          tool_call_id: "mcp-1",
          function_name: "mcp__clash__clash_director_get",
          arguments: { stageId: "hero-stage" },
        },
        {
          tool_call_id: "command-1",
          function_name: "command_execution",
          arguments: { command: "pwd" },
        },
      ],
      observation: {
        results: [
          {
            source_call_id: "mcp-1",
            content: expect.stringContaining("Stage ready"),
            extra: { status: "completed" },
          },
          {
            source_call_id: "command-1",
            content: "workspace\n",
            extra: { exit_code: 0, status: "completed" },
          },
        ],
      },
      metrics: {
        prompt_tokens: 120,
        cached_tokens: 20,
        completion_tokens: 30,
        extra: {
          cache_write_input_tokens: 3,
          reasoning_output_tokens: 5,
        },
      },
    });
    expect(agentStep).not.toHaveProperty("reasoning_content");
    expect(agentStep).not.toHaveProperty("llm_call_count");
    expect(JSON.stringify(trajectory)).not.toContain(
      "PRIVATE_REASONING_MUST_NOT_BE_RETAINED",
    );
    expect(trajectory.final_metrics).toMatchObject({
      total_prompt_tokens: 120,
      total_cached_tokens: 20,
      total_completion_tokens: 30,
      extra: {
        cache_write_input_tokens: 3,
        reasoning_output_tokens: 5,
      },
    });
    expect(trajectory.final_metrics?.total_steps).toBe(trajectory.steps.length);
    expect(projected).toMatchObject({
      fidelity: "structured-projection",
      redactionCount: 0,
      trainingEligible: true,
    });
    expect(trajectory.extra).toMatchObject({
      fidelity: "structured-projection",
      native_raw_retained: false,
      reasoning_content_retained: false,
      training_eligible: true,
    });
  });

  it("recursively redacts credentials, sensitive headers, capability query values, and machine paths", async () => {
    const workspaceRoot = "/Users/alice/Clash Project";
    const source = jsonl([
      { type: "thread.started", thread_id: "codex-session-redacted" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "mcp-sk-proj-TOP_SECRET_CALL_123456789",
          type: "mcp_tool_call",
          server: "clash",
          tool: "clash_asset_get_sk-proj-TOP_SECRET_TOOL_123456789",
          arguments: {
            path: `${workspaceRoot}/private/source.mov`,
            [`${workspaceRoot}/private/key`]: "path-key-value",
            headers: { Authorization: "Bearer TOP_SECRET_BEARER" },
            deliveryUrl:
              "https://assets.example.test/object?capability=TOP_SECRET_CAPABILITY&view=1",
            nested: [{ api_key: "sk-proj-TOP_SECRET_API_KEY_123456789" }],
          },
          result: {
            content: [
              {
                type: "text",
                text: `opened ${workspaceRoot}/private/source.mov with token=TOP_SECRET_QUERY`,
              },
            ],
            structured_content: null,
          },
          status: "completed",
        },
      },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      },
    ]);

    const projected = await projectCodexAtifTrajectory({
      ...input({ kind: "text", text: source }),
      publicPrompt: `Open ${workspaceRoot}/private/source.mov`,
      workspaceRoot,
    });
    const serialized = JSON.stringify(projected.trajectory);

    expect(serialized).not.toContain(workspaceRoot);
    expect(serialized).not.toContain("TOP_SECRET_BEARER");
    expect(serialized).not.toContain("TOP_SECRET_CAPABILITY");
    expect(serialized).not.toContain("TOP_SECRET_API_KEY");
    expect(serialized).not.toContain("TOP_SECRET_QUERY");
    expect(serialized).not.toContain("TOP_SECRET_CALL");
    expect(serialized).not.toContain("TOP_SECRET_TOOL");
    expect(serialized).toContain("$WORKSPACE");
    expect(serialized).toContain("[REDACTED]");
    expect(serialized).toContain("view=1");
    expect(projected.redactionCount).toBeGreaterThan(0);
    expect(projected.trainingEligible).toBe(false);
    expect(projected.trajectory.extra).toMatchObject({
      training_eligible: false,
      redaction_count: projected.redactionCount,
    });
  });

  it("redacts uppercase environment assignments from free-text observations", async () => {
    const source = jsonl([
      { type: "thread.started", thread_id: "codex-env-redaction" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "command-env",
          type: "command_execution",
          command: "printenv",
          aggregated_output:
            "GOOGLE_API_KEY=AIzaFAKE_GOOGLE_VALUE_123456789\nexport AWS_SECRET_ACCESS_KEY='FAKE_AWS_SECRET_VALUE_123456789'\n",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      },
    ]);

    const projected = await projectCodexAtifTrajectory(
      input({ kind: "text", text: source }),
    );
    const serialized = JSON.stringify(projected.trajectory);

    expect(serialized).not.toContain("AIzaFAKE_GOOGLE_VALUE");
    expect(serialized).not.toContain("FAKE_AWS_SECRET_VALUE");
    expect(serialized).toContain("GOOGLE_API_KEY=[REDACTED]");
    expect(serialized).toContain("AWS_SECRET_ACCESS_KEY=[REDACTED]");
    expect(projected.redactionCount).toBe(2);
    expect(projected.trainingEligible).toBe(false);
  });

  it("redacts generic absolute path tokens from free-text observations", async () => {
    const source = jsonl([
      { type: "thread.started", thread_id: "codex-path-redaction" },
      { type: "turn.started" },
      {
        type: "item.completed",
        item: {
          id: "command-paths",
          type: "command_execution",
          command: "inspect",
          aggregated_output:
            "config=/Library/Application Support/Clash/config.json\nbinary=(/usr/local/bin/clash)\nsource=/mnt/runner/project/input.mov\n",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "turn.completed",
        usage: {
          input_tokens: 1,
          cached_input_tokens: 0,
          output_tokens: 1,
          reasoning_output_tokens: 0,
        },
      },
    ]);

    const projected = await projectCodexAtifTrajectory(
      input({ kind: "text", text: source }),
    );
    const serialized = JSON.stringify(projected.trajectory);

    expect(serialized).not.toContain("/Library/Application");
    expect(serialized).not.toContain("/usr/local/bin/clash");
    expect(serialized).not.toContain("/mnt/runner/project/input.mov");
    expect(serialized).toContain("[ABSOLUTE_PATH]");
    expect(projected.redactionCount).toBe(3);
    expect(projected.trainingEligible).toBe(false);
  });

  it("reads a no-follow regular JSONL file and publishes deterministic content-addressed evidence", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "clash-atif-writer-"));
    const sourcePath = join(caseRoot, "codex-events.jsonl");
    await writeFile(sourcePath, exactCodexEvents(), "utf8");

    const first = await writeCodexAtifTrajectory({
      ...input({ kind: "file", path: sourcePath }),
      outputDirectory: caseRoot,
    });
    const second = await writeCodexAtifTrajectory({
      ...input({ kind: "file", path: sourcePath }),
      outputDirectory: caseRoot,
    });

    const outputPath = join(caseRoot, "trajectory.atif.json");
    const bytes = await readFile(outputPath);
    const info = await stat(outputPath);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 1,
      kind: "clash.benchmark.atif-receipt",
      format: "ATIF-v1.7",
      path: "trajectory.atif.json",
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      fidelity: "structured-projection",
      redactionCount: 0,
      trainingEligible: true,
    });
    expect(first.source).toMatchObject({
      format: "codex-exec-jsonl",
      bytes: Buffer.byteLength(exactCodexEvents()),
      sha256: createHash("sha256").update(exactCodexEvents()).digest("hex"),
    });
    expect(bytes.toString("utf8")).toMatch(/\n$/u);
    expect(bytes.toString("utf8")).not.toContain("PRIVATE_REASONING");
    expect(info.isFile()).toBe(true);
    expect(info.nlink).toBe(1);
    expect(info.mode & 0o777).toBe(0o600);
  });

  it("does not replace a conflicting, symlinked, or hard-linked output file", async () => {
    const conflictRoot = await mkdtemp(join(tmpdir(), "clash-atif-conflict-"));
    const outputPath = join(conflictRoot, "trajectory.atif.json");
    await writeFile(outputPath, "do not replace\n", "utf8");
    await expect(
      writeCodexAtifTrajectory({
        ...input(),
        outputDirectory: conflictRoot,
      }),
    ).rejects.toThrow(/conflicts/iu);
    await expect(readFile(outputPath, "utf8")).resolves.toBe(
      "do not replace\n",
    );

    const symlinkRoot = await mkdtemp(join(tmpdir(), "clash-atif-symlink-"));
    const symlinkTarget = join(symlinkRoot, "target.json");
    await writeFile(symlinkTarget, "target\n", "utf8");
    await symlink(symlinkTarget, join(symlinkRoot, "trajectory.atif.json"));
    await expect(
      writeCodexAtifTrajectory({
        ...input(),
        outputDirectory: symlinkRoot,
      }),
    ).rejects.toThrow(/regular unlinked file/iu);
    await expect(readFile(symlinkTarget, "utf8")).resolves.toBe("target\n");

    const hardlinkRoot = await mkdtemp(join(tmpdir(), "clash-atif-hardlink-"));
    const hardlinkTarget = join(hardlinkRoot, "target.json");
    await writeFile(hardlinkTarget, "target\n", "utf8");
    await link(hardlinkTarget, join(hardlinkRoot, "trajectory.atif.json"));
    await expect(
      writeCodexAtifTrajectory({
        ...input(),
        outputDirectory: hardlinkRoot,
      }),
    ).rejects.toThrow(/regular unlinked file/iu);
  });

  it("rejects symlinked input instead of following it", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-atif-source-"));
    const target = join(root, "events-target.jsonl");
    const source = join(root, "events.jsonl");
    await writeFile(target, exactCodexEvents(), "utf8");
    await symlink(target, source);

    await expect(
      projectCodexAtifTrajectory(input({ kind: "file", path: source })),
    ).rejects.toThrow(/regular unlinked file/iu);
  });

  it("fails closed for non-Codex adapters, malformed streams, and unsupported item types", async () => {
    await expect(
      projectCodexAtifTrajectory({
        ...input(),
        adapter: "claude",
      }),
    ).rejects.toThrow(/only supports Codex/iu);

    await expect(
      projectCodexAtifTrajectory({
        ...input({ kind: "text", text: "not-json\n" }),
      }),
    ).rejects.toThrow(/line 1.*JSON/iu);

    await expect(
      projectCodexAtifTrajectory({
        ...input({
          kind: "text",
          text: jsonl([
            { type: "thread.started", thread_id: "unsupported-item" },
            { type: "turn.started" },
            {
              type: "item.completed",
              item: { id: "unknown-1", type: "future_tool" },
            },
            {
              type: "turn.completed",
              usage: {
                input_tokens: 1,
                cached_input_tokens: 0,
                output_tokens: 1,
                reasoning_output_tokens: 0,
              },
            },
          ]),
        }),
      }),
    ).rejects.toThrow(/unsupported Codex item type/iu);
  });

  it("rejects unsafe locked identity and invalid turn structure without publishing a plausible ATIF", async () => {
    await expect(
      projectCodexAtifTrajectory({
        ...input(),
        lockedAgent: {
          name: "codex",
          version: "codex-cli 0.147.0",
          model: "sk-proj-TOP_SECRET_MODEL_123456789",
        },
      }),
    ).rejects.toThrow(/locked agent.*safe public/iu);

    await expect(
      projectCodexAtifTrajectory(
        input({
          kind: "text",
          text: jsonl([
            { type: "thread.started", thread_id: "nested-turn" },
            { type: "turn.started" },
            { type: "turn.started" },
          ]),
        }),
      ),
    ).rejects.toThrow(/turn structure/iu);
  });
});
