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
  it("counts sealed CLI schema discovery as a contract lookup", () => {
    const actions: TrajectoryAction[] = [
      {
        sequence: 1,
        source: "clash-cli",
        sourceLine: 1,
        kind: "cli",
        operation: "timeline schema",
        status: "started",
        observedAt: "2026-08-14T00:00:00.000Z",
        monotonicMs: 0,
        correlationId: "schema-1",
      },
      {
        sequence: 2,
        source: "clash-cli",
        sourceLine: 2,
        kind: "cli",
        operation: "timeline schema",
        status: "succeeded",
        observedAt: "2026-08-14T00:00:00.100Z",
        monotonicMs: 100,
        correlationId: "schema-1",
      },
    ];

    expect(summarizeTrajectoryUsability({ actions, repairs: [] })).toMatchObject(
      {
        contractDiscoveryInvocationCount: 1,
        contractDiscoveryActionCount: 1,
      },
    );
  });

  it("recognizes real Codex dispatcher discovery and quoted help while separating invocations from lifecycle events", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "codex-usability-trace-"));
    roots.push(caseRoot);
    const logsRoot = join(caseRoot, "logs");
    await mkdir(logsRoot, { recursive: true });
    const runOrigin = Date.UTC(2026, 7, 14);
    const events = [
      {
        type: "item.started",
        item: {
          id: "item_help",
          type: "command_execution",
          command: "/bin/zsh -lc 'clash --help'",
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_help",
          type: "command_execution",
          command: "/bin/zsh -lc 'clash --help'",
          aggregated_output:
            "Error: Trusted Clash CLI proxy rejected a command outside this benchmark case: --help",
          exit_code: 1,
          status: "failed",
        },
      },
      {
        type: "item.started",
        item: {
          id: "item_assets",
          type: "mcp_tool_call",
          server: "clash",
          tool: "clash_assets",
          arguments: {},
          result: null,
          error: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_assets",
          type: "mcp_tool_call",
          server: "clash",
          tool: "clash_assets",
          arguments: {},
          result: {
            content: [{ type: "text", text: "Revealed 13 assets operations." }],
            structured_content: {
              schemaVersion: 1,
              selectedCommand: "assets",
              operations: [{ name: "clash_assets_import_file" }],
            },
          },
          error: null,
          status: "completed",
        },
      },
    ];
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
    ]);

    const trajectoryPath = await writeNormalizedTrajectory({
      agent: { adapter: "codex" },
      logsRoot,
      rawPath: join(logsRoot, "events.jsonl"),
      observedPath: join(logsRoot, "observed.jsonl"),
    });
    const trajectory = JSON.parse(await readFile(trajectoryPath, "utf8")) as {
      actions: TrajectoryAction[];
      summary: Record<string, number>;
      usability: Record<string, number>;
    };

    expect(
      trajectory.actions.map(({ operation, status }) => ({
        operation,
        status,
      })),
    ).toEqual([
      {
        operation: "/bin/zsh -lc 'clash --help'",
        status: "started",
      },
      {
        operation: "/bin/zsh -lc 'clash --help'",
        status: "failed",
      },
      { operation: "clash/clash_assets", status: "started" },
      { operation: "clash/clash_assets", status: "succeeded" },
    ]);
    expect(trajectory.usability).toMatchObject({
      successfulClashInvocationCount: 1,
      failedClashInvocationCount: 0,
      helpActionCount: 1,
      helpInvocationCount: 1,
      contractDiscoveryActionCount: 1,
      contractDiscoveryInvocationCount: 1,
    });
    expect(trajectory.usability.contractResponseBytes).toBeGreaterThan(0);
    expect(trajectory.summary).toMatchObject({
      // Keep actionCount as the schema-v1 lifecycle-event compatibility field.
      actionCount: 4,
      lifecycleEventCount: 4,
      invocationCount: 2,
      failedInvocationCount: 1,
    });
  });

  it("counts a runner-sealed Clash CLI lifecycle once instead of also counting its Codex shell envelope", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "sealed-cli-trace-"));
    roots.push(caseRoot);
    const logsRoot = join(caseRoot, "logs");
    await mkdir(logsRoot, { recursive: true });
    const runOrigin = Date.UTC(2026, 7, 14);
    const events = [
      {
        type: "item.started",
        item: {
          id: "item_help",
          type: "command_execution",
          command: "/bin/zsh -lc 'clash --help'",
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_help",
          type: "command_execution",
          command: "/bin/zsh -lc 'clash --help'",
          aggregated_output: "Usage: clash [options] [command]",
          exit_code: 0,
          status: "completed",
        },
      },
    ];
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
              observedAt: new Date(runOrigin + 100 + index * 400).toISOString(),
              monotonicMs: 100 + index * 400,
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
          {
            type: "clash.cli.started",
            startedAt: new Date(runOrigin + 200).toISOString(),
            pid: 42,
            argv: ["--help"],
          },
          {
            type: "clash.cli.completed",
            startedAt: new Date(runOrigin + 200).toISOString(),
            finishedAt: new Date(runOrigin + 400).toISOString(),
            pid: 42,
            argv: ["--help"],
            exitCode: 0,
          },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n")}\n`,
        "utf8",
      ),
    ]);

    const trajectoryPath = await writeNormalizedTrajectory({
      agent: { adapter: "codex" },
      logsRoot,
      rawPath: join(logsRoot, "events.jsonl"),
      observedPath: join(logsRoot, "observed.jsonl"),
    });
    const trajectory = JSON.parse(await readFile(trajectoryPath, "utf8")) as {
      actions: TrajectoryAction[];
      summary: Record<string, number>;
      usability: Record<string, number | string[]>;
    };

    expect(
      trajectory.actions.map(({ source, kind, operation, status }) => ({
        source,
        kind,
        operation,
        status,
      })),
    ).toEqual([
      {
        source: "clash-cli",
        kind: "cli",
        operation: "--help",
        status: "started",
      },
      {
        source: "clash-cli",
        kind: "cli",
        operation: "--help",
        status: "succeeded",
      },
    ]);
    expect(trajectory.summary).toMatchObject({
      actionCount: 2,
      lifecycleEventCount: 2,
      invocationCount: 1,
      failedInvocationCount: 0,
    });
    expect(trajectory.usability).toMatchObject({
      successfulClashInvocationCount: 1,
      failedClashInvocationCount: 0,
      helpInvocationCount: 1,
      transportsUsed: ["cli"],
    });
  });

  it("retains nested --help in sealed CLI operations so discovery cannot become a mutation", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "sealed-cli-help-trace-"));
    roots.push(caseRoot);
    const logsRoot = join(caseRoot, "logs");
    await mkdir(logsRoot, { recursive: true });
    const runOrigin = Date.UTC(2026, 7, 14);
    const helpCommand =
      "/bin/zsh -lc 'clash asset --help && clash asset import --help && clash asset list --help && clash asset get --help'";
    const importCommand =
      "/bin/zsh -lc 'clash asset import --file inputs/exact-source.svg --kind image --asset-id benchmark-asset --json'";
    const events = [
      {
        type: "item.started",
        item: {
          id: "item_help",
          type: "command_execution",
          command: helpCommand,
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_help",
          type: "command_execution",
          command: helpCommand,
          aggregated_output: "Usage: clash asset",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.started",
        item: {
          id: "item_import",
          type: "command_execution",
          command: importCommand,
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_import",
          type: "command_execution",
          command: importCommand,
          aggregated_output: '{"id":"benchmark-asset"}',
          exit_code: 0,
          status: "completed",
        },
      },
    ];
    const cliInvocations = [
      {
        pid: 101,
        startedMs: 1_500,
        finishedMs: 1_600,
        argv: ["asset", "--help"],
      },
      {
        pid: 102,
        startedMs: 1_800,
        finishedMs: 1_900,
        argv: ["asset", "import", "--help"],
      },
      {
        pid: 103,
        startedMs: 2_100,
        finishedMs: 2_200,
        argv: ["asset", "list", "--help"],
      },
      {
        pid: 104,
        startedMs: 2_400,
        finishedMs: 2_500,
        argv: ["asset", "get", "--help"],
      },
      {
        pid: 105,
        startedMs: 6_100,
        finishedMs: 6_500,
        argv: [
          "asset",
          "import",
          "--file",
          "inputs/exact-source.svg",
          "--kind",
          "image",
          "--asset-id",
          "benchmark-asset",
          "--json",
        ],
      },
    ];
    await Promise.all([
      writeFile(
        join(logsRoot, "events.jsonl"),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      ),
      writeFile(
        join(logsRoot, "observed.jsonl"),
        `${[1_000, 5_000, 6_000, 7_000]
          .map((monotonicMs, index) =>
            JSON.stringify({
              line: index + 1,
              observedAt: new Date(runOrigin + monotonicMs).toISOString(),
              monotonicMs,
              rawLineSha256: "0".repeat(64),
              parsed: true,
            }),
          )
          .join("\n")}\n`,
        "utf8",
      ),
      writeFile(
        join(logsRoot, "clash-cli-events.jsonl"),
        `${cliInvocations
          .flatMap(({ pid, startedMs, finishedMs, argv }) => [
            {
              type: "clash.cli.started",
              invocationId: `invocation-${pid}`,
              startedAt: new Date(runOrigin + startedMs).toISOString(),
              pid,
              parentPid: 10,
              cwd: caseRoot,
              argv,
            },
            {
              type: "clash.cli.completed",
              invocationId: `invocation-${pid}`,
              startedAt: new Date(runOrigin + startedMs).toISOString(),
              finishedAt: new Date(runOrigin + finishedMs).toISOString(),
              durationMs: finishedMs - startedMs,
              pid,
              parentPid: 10,
              cwd: caseRoot,
              argv,
              exitCode: 0,
              signal: null,
            },
          ])
          .map((event) => JSON.stringify(event))
          .join("\n")}\n`,
        "utf8",
      ),
    ]);

    const trajectoryPath = await writeNormalizedTrajectory({
      agent: { adapter: "codex" },
      logsRoot,
      rawPath: join(logsRoot, "events.jsonl"),
      observedPath: join(logsRoot, "observed.jsonl"),
    });
    const trajectory = JSON.parse(await readFile(trajectoryPath, "utf8")) as {
      actions: TrajectoryAction[];
      summary: Record<string, number>;
      usability: Record<string, number>;
    };

    expect(
      trajectory.actions
        .filter((action) => action.status === "succeeded")
        .map((action) => action.operation),
    ).toEqual([
      "asset --help",
      "asset import --help",
      "asset list --help",
      "asset get --help",
      "asset import",
    ]);
    expect(
      trajectory.actions.every((action) => action.source === "clash-cli"),
    ).toBe(true);
    expect(trajectory.summary.invocationCount).toBe(5);
    expect(trajectory.usability).toMatchObject({
      successfulClashInvocationCount: 5,
      helpInvocationCount: 4,
      timeToFirstSuccessfulMutationMs: 6_500,
    });
  });

  it("prefers an overlapping sealed CLI lifecycle while retaining an unmatched rejected shell", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "overlapping-cli-trace-"));
    roots.push(caseRoot);
    const logsRoot = join(caseRoot, "logs");
    await mkdir(logsRoot, { recursive: true });
    const runOrigin = Date.UTC(2026, 7, 14);
    const rejectedCommand =
      "/bin/zsh -lc 'clash asset import --unsupported-option'";
    const importedCommand =
      "/bin/zsh -lc 'clash asset import --file inputs/exact-source.svg --kind image --asset-id benchmark-asset --json'";
    const events = [
      {
        type: "item.started",
        item: {
          id: "item_rejected",
          type: "command_execution",
          command: rejectedCommand,
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_rejected",
          type: "command_execution",
          command: rejectedCommand,
          aggregated_output: "Trusted Clash CLI proxy rejected the command",
          exit_code: 1,
          status: "failed",
        },
      },
      {
        type: "item.started",
        item: {
          id: "item_import",
          type: "command_execution",
          command: importedCommand,
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_import",
          type: "command_execution",
          command: importedCommand,
          aggregated_output: '{"id":"benchmark-asset"}',
          exit_code: 0,
          status: "completed",
        },
      },
    ];
    const cliStartedAt = new Date(runOrigin + 2_000).toISOString();
    await Promise.all([
      writeFile(
        join(logsRoot, "events.jsonl"),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      ),
      writeFile(
        join(logsRoot, "observed.jsonl"),
        `${[1_000, 1_100, 2_060, 2_500]
          .map((monotonicMs, index) =>
            JSON.stringify({
              line: index + 1,
              observedAt: new Date(runOrigin + monotonicMs).toISOString(),
              monotonicMs,
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
          {
            type: "clash.cli.started",
            invocationId: "sealed-import",
            startedAt: cliStartedAt,
            pid: 201,
            parentPid: 20,
            cwd: caseRoot,
            argv: [
              "asset",
              "import",
              "--file",
              "inputs/exact-source.svg",
              "--kind",
              "image",
              "--asset-id",
              "benchmark-asset",
              "--json",
            ],
          },
          {
            type: "clash.cli.completed",
            invocationId: "sealed-import",
            startedAt: cliStartedAt,
            finishedAt: new Date(runOrigin + 2_490).toISOString(),
            durationMs: 490,
            pid: 201,
            parentPid: 20,
            cwd: caseRoot,
            argv: [
              "asset",
              "import",
              "--file",
              "inputs/exact-source.svg",
              "--kind",
              "image",
              "--asset-id",
              "benchmark-asset",
              "--json",
            ],
            exitCode: 0,
            signal: null,
          },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n")}\n`,
        "utf8",
      ),
    ]);

    const trajectoryPath = await writeNormalizedTrajectory({
      agent: { adapter: "codex" },
      logsRoot,
      rawPath: join(logsRoot, "events.jsonl"),
      observedPath: join(logsRoot, "observed.jsonl"),
    });
    const trajectory = JSON.parse(await readFile(trajectoryPath, "utf8")) as {
      actions: TrajectoryAction[];
      summary: Record<string, number>;
    };

    expect(trajectory.summary.invocationCount).toBe(2);
    expect(
      trajectory.actions.map(({ source, correlationId, status }) => ({
        source,
        correlationId,
        status,
      })),
    ).toEqual([
      {
        source: "codex",
        correlationId: "item_rejected",
        status: "started",
      },
      {
        source: "codex",
        correlationId: "item_rejected",
        status: "failed",
      },
      {
        source: "clash-cli",
        correlationId: "201",
        status: "started",
      },
      {
        source: "clash-cli",
        correlationId: "201",
        status: "succeeded",
      },
    ]);
  });

  it("consumes at most one shell envelope for each sealed CLI lifecycle", async () => {
    const caseRoot = await mkdtemp(join(tmpdir(), "one-to-one-cli-trace-"));
    roots.push(caseRoot);
    const logsRoot = join(caseRoot, "logs");
    await mkdir(logsRoot, { recursive: true });
    const runOrigin = Date.UTC(2026, 7, 14);
    const command = "/bin/zsh -lc 'clash asset list --json'";
    const events = [
      {
        type: "item.started",
        item: {
          id: "item_outer",
          type: "command_execution",
          command,
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.started",
        item: {
          id: "item_inner",
          type: "command_execution",
          command,
          aggregated_output: "",
          exit_code: null,
          status: "in_progress",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_inner",
          type: "command_execution",
          command,
          aggregated_output: "[]",
          exit_code: 0,
          status: "completed",
        },
      },
      {
        type: "item.completed",
        item: {
          id: "item_outer",
          type: "command_execution",
          command,
          aggregated_output: "[]",
          exit_code: 0,
          status: "completed",
        },
      },
    ];
    const cliStartedAt = new Date(runOrigin + 2_000).toISOString();
    await Promise.all([
      writeFile(
        join(logsRoot, "events.jsonl"),
        `${events.map((event) => JSON.stringify(event)).join("\n")}\n`,
        "utf8",
      ),
      writeFile(
        join(logsRoot, "observed.jsonl"),
        `${[1_800, 1_900, 3_100, 3_200]
          .map((monotonicMs, index) =>
            JSON.stringify({
              line: index + 1,
              observedAt: new Date(runOrigin + monotonicMs).toISOString(),
              monotonicMs,
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
          {
            type: "clash.cli.started",
            invocationId: "sealed-list",
            startedAt: cliStartedAt,
            pid: 301,
            parentPid: 30,
            cwd: caseRoot,
            argv: ["asset", "list", "--json"],
          },
          {
            type: "clash.cli.completed",
            invocationId: "sealed-list",
            startedAt: cliStartedAt,
            finishedAt: new Date(runOrigin + 3_000).toISOString(),
            durationMs: 1_000,
            pid: 301,
            parentPid: 30,
            cwd: caseRoot,
            argv: ["asset", "list", "--json"],
            exitCode: 0,
            signal: null,
          },
        ]
          .map((event) => JSON.stringify(event))
          .join("\n")}\n`,
        "utf8",
      ),
    ]);

    const trajectoryPath = await writeNormalizedTrajectory({
      agent: { adapter: "codex" },
      logsRoot,
      rawPath: join(logsRoot, "events.jsonl"),
      observedPath: join(logsRoot, "observed.jsonl"),
    });
    const trajectory = JSON.parse(await readFile(trajectoryPath, "utf8")) as {
      actions: TrajectoryAction[];
      summary: Record<string, number>;
    };

    expect(trajectory.summary.invocationCount).toBe(2);
    expect(
      new Set(
        trajectory.actions
          .filter((action) => action.source === "codex")
          .map((action) => action.correlationId),
      ).size,
    ).toBe(1);
  });

  it.each([
    {
      label: "an Asset import dispatcher leaf",
      kind: "mcp" as const,
      readOperation: "clash/clash_assets_get",
      mutationOperation: "clash/clash_assets_import_file",
    },
    {
      label: "an Asset trash dispatcher leaf",
      kind: "mcp" as const,
      readOperation: "clash/clash_assets_list",
      mutationOperation: "clash/clash_assets_trash",
    },
    {
      label: "an Asset restore dispatcher leaf",
      kind: "mcp" as const,
      readOperation: "clash/clash_assets_get",
      mutationOperation: "clash/clash_assets_restore",
    },
    {
      label: "an Asset restore CLI command",
      kind: "cli" as const,
      readOperation: "assets get",
      mutationOperation: "assets restore",
    },
  ])(
    "starts mutation latency at $label rather than the preceding read",
    ({ kind, readOperation, mutationOperation }) => {
      const usability = summarizeTrajectoryUsability({
        actions: [
          {
            sequence: 1,
            source: kind === "mcp" ? "codex" : "clash-cli",
            sourceLine: 1,
            kind,
            operation: readOperation,
            status: "succeeded",
            observedAt: "2026-08-14T00:00:00.125Z",
            monotonicMs: 125,
          },
          {
            sequence: 2,
            source: kind === "mcp" ? "codex" : "clash-cli",
            sourceLine: 2,
            kind,
            operation: mutationOperation,
            status: "succeeded",
            observedAt: "2026-08-14T00:00:00.275Z",
            monotonicMs: 275.125,
          },
        ],
        repairs: [],
      });

      expect(usability.timeToFirstSuccessfulMutationMs).toBe(275.125);
    },
  );

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
      successfulClashInvocationCount: 5,
      failedClashInvocationCount: 2,
      successfulClashActionCount: 5,
      failedClashActionCount: 2,
      errorCodes: ["READ_REQUIRED", "UNKNOWN_OPTION"],
      recoveryCount: 1,
      parameterErrorCount: 1,
      helpInvocationCount: 1,
      helpActionCount: 1,
      contractDiscoveryInvocationCount: 1,
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
      {
        type: "tool_execution_start",
        toolCallId: "t1",
        toolName: "clash",
        args: {},
      },
      {
        type: "tool_execution_end",
        toolCallId: "t1",
        toolName: "clash",
        result: { content: [{ type: "text", text: "menu" }] },
        isError: false,
      },
      {
        type: "tool_execution_start",
        toolCallId: "t2",
        toolName: "clash_timeline",
        args: { operation: "schema" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t2",
        toolName: "clash_timeline",
        result: { content: [{ type: "text", text: schemaPayload }] },
        isError: false,
      },
      {
        type: "tool_execution_start",
        toolCallId: "t3",
        toolName: "bash",
        args: { command: "clash timeline --help" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t3",
        toolName: "bash",
        result: { content: [{ type: "text", text: "usage" }] },
        isError: false,
      },
      {
        type: "tool_execution_start",
        toolCallId: "t4",
        toolName: "clash_canvas",
        args: { operation: "clash_canvas_update" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t4",
        toolName: "clash_canvas",
        result: {
          content: [
            { type: "text", text: "READ_REQUIRED: read the node first" },
          ],
        },
        isError: true,
      },
      {
        type: "tool_execution_start",
        toolCallId: "t5",
        toolName: "clash_canvas",
        args: { operation: "clash_canvas_get" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t5",
        toolName: "clash_canvas",
        result: { content: [{ type: "text", text: "{}" }] },
        isError: false,
      },
      {
        type: "tool_execution_start",
        toolCallId: "t6",
        toolName: "clash_canvas",
        args: { operation: "clash_canvas_update" },
      },
      {
        type: "tool_execution_end",
        toolCallId: "t6",
        toolName: "clash_canvas",
        result: { content: [{ type: "text", text: "ok" }] },
        isError: false,
      },
      {
        type: "turn_end",
        message: { role: "assistant", usage: { input: 10, output: 5 } },
      },
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
          {
            type: "clash.cli.started",
            startedAt: new Date(runOrigin + 1_300).toISOString(),
            pid: 1,
            argv: cliArgv.rejected,
            origin: null,
          },
          {
            type: "clash.cli.completed",
            startedAt: new Date(runOrigin + 1_300).toISOString(),
            finishedAt: new Date(runOrigin + 1_400).toISOString(),
            pid: 1,
            argv: cliArgv.rejected,
            exitCode: 1,
            error: "UNKNOWN_OPTION: unknown option '--id'",
            origin: null,
          },
          {
            type: "clash.cli.started",
            startedAt: new Date(runOrigin + 1_500).toISOString(),
            pid: 2,
            argv: cliArgv.accepted,
            origin: null,
          },
          {
            type: "clash.cli.completed",
            startedAt: new Date(runOrigin + 1_500).toISOString(),
            finishedAt: new Date(runOrigin + 1_600).toISOString(),
            pid: 2,
            argv: cliArgv.accepted,
            exitCode: 0,
            origin: null,
          },
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
    const { usability } = JSON.parse(
      await readFile(trajectoryPath, "utf8"),
    ) as {
      usability: Record<string, number & string[]>;
    };

    expect(usability).toEqual({
      successfulClashInvocationCount: 5,
      failedClashInvocationCount: 2,
      successfulClashActionCount: 5,
      failedClashActionCount: 2,
      // READ_REQUIRED is a product precondition, not a caller who mis-typed the call.
      errorCodes: ["READ_REQUIRED", "UNKNOWN_OPTION"],
      recoveryCount: 1,
      parameterErrorCount: 1,
      helpInvocationCount: 1,
      helpActionCount: 1,
      contractDiscoveryInvocationCount: 2,
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
