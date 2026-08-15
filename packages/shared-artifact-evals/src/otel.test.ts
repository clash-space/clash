import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildBenchmarkOtlpTrace,
  summarizeTrustedCliTrace,
  writeBenchmarkOtlpTrace,
  type BenchmarkOtlpTraceInput,
  type OtlpAnyValue,
  type OtlpJsonSpan,
} from "./index";
import type { NormalizedTrajectory } from "./trajectory";
import type { ArtifactBenchmarkCase, BenchmarkCaseReport } from "./types";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

function benchmark(): ArtifactBenchmarkCase {
  return {
    id: "asset-import",
    title: "Import one exact image",
    category: "asset",
    outcome: {
      objective: "Import the supplied image",
      acceptanceCriteria: ["The Project Asset bytes match the input"],
      deliverables: [
        {
          artifactId: "image-output",
          kind: "image",
          description: "The imported image",
        },
      ],
    },
    passScore: 80,
    timeoutMs: 10_000,
    skills: [],
    rubric: [],
  };
}

function report(): BenchmarkCaseReport {
  return {
    id: "asset-import",
    workspace: "/private/benchmark/workspace",
    status: "pass",
    attempt: 1,
    agent: {
      status: "completed",
      exitCode: 0,
      signal: null,
      durationMs: 1_200,
      stdoutPath: "/private/benchmark/logs/events.jsonl",
      stderrPath: "/private/benchmark/logs/stderr.log",
      trajectoryPath: "/private/benchmark/logs/trajectory.json",
    },
    execution: {
      profile: "clash-host",
      status: "pass",
      requiredProductOperations: ["asset.import"],
      observedProductOperations: [
        {
          operation: "asset.import",
          transport: "mcp",
          invocation: "clash_assets_import_file",
        },
      ],
      missingProductOperations: [],
      forbiddenProductOperations: [],
      observedForbiddenProductOperations: [],
      requiredMcpTools: [],
      observedMcpTools: ["clash_assets_import_file"],
      missingMcpTools: [],
      requiredCliCommands: [],
      observedCliCommands: ["assets get"],
      missingCliCommands: [],
      detail: "Host readback passed",
      productReadback: {
        status: "pass",
        receiptPath: "asset-readback.json",
        matchedArtifactIds: ["image-output"],
        detail: "The exact bytes matched",
      },
    },
    evaluation: {
      schemaVersion: 1,
      benchmarkId: "asset-import",
      taskId: "task-1",
      status: "pass",
      score: 100,
      checks: [
        {
          id: "exists",
          type: "artifact-exists",
          status: "pass",
          required: true,
          weight: 1,
          awardedWeight: 1,
          detail: "Artifact exists",
        },
      ],
      artifacts: [
        {
          id: "image-output",
          kind: "image",
          path: "outputs/result.svg",
          bytes: 189,
          sha256:
            "82632b7f39230e30bfc9e6a4c586e54072f512c055ca7c85f46ea028a79209bb",
        },
      ],
      outcomeGate: {
        status: "pass",
        detail: "All deliverables are present",
        missingArtifactIds: [],
        invalidArtifactIds: [],
      },
    },
    outcome: {
      schemaVersion: 1,
      caseId: "asset-import",
      objective: "Import the supplied image",
      status: "achieved",
      score: 100,
      passScore: 80,
      agentStatus: "completed",
      evaluationStatus: "pass",
      executionStatus: "pass",
      completedAt: "1970-01-01T00:00:03.000Z",
    },
  };
}

