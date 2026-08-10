import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  summarizeTrajectoryUsability,
  writeNormalizedTrajectory,
  type TrajectoryAction,
} from "./trajectory";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("trajectory usability diagnostics", () => {
  it("summarizes discovery, parameter detours, recovery, mutation latency, and transport switches without grading them", () => {
    const actions: TrajectoryAction[] = [
      {
        sequence: 1,
        source: "pi",
        sourceLine: 1,
        kind: "shell",
        operation: "clash timeline --help",
        status: "succeeded",
        observedAt: "2026-08-08T00:00:00.100Z",
        monotonicMs: 100,
      },
      {
        sequence: 2,
        source: "pi",
        sourceLine: 2,
        kind: "mcp",
        operation: "clash/clash_timeline_schema",
        status: "succeeded",
        observedAt: "2026-08-08T00:00:00.200Z",
        monotonicMs: 200,
      },
      {
        sequence: 3,
        source: "pi",
        sourceLine: 3,
        kind: "mcp",
        operation: "clash/clash_canvas_update",
        status: "failed",
        error: "READ_REQUIRED: Read the target before canvas update.",
        observedAt: "2026-08-08T00:00:00.250Z",
        monotonicMs: 250,
      },
      {
        sequence: 4,
        source: "pi",
        sourceLine: 4,
        kind: "mcp",
        operation: "clash/clash_canvas_get",
        status: "succeeded",
        observedAt: "2026-08-08T00:00:00.300Z",
        monotonicMs: 300,
      },
      {
        sequence: 5,
        source: "pi",
        sourceLine: 5,
        kind: "mcp",
        operation: "clash/clash_canvas_update",
        status: "succeeded",
        observedAt: "2026-08-08T00:00:00.420Z",
        monotonicMs: 420,
      },
      {
        sequence: 6,
        source: "clash-cli",
        sourceLine: 1,
        kind: "cli",
        operation: "timeline pull",
        status: "failed",
        error: "UNKNOWN_OPTION: unknown option '--id'",
        observedAt: "2026-08-08T00:00:00.500Z",
        monotonicMs: 500,
      },
      {
        sequence: 7,
        source: "clash-cli",
        sourceLine: 2,
        kind: "cli",
        operation: "timeline apply",
        status: "succeeded",
        observedAt: "2026-08-08T00:00:00.600Z",
        monotonicMs: 600,
      },
      {
        sequence: 8,
        source: "pi",
        sourceLine: 8,
        kind: "mcp",
        operation: "clash/clash_timeline_render",
        status: "succeeded",
        observedAt: "2026-08-08T00:00:00.700Z",
        monotonicMs: 700,
      },
    ];

    expect(
      summarizeTrajectoryUsability({
        actions,
        repairs: [
          {
            operation: "clash/clash_canvas_update",
            failedSequence: 3,
            recoverySequence: 5,
          },
        ],
        contractResponses: [
          { operation: "clash/clash_timeline_schema", bytes: 2_400_000 },
        ],
      }),
    ).toEqual({
      successfulClashActionCount: 5,
      failedClashActionCount: 2,
      errorCodes: ["READ_REQUIRED", "UNKNOWN_OPTION"],
      recoveryCount: 1,
      parameterErrorCount: 1,
      helpActionCount: 1,
      contractDiscoveryActionCount: 1,
      contractResponseBytes: 2_400_000,
      largestContractResponseBytes: 2_400_000,
      timeToFirstSuccessfulMutationMs: 420,
      transportsUsed: ["mcp", "cli"],
      transportSwitchCount: 2,
    });
  });

  it("persists diagnostics from a real trace, counting menu calls, payload weight, and CLI-trace failures", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "usability-trace-"));
    roots.push(caseRoot);
    const logsRoot = join(caseRoot, "logs");
    await mkdir(logsRoot, { recursive: true });
    const schemaPayload = "x".repeat(120_000);
    const runOrigin = Date.UTC(2026, 7, 8);
    const events = [
      // A dispatcher call that never resolves to a leaf is a menu/discovery call.
      { type: "tool_execution_start", toolCallId: "t1", toolName: "clash", args: {} },
      { type: "tool_execution_end", toolCallId: "t1", toolName: "clash", result: { content: [{ type: "text", text: "menu" }] }, isError: false },
      { type: "tool_execution_start", toolCallId: "t2", toolName: "clash_timeline", args: { operation: "schema" } },
      { type: "tool_execution_end", toolCallId: "t2", toolName: "clash_timeline", result: { content: [{ type: "text", text: schemaPayload }] }, isError: false },
      { type: "tool_execution_start", toolCallId: "t3", toolName: "bash", args: { command: "clash timeline --help" } },
      { type: "tool_execution_end", toolCallId: "t3", toolName: "bash", result: { content: [{ type: "text", text: "usage" }] }, isError: false },
      { type: "tool_execution_start", toolCallId: "t4", toolName: "clash_canvas", args: { operation: "clash_canvas_update" } },
      { type: "tool_execution_end", toolCallId: "t4", toolName: "clash_canvas", result: { content: [{ type: "text", text: "READ_REQUIRED: read the node first" }] }, isError: true },
      { type: "tool_execution_start", toolCallId: "t5", toolName: "clash_canvas", args: { operation: "clash_canvas_get" } },
      { type: "tool_execution_end", toolCallId: "t5", toolName: "clash_canvas", result: { content: [{ type: "text", text: "{}" }] }, isError: false },
      { type: "tool_execution_start", toolCallId: "t6", toolName: "clash_canvas", args: { operation: "clash_canvas_update" } },
      { type: "tool_execution_end", toolCallId: "t6", toolName: "clash_canvas", result: { content: [{ type: "text", text: "ok" }] }, isError: false },
      { type: "turn_end", message: { role: "assistant", usage: { input: 10, output: 5 } } },
    ];
    const cliArgv = {
      rejected: ["timeline", "pull", "--id", "main"],
      accepted: ["timeline", "apply", "--timeline", "main"],
    };
    await Promise.all([
      writeFile(
        join(logsRoot, "events.jsonl"),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      ),
      writeFile(
        join(logsRoot, "observed.jsonl"),
        `${events
          .map((_event, index) =>
            JSON.stringify({
              line: index + 1,
              observedAt: new Date(runOrigin + index * 100).toISOString(),
              monotonicMs: index * 100,
              rawLineSha256: "0".repeat(64),
              parsed: true,
            }),
          )
          .join("\n")}\n`,
        "utf8",
      ),
      writeFile(
        join(logsRoot, "clash-cli-events.jsonl"),
        `${[
          { type: "clash.cli.started", startedAt: new Date(runOrigin + 1_300).toISOString(), pid: 1, argv: cliArgv.rejected, origin: null },
          { type: "clash.cli.completed", startedAt: new Date(runOrigin + 1_300).toISOString(), finishedAt: new Date(runOrigin + 1_400).toISOString(), pid: 1, argv: cliArgv.rejected, exitCode: 1, error: "UNKNOWN_OPTION: unknown option '--id'", origin: null },
          { type: "clash.cli.started", startedAt: new Date(runOrigin + 1_500).toISOString(), pid: 2, argv: cliArgv.accepted, origin: null },
          { type: "clash.cli.completed", startedAt: new Date(runOrigin + 1_500).toISOString(), finishedAt: new Date(runOrigin + 1_600).toISOString(), pid: 2, argv: cliArgv.accepted, exitCode: 0, origin: null },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n")}\n`,
        "utf8",
      ),
    ]);

    const trajectoryPath = await writeNormalizedTrajectory({
      agent: { adapter: "pi" },
      logsRoot,
      rawPath: join(logsRoot, "events.jsonl"),
      observedPath: join(logsRoot, "observed.jsonl"),
    });
    const { usability } = JSON.parse(await readFile(trajectoryPath, "utf8")) as {
      usability: Record<string, number & string[]>;
    };

    expect(usability).toEqual({
      successfulClashActionCount: 5,
      failedClashActionCount: 2,
      // READ_REQUIRED is a product precondition, not a caller who mis-typed the call.
      errorCodes: ["READ_REQUIRED", "UNKNOWN_OPTION"],
      recoveryCount: 1,
      parameterErrorCount: 1,
      helpActionCount: 1,
      contractDiscoveryActionCount: 2,
      contractResponseBytes: expect.any(Number),
      largestContractResponseBytes: expect.any(Number),
      timeToFirstSuccessfulMutationMs: 1_100,
      transportsUsed: ["mcp", "cli"],
      transportSwitchCount: 1,
    });
    expect(usability.largestContractResponseBytes).toBeGreaterThanOrEqual(
      schemaPayload.length,
    );
    expect(usability.contractResponseBytes).toBeGreaterThan(
      usability.largestContractResponseBytes,
    );
  });
});