function trajectory(): NormalizedTrajectory {
  const emptyUsability: NormalizedTrajectory["usability"] = {
    successfulClashActionCount: 2,
    failedClashActionCount: 0,
    errorCodes: [],
    recoveryCount: 0,
    parameterErrorCount: 0,
    helpActionCount: 0,
    contractDiscoveryActionCount: 0,
    contractResponseBytes: 0,
    largestContractResponseBytes: 0,
    timeToFirstSuccessfulMutationMs: 800,
    transportsUsed: ["mcp", "cli"],
    transportSwitchCount: 1,
  };
  return {
    schemaVersion: 1,
    sourceTraces: [
      {
        kind: "codex-events",
        path: "events.jsonl",
        sha256:
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        bytes: 640,
        lines: 4,
      },
      {
        kind: "clash-cli-events",
        path: "clash-cli-events.jsonl",
        sha256:
          "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        bytes: 320,
        lines: 2,
      },
    ],
    actions: [
      {
        sequence: 1,
        source: "codex",
        sourceLine: 1,
        kind: "mcp",
        operation: "clash/clash_assets_import_file",
        status: "started",
        observedAt: "1970-01-01T00:00:01.500Z",
        monotonicMs: 500,
        correlationId: "mcp-call-1",
      },
      {
        sequence: 2,
        source: "codex",
        sourceLine: 2,
        kind: "mcp",
        operation: "clash/clash_assets_import_file",
        status: "succeeded",
        observedAt: "1970-01-01T00:00:01.800Z",
        monotonicMs: 800,
        correlationId: "mcp-call-1",
      },
      {
        sequence: 3,
        source: "clash-cli",
        sourceLine: 1,
        kind: "cli",
        operation: "assets get",
        status: "started",
        observedAt: "1970-01-01T00:00:02.000Z",
        monotonicMs: 1_000,
        correlationId: "4242",
      },
      {
        sequence: 4,
        source: "clash-cli",
        sourceLine: 2,
        kind: "cli",
        operation: "assets get",
        status: "succeeded",
        observedAt: "1970-01-01T00:00:02.200Z",
        monotonicMs: 1_200,
        correlationId: "4242",
      },
    ],
    repairs: [],
    turns: [
      {
        status: "completed",
        turnCount: 1,
        usage: {
          inputTokens: 10,
          cachedInputTokens: 2,
          outputTokens: 5,
          reasoningOutputTokens: 1,
        },
      },
    ],
    usage: {
      turnCount: 1,
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      reasoningOutputTokens: 1,
    },
    errors: [],
    summary: {
      actionCount: 4,
      failedActionCount: 0,
      repairCount: 0,
      turnCount: 1,
    },
    usability: emptyUsability,
  };
}

function attributes(
  entries: Array<{ key: string; value: OtlpAnyValue }>,
): Map<string, OtlpAnyValue> {
  return new Map(entries.map(({ key, value }) => [key, value]));
}

function spans(
  document: ReturnType<typeof buildBenchmarkOtlpTrace>,
): OtlpJsonSpan[] {
  return document.resourceSpans[0]!.scopeSpans[0]!.spans;
}

function baseInput(): BenchmarkOtlpTraceInput {
  return {
    suiteId: "agent-functional-v1",
    runId: "run-001",
    track: "functional" as const,
    benchmark: benchmark(),
    agent: { adapter: "codex" as const, model: "gpt-5.6" },
    attempt: 1,
    startedAt: "1970-01-01T00:00:01.000Z",
    finishedAt: "1970-01-01T00:00:03.000Z",
    report: report(),
    trajectory: trajectory(),
    serviceVersion: "0.1.0",
    productReadback: {
      schemaVersion: 1,
      status: "pass",
      matchedArtifactIds: ["image-output"],
      hostReceipt: "opaque-receipt",
    },
    trustedCliTrace: {
      status: "sealed" as const,
      sha256:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      bytes: 420,
      eventCount: 2,
      completedCount: 1,
      succeededCount: 1,
      failedCount: 0,
    },
    environmentTransition: {
      captureStatus: "complete",
      inputBundleDigest:
        "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      modifiedBundleDigest:
        "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      executionLockSha256:
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    },
  };
}

describe("benchmark OTLP trace export", () => {
  it("exports one score-free Attempt trace and digest for different scoring views", async () => {
    // Break caught: hashing the aggregate report or exporting any evaluator
    // span makes one immutable rollout acquire a different identity per judge.
    const highScoringView = baseInput();
    highScoringView.track = "content-effect";
    highScoringView.report.qualityReview = {
      required: true,
      status: "pass",
      detail: "The independent judge awarded a high score.",
    };
    highScoringView.report.outcome.qualityReviewStatus = "pass";

    const lowScoringView = baseInput();
    lowScoringView.track = "content-effect";
    lowScoringView.report.status = "fail";
    lowScoringView.report.failure = {
      classification: "evaluation",
      retryable: false,
      phase: "quality-review",
      detail: "The independent judge awarded a low score.",
    };
    lowScoringView.report.evaluation = {
      ...lowScoringView.report.evaluation,
      status: "fail",
      score: 7,
      checks: lowScoringView.report.evaluation.checks.map((check) => ({
        ...check,
        status: "fail" as const,
        awardedWeight: 0,
        detail: "The scoring view rejected this evidence.",
      })),
      outcomeGate: {
        status: "fail",
        detail: "The scoring view rejected the deliverable.",
        missingArtifactIds: [],
        invalidArtifactIds: ["image-output"],
      },
    };
    lowScoringView.report.qualityReview = {
      required: true,
      status: "fail",
      detail: "The independent judge awarded a low score.",
    };
    lowScoringView.report.outcome = {
      ...lowScoringView.report.outcome,
      status: "failed",
      score: 7,
      evaluationStatus: "fail",
      qualityReviewStatus: "fail",
    };

    const highRoot = await mkdtemp(join(tmpdir(), "clash-otel-high-score-"));
    const lowRoot = await mkdtemp(join(tmpdir(), "clash-otel-low-score-"));
    temporaryRoots.push(highRoot, lowRoot);
    const [highReceipt, lowReceipt] = await Promise.all([
      writeBenchmarkOtlpTrace({ ...highScoringView, caseRoot: highRoot }),
      writeBenchmarkOtlpTrace({ ...lowScoringView, caseRoot: lowRoot }),
    ]);
    const [highTrace, lowTrace] = await Promise.all([
      readFile(join(highRoot, "trace.otlp.json"), "utf8"),
      readFile(join(lowRoot, "trace.otlp.json"), "utf8"),
    ]);

    expect(lowTrace).toBe(highTrace);
    expect(lowReceipt.sha256).toBe(highReceipt.sha256);
    expect(lowReceipt.traceId).toBe(highReceipt.traceId);
    expect(lowTrace).not.toMatch(/score|evaluation|outcome|quality_review/iu);
  });

  it("builds one valid, parented OTLP/JSON Attempt trace", () => {
    // Break caught: emitting ad-hoc JSON, invalid protobuf JSON scalars, or a
    // flat set of unrelated spans must fail this interoperability contract.
    const document = buildBenchmarkOtlpTrace(baseInput());
    const resourceSpan = document.resourceSpans[0]!;
    const allSpans = spans(document);
    const root = allSpans.find(({ name }) => name === "benchmark.attempt")!;
    const agent = allSpans.find(({ name }) => name === "benchmark.agent.run")!;
    const actions = allSpans.filter(
      ({ name }) => name === "benchmark.agent.action",
    );
    const readback = allSpans.find(
      ({ name }) => name === "benchmark.host.readback",
    )!;
    const environment = allSpans.find(
      ({ name }) => name === "benchmark.environment.capture",
    )!;

    expect(document).toEqual({
      resourceSpans: [resourceSpan],
    });
    expect(resourceSpan.scopeSpans).toHaveLength(1);
    expect(resourceSpan.scopeSpans[0]!.scope).toEqual({
      name: "@clash/artifact-evals",
      version: "0.1.0",
    });
    expect(attributes(resourceSpan.resource.attributes)).toMatchObject(
      new Map([
        ["service.name", { stringValue: "clash-agent-benchmark" }],
        ["service.version", { stringValue: "0.1.0" }],
        ["benchmark.suite.id", { stringValue: "agent-functional-v1" }],
        ["benchmark.case.id", { stringValue: "asset-import" }],
        ["benchmark.run.id", { stringValue: "run-001" }],
        ["benchmark.track", { stringValue: "functional" }],
        ["benchmark.agent", { stringValue: "codex" }],
      ]),
    );

    expect(root.parentSpanId).toBeUndefined();
    expect(root.startTimeUnixNano).toBe("1000000000");
    expect(root.endTimeUnixNano).toBe("3000000000");
    expect(agent.parentSpanId).toBe(root.spanId);
    expect(actions).toHaveLength(2);
    expect(actions.map(({ parentSpanId }) => parentSpanId)).toEqual([
      agent.spanId,
      agent.spanId,
    ]);
    expect(readback.parentSpanId).toBe(root.spanId);
    expect(environment.parentSpanId).toBe(root.spanId);
    expect(attributes(environment.attributes)).toEqual(
      new Map([
        ["benchmark.environment.capture.status", { stringValue: "complete" }],
        [
          "benchmark.environment.execution_lock.sha256",
          {
            stringValue:
              "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          },
        ],
        [
          "benchmark.environment.input.bundle_digest",
          {
            stringValue:
              "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          },
        ],
        [
          "benchmark.environment.modified.bundle_digest",
          {
            stringValue:
              "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
          },
        ],
      ]),
    );

    const traceIds = new Set(allSpans.map(({ traceId }) => traceId));
    expect(traceIds).toEqual(new Set([root.traceId]));
    expect(root.traceId).toMatch(/^[a-f0-9]{32}$/u);
    expect(root.traceId).not.toBe("00000000000000000000000000000000");
    expect(new Set(allSpans.map(({ spanId }) => spanId)).size).toBe(
      allSpans.length,
    );
    for (const span of allSpans) {
      expect(span.spanId).toMatch(/^[a-f0-9]{16}$/u);
      expect(span.spanId).not.toBe("0000000000000000");
      expect(span.kind).toEqual(expect.any(Number));
      expect(span.status.code).toEqual(expect.any(Number));
      expect(span.startTimeUnixNano).toMatch(/^\d+$/u);
      expect(span.endTimeUnixNano).toMatch(/^\d+$/u);
      expect(BigInt(span.endTimeUnixNano)).toBeGreaterThanOrEqual(
        BigInt(span.startTimeUnixNano),
      );
      expect(BigInt(span.startTimeUnixNano)).toBeGreaterThanOrEqual(
        BigInt(root.startTimeUnixNano),
      );
      expect(BigInt(span.endTimeUnixNano)).toBeLessThanOrEqual(
        BigInt(root.endTimeUnixNano),
      );
    }
    expect(
      resourceSpan.resource.attributes
        .flatMap(({ value }) => ("intValue" in value ? [value.intValue] : []))
        .every((value) => typeof value === "string"),
    ).toBe(true);
  });

  it("never places free-form commands, errors, paths, receipts, or secrets in OTLP attributes", () => {
    // Break caught: copying a normalized shell command, report detail, or raw
    // readback payload into an attribute would leak local paths and credentials.
    const secret = "super-secret-bearer-token";
    const localPath = "/Users/alice/private/source.mov";
    const input = baseInput();
    input.report.workspace = localPath;
    input.report.agent.error = `Authorization failed for ${secret} at ${localPath}`;
    input.report.evaluation.error = `Could not inspect ${localPath}`;
    input.report.evaluation.outcomeGate.detail = `Token ${secret} was rejected`;
    const normalized = input.trajectory!;
    normalized.actions = [
      {
        sequence: 1,
        source: "codex",
        sourceLine: 1,
        kind: "shell",
        operation: `curl -H 'Authorization: Bearer ${secret}' file://${localPath}`,
        status: "failed",
        observedAt: "1970-01-01T00:00:02.000Z",
        monotonicMs: 1_000,
        correlationId: secret,
        error: `ENOENT: ${localPath}; token=${secret}`,
      },
    ];
    input.productReadback = {
      status: "fail",
      url: `https://host.invalid/read?token=${secret}`,
      localPath,
      detail: `Readback failed with ${secret}`,
    };

    const document = buildBenchmarkOtlpTrace(input);
    const serialized = JSON.stringify(document);
    const action = spans(document).find(
      ({ name }) => name === "benchmark.agent.action",
    )!;
    const actionAttributes = attributes(action.attributes);

    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(localPath);
    expect(serialized).not.toContain("Authorization: Bearer");
    expect(serialized).not.toContain("opaque-receipt");
    expect(actionAttributes.has("benchmark.action.operation")).toBe(false);
    expect(actionAttributes.get("benchmark.action.payload.bytes")).toEqual({
      intValue: String(Buffer.byteLength(normalized.actions[0]!.operation)),
    });
    expect(actionAttributes.get("benchmark.action.payload.sha256")).toEqual({
      stringValue: createHash("sha256")
        .update(normalized.actions[0]!.operation)
        .digest("hex"),
    });
  });

  it("accepts only a sealed runner CLI trace whose receipt matches the exact bytes", () => {
    // Break caught: treating a forged or edited agent-authored CLI log as
    // trusted would make the trace claim product operations never observed.
    const traceText = [
      JSON.stringify({
        type: "clash.cli.started",
        argv: ["assets", "get", "--asset", "secret-id"],
      }),
      JSON.stringify({
        type: "clash.cli.completed",
        argv: ["assets", "get", "--asset", "secret-id"],
        exitCode: 0,
      }),
      JSON.stringify({
        type: "clash.cli.completed",
        argv: ["assets", "delete", "--asset", "secret-id"],
        exitCode: 2,
      }),
    ].join("\n");
    const sha256 = createHash("sha256").update(traceText).digest("hex");

    expect(
      summarizeTrustedCliTrace({
        traceText,
        receipt: {
          schemaVersion: 1,
          source: "runner-cli-proxy",
          status: "sealed",
          tracePath: "clash-cli-events.jsonl",
          traceSha256: sha256,
          eventCount: 3,
        },
      }),
    ).toEqual({
      status: "sealed",
      sha256,
      bytes: Buffer.byteLength(traceText),
      eventCount: 3,
      completedCount: 2,
      succeededCount: 1,
      failedCount: 1,
    });
    expect(() =>
      summarizeTrustedCliTrace({
        traceText: `${traceText}\nforged`,
        receipt: {
          schemaVersion: 1,
          source: "runner-cli-proxy",
          status: "sealed",
          tracePath: "clash-cli-events.jsonl",
          traceSha256: sha256,
          eventCount: 3,
        },
      }),
    ).toThrow(/SHA-256/u);
    expect(() =>
      summarizeTrustedCliTrace({
        traceText,
        receipt: {
          schemaVersion: 1,
          source: "runner-cli-proxy",
          status: "sealed",
          tracePath: "clash-cli-events.jsonl",
          traceSha256: sha256,
          eventCount: 4,
        },
      }),
    ).toThrow(/event count/u);
  });

  it("rejects a caller-injected CLI summary that was not produced by the sealed trace verifier", () => {
    // Break caught: the builder is public, so relying on TypeScript alone would
    // let an unvalidated string enter a supposedly trusted telemetry attribute.
    const input = baseInput();
    input.trustedCliTrace = {
      ...input.trustedCliTrace!,
      sha256: "not-a-content-digest",
    };

    expect(() => buildBenchmarkOtlpTrace(input)).toThrow(/trusted CLI/u);
  });

  it("writes trace.otlp.json and returns a content-addressed relative receipt without replacing raw logs", async () => {
    // Break caught: writing over raw evidence or returning an absolute,
    // machine-specific path would make run bundles lossy and non-portable.
    const caseRoot = await mkdtemp(join(tmpdir(), "clash-otel-export-"));
    temporaryRoots.push(caseRoot);
    const logsRoot = join(caseRoot, "logs");
    await mkdir(logsRoot);
    const rawPath = join(logsRoot, "events.jsonl");
    const originalRaw = '{"type":"agent.event","payload":"keep-me"}\n';
    await writeFile(rawPath, originalRaw, "utf8");

    const receipt = await writeBenchmarkOtlpTrace({
      ...baseInput(),
      caseRoot,
    });
    const output = await readFile(join(caseRoot, "trace.otlp.json"), "utf8");

    expect(receipt).toEqual({
      schemaVersion: 1,
      format: "otlp-json",
      path: "trace.otlp.json",
      bytes: Buffer.byteLength(output),
      sha256: createHash("sha256").update(output).digest("hex"),
      traceId: expect.stringMatching(/^[a-f0-9]{32}$/u),
      rootSpanId: expect.stringMatching(/^[a-f0-9]{16}$/u),
    });
    expect(JSON.parse(output)).toEqual(buildBenchmarkOtlpTrace(baseInput()));
    expect(await readFile(rawPath, "utf8")).toBe(originalRaw);
  });

  it("rejects an inverted case interval instead of emitting invalid span timing", () => {
    // Break caught: clamping a caller bug into a superficially valid trace
    // hides corrupt attempt timing and can invert every child span.
    expect(() =>
      buildBenchmarkOtlpTrace({
        ...baseInput(),
        startedAt: "1970-01-01T00:00:04.000Z",
        finishedAt: "1970-01-01T00:00:03.000Z",
      }),
    ).toThrow(/finishedAt/u);
  });
});
