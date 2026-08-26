import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeWorkspaceBundleManifest } from "@clash/shared-runtime";
import {
  markActionAssetBindingAuthority,
  markDocumentAssetAuthority,
  markGeneratorAuthority,
  markProjectAssetAuthority,
} from "@clash/shared-types";
import { LoroDoc } from "loro-crdt";
import { afterEach, describe, expect, it } from "vitest";

import { writeBenchmarkAttempt } from "./attempt-manifest";
import { writeBenchmarkTaskManifest } from "./benchmark-task";
import {
  writeBenchmarkAttemptCapture,
  writeBenchmarkEnvironmentResult,
} from "./environment";
import type { ArtifactBenchmarkCase, BenchmarkCaseReport } from "./types";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function createWorkspaceBundle(
  root: string,
  projectId: string,
  revision = "initial",
) {
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
  return await writeWorkspaceBundleManifest(root, {
    schemaVersion: 1,
    kind: "clash.workspace.bundle",
    source: {
      projectId,
      display: { name: `Benchmark ${projectId}`, description: revision },
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
        sha256: sha256(snapshot),
        mode: "0644",
      },
    ],
    excluded: [],
  });
}

function benchmark(inputDigest: string): ArtifactBenchmarkCase {
  return {
    id: "asset-import",
    title: "Import an Asset",
    category: "asset",
    tags: ["agent-product"],
    outcome: {
      objective: "Import the supplied Asset.",
      acceptanceCriteria: ["The Asset is readable."],
      deliverables: [
        {
          artifactId: "review",
          kind: "report",
          description: "Import review",
        },
      ],
    },
    passScore: 100,
    timeoutMs: 10_000,
    skills: ["../../../plugins/clash/skills/clash"],
    execution: {
      profile: "clash-host",
      lane: "agent-product",
      requiredProductOperations: ["asset.import"],
      requiredCapabilities: ["project-asset-file-import"],
      preflight: {
        status: "ready",
        checks: [
          {
            capability: "project-asset-file-import",
            status: "available",
            detail: "The Asset import surface is available.",
          },
        ],
      },
      evidence: { traceRequired: true, submissionRequired: true },
      productReadback: {
        required: true,
        mechanism: "project-asset-receipt",
        artifactIds: ["review"],
        description: "Read the imported Asset back.",
      },
      environment: {
        profile: "clash-agent-environment-v1",
        track: "functional",
        requirements: {
          plugins: ["clash-asr", "clash"],
          models: ["whisper-local"],
          providers: ["local-runtime"],
        },
        initialState: {
          workspace: {
            format: "clash-workspace-v1",
            path: "environments/base-v1",
            bundleDigest: inputDigest,
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
        id: "review",
        type: "artifact-exists",
        artifactId: "review",
        weight: 1,
        required: true,
      },
    ],
  };
}

function report(
  caseRoot: string,
  status: "pass" | "fail" | "blocked",
): BenchmarkCaseReport {
  const executionStatus = status === "blocked" ? "blocked" : status;
  const evaluationStatus = status === "blocked" ? "not-run" : status;
  return {
    id: "asset-import",
    workspace: join(caseRoot, "workspace"),
    status,
    attempt: 1,
    agent: {
      status: status === "blocked" ? "not-run" : "completed",
      exitCode: status === "blocked" ? null : 0,
      signal: null,
      durationMs: status === "blocked" ? 0 : 500,
      stdoutPath: join(caseRoot, "logs", "events.jsonl"),
      stderrPath: join(caseRoot, "logs", "stderr.log"),
      trajectoryPath: join(caseRoot, "logs", "trajectory.json"),
    },
    execution: {
      profile: "clash-host",
      status: executionStatus,
      requiredProductOperations: ["asset.import"],
      observedProductOperations: [],
      missingProductOperations: status === "pass" ? [] : ["asset.import"],
      forbiddenProductOperations: [],
      observedForbiddenProductOperations: [],
      requiredMcpTools: [],
      observedMcpTools: [],
      missingMcpTools: [],
      requiredCliCommands: [],
      observedCliCommands: [],
      missingCliCommands: [],
      detail: status === "blocked" ? "Preflight blocked." : "Run complete.",
    },
    evaluation: {
      schemaVersion: 1,
      benchmarkId: "asset-import",
      taskId: status === "blocked" ? null : "asset-import",
      status: evaluationStatus,
      score: status === "pass" ? 100 : 0,
      checks: [],
      artifacts: [],
      outcomeGate: {
        status: status === "pass" ? "pass" : "fail",
        detail: "Environment test",
        missingArtifactIds: status === "pass" ? [] : ["review"],
        invalidArtifactIds: [],
      },
    },
    outcome: {
      schemaVersion: 1,
      caseId: "asset-import",
      objective: "Import the supplied Asset.",
      status:
        status === "pass"
          ? "achieved"
          : status === "blocked"
            ? "blocked"
            : "failed",
      score: status === "pass" ? 100 : 0,
      passScore: 100,
      agentStatus: status === "blocked" ? "not-run" : "completed",
      evaluationStatus,
      executionStatus,
      completedAt: "2026-08-14T08:00:02.000Z",
    },
  };
}

async function writeCaseEvidence(
  caseRoot: string,
  caseReport: BenchmarkCaseReport,
  benchmarkCase: ArtifactBenchmarkCase,
) {
  const cliTrace = [
    JSON.stringify({
      type: "clash.cli.started",
      argv: ["asset", "get"],
    }),
    JSON.stringify({
      type: "clash.cli.completed",
      argv: ["asset", "get"],
      exitCode: 0,
    }),
  ].join("\n");
  await mkdir(join(caseRoot, "logs"), { recursive: true });
  await mkdir(join(caseRoot, "workspace"), { recursive: true });
  await writeBenchmarkTaskManifest({
    caseRoot,
    suiteId: "functional-suite",
    track: benchmarkCase.execution?.environment?.track ?? "functional",
    benchmark: benchmarkCase,
  });
  const blocked = caseReport.status === "blocked";
  const atifText = `${JSON.stringify({
    schema_version: "ATIF-v1.7",
    agent: { name: "codex", version: "codex-cli-test", model_name: "gpt-5" },
    steps: [],
  })}\n`;
  await Promise.all([
    writeFile(
      join(caseRoot, "environment-lock.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "clash.benchmark.environment-lock",
        executionIntent: blocked ? "blocked-no-run" : "execute",
        agent: {
          adapter: "codex",
          provider: { kind: "adapter-bound", id: "openai" },
          model: blocked
            ? { kind: "unselected" }
            : { kind: "explicit", id: "gpt-5" },
        },
        skills: [],
        requirements: {
          capabilities: [],
          productOperations: [],
          generatorDefinitions: [],
          plugins: [],
          models: blocked ? [] : ["gpt-5"],
          providers: ["openai"],
        },
      })}\n`,
      "utf8",
    ),
    writeFile(join(caseRoot, "logs", "events.jsonl"), "{}\n", "utf8"),
    writeFile(
      join(caseRoot, "logs", "clash-cli-events.jsonl"),
      cliTrace,
      "utf8",
    ),
    writeFile(
      join(caseRoot, "logs", "clash-cli-trace-receipt.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        source: "runner-cli-proxy",
        status: "sealed",
        tracePath: "clash-cli-events.jsonl",
        traceSha256: sha256(cliTrace),
        eventCount: 2,
      })}\n`,
      "utf8",
    ),
    writeFile(join(caseRoot, "logs", "stderr.log"), "", "utf8"),
    writeFile(
      join(caseRoot, "logs", "trajectory.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        sourceTraces: [],
        actions: [],
        repairs: [],
        turns: [],
        usage: {
          turnCount: 0,
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
        },
        errors: [],
        summary: {
          actionCount: 0,
          failedActionCount: 0,
          repairCount: 0,
          turnCount: 0,
        },
        usability: {
          successfulClashActionCount: 0,
          failedClashActionCount: 0,
          errorCodes: [],
          recoveryCount: 0,
          parameterErrorCount: 0,
          helpActionCount: 0,
          contractDiscoveryActionCount: 0,
          contractResponseBytes: 0,
          largestContractResponseBytes: 0,
          transportsUsed: [],
          transportSwitchCount: 0,
        },
      })}\n`,
      "utf8",
    ),
    writeFile(
      join(caseRoot, "case-report.json"),
      `${JSON.stringify(caseReport)}\n`,
      "utf8",
    ),
    writeFile(
      join(caseRoot, "evaluation.json"),
      `${JSON.stringify(caseReport.evaluation)}\n`,
      "utf8",
    ),
    writeFile(
      join(caseRoot, "execution.json"),
      `${JSON.stringify(caseReport.execution)}\n`,
      "utf8",
    ),
    writeFile(
      join(caseRoot, "outcome-result.json"),
      `${JSON.stringify(caseReport.outcome)}\n`,
      "utf8",
    ),
    ...(!blocked
      ? [
          writeFile(
            join(caseRoot, "logs", "trajectory.atif.json"),
            atifText,
            "utf8",
          ),
          writeFile(
            join(caseRoot, "logs", "trajectory.atif-receipt.json"),
            `${JSON.stringify({
              schemaVersion: 1,
              kind: "clash.benchmark.atif-receipt",
              format: "ATIF-v1.7",
              path: "trajectory.atif.json",
              bytes: Buffer.byteLength(atifText),
              sha256: sha256(atifText),
              fidelity: "structured-projection",
              redactionCount: 0,
              trainingEligible: true,
              source: {
                format: "codex-exec-jsonl",
                bytes: 3,
                sha256: sha256("{}\n"),
                lines: 1,
              },
            })}\n`,
            "utf8",
          ),
        ]
      : []),
  ]);
}

describe("benchmark Environment transition", () => {
  it("seals every readback from a failed content-effect rollout into its score-free Attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-failed-attempt-"));
    roots.push(root);
    const suiteRoot = join(root, "suite");
    const caseRoot = join(root, "case");
    const inputRoot = join(suiteRoot, "environments", "base-v1");
    const modifiedRoot = join(caseRoot, "modified-workspace");
    const input = await createWorkspaceBundle(inputRoot, "input-project");
    await createWorkspaceBundle(modifiedRoot, "input-project", "modified");
    const benchmarkCase = benchmark(input.integrity.bundleDigest);
    benchmarkCase.tags = [...(benchmarkCase.tags ?? []), "content-effect"];
    benchmarkCase.qualityCriteria = [
      {
        id: "content-quality",
        description: "The review communicates a clear and useful result.",
        weight: 1,
        evidenceArtifactIds: ["review"],
      },
    ];
    benchmarkCase.execution!.environment!.track = "content-effect";
    const caseReport = report(caseRoot, "fail");
    caseReport.execution.productReadback = {
      status: "fail",
      receiptPath: "product-readback.json",
      matchedArtifactIds: ["director-stage"],
      detail: "Director readback passed; Remotion readback failed.",
    };
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);
    await Promise.all([
      writeFile(
        join(caseRoot, "director-readback.json"),
        `${JSON.stringify({ schemaVersion: 1, status: "pass" })}\n`,
      ),
      writeFile(
        join(caseRoot, "remotion-readback.json"),
        `${JSON.stringify({ schemaVersion: 1, status: "fail" })}\n`,
      ),
      writeFile(
        join(caseRoot, "product-readback.json"),
        `${JSON.stringify({
          schemaVersion: 1,
          status: "fail",
          reports: [
            { schemaVersion: 1, status: "pass" },
            { schemaVersion: 1, status: "fail" },
          ],
        })}\n`,
      ),
    ]);

    const capture = await writeBenchmarkAttemptCapture({
      caseRoot,
      suiteId: "functional-suite",
      runId: "failed-content-effect-run",
      benchmark: benchmarkCase,
      agent: { adapter: "codex", model: "gpt-5" },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-14T08:00:00.000Z",
      finishedAt: "2026-08-14T08:00:02.000Z",
      inputWorkspaceBundle: inputRoot,
      modifiedWorkspaceCapture: { status: "complete", path: modifiedRoot },
      serviceVersion: "0.1.0",
    });

    expect(capture.evidence.map(({ path }) => path)).toEqual([
      "director-readback.json",
      "product-readback.json",
      "remotion-readback.json",
      "task.json",
    ]);
    const receipt = await writeBenchmarkAttempt({ caseRoot, suiteRoot });
    const attempt = JSON.parse(
      await readFile(join(caseRoot, receipt.path), "utf8"),
    ) as {
      attempt: { status: string; track: string };
      evidence: { readback: Array<{ path: string }> };
    };
    expect(attempt.attempt).toMatchObject({
      status: "completed",
      track: "content-effect",
    });
    expect(attempt.evidence.readback.map(({ path }) => path)).toEqual([
      "director-readback.json",
      "product-readback.json",
      "remotion-readback.json",
    ]);
  });

  it("records exact input and modified Workspace digests even when evaluation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-environment-"));
    roots.push(root);
    const caseRoot = join(root, "case");
    const inputRoot = join(root, "suite", "environments", "base-v1");
    const modifiedRoot = join(caseRoot, "modified-workspace");
    const input = await createWorkspaceBundle(inputRoot, "input-project");
    const modified = await createWorkspaceBundle(
      modifiedRoot,
      "input-project",
      "modified",
    );
    const benchmarkCase = benchmark(input.integrity.bundleDigest);
    const caseReport = report(caseRoot, "fail");
    caseReport.execution.productReadback = {
      status: "pass",
      receiptPath: "asset-readback.json",
      matchedArtifactIds: ["review"],
      detail: "Trusted readback passed.",
    };
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);
    const trustedReadback = {
      schemaVersion: 1,
      status: "pass",
      matchedArtifactIds: ["review"],
      hostReceipt: "opaque-local-receipt",
    };
    await writeFile(
      join(caseRoot, "asset-readback.json"),
      `${JSON.stringify(trustedReadback)}\n`,
      "utf8",
    );

    const result = await writeBenchmarkAttemptCapture({
      caseRoot,
      suiteId: "functional-suite",
      runId: "run-1",
      benchmark: benchmarkCase,
      agent: {
        adapter: "codex",
        model: "gpt-5",
        clashHost: { pluginRoot: "/private/plugins/clash", profile: "dev" },
      },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-14T08:00:00.000Z",
      finishedAt: "2026-08-14T08:00:02.000Z",
      inputWorkspaceBundle: inputRoot,
      modifiedWorkspaceCapture: { status: "complete", path: modifiedRoot },
      serviceVersion: "0.1.0",
    });

    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("reports");
    expect(result).not.toHaveProperty("qualityReview");
    expect(result).toHaveProperty("rollout.status", "completed");
    expect(result).toMatchObject({
      schemaVersion: 1,
      kind: "clash.benchmark.attempt-capture",
      rollout: {
        status: "completed",
        startedAt: "2026-08-14T08:00:00.000Z",
        finishedAt: "2026-08-14T08:00:02.000Z",
      },
      gate: { status: "ready" },
      capture: { status: "complete" },
      track: "functional",
      inputWorkspace: {
        path: "environments/base-v1",
        bundleDigest: input.integrity.bundleDigest,
      },
      modifiedWorkspace: {
        path: "modified-workspace",
        bundleDigest: modified.integrity.bundleDigest,
      },
      trajectory: {
        raw: { path: "logs/events.jsonl" },
        normalized: { path: "logs/trajectory.json" },
      },
      atif: {
        status: "complete",
        format: "ATIF-v1.7",
        fidelity: "structured-projection",
        trajectory: { path: "logs/trajectory.atif.json" },
        receipt: { path: "logs/trajectory.atif-receipt.json" },
        trainingEligible: true,
        redactionCount: 0,
      },
      otlp: {
        trace: { path: "trace.otlp.json" },
        receipt: { path: "trace-receipt.json" },
      },
      executionLock: { path: "environment-lock.json" },
    });
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ path: "task.json" }),
    );
    expect(result.inputWorkspace!.bundleDigest).not.toBe(
      result.modifiedWorkspace?.bundleDigest,
    );
    await expect(
      readFile(join(caseRoot, "attempt-capture.json"), "utf8"),
    ).resolves.toContain(result.modifiedWorkspace!.bundleDigest);
    const otlp = JSON.parse(
      await readFile(join(caseRoot, "trace.otlp.json"), "utf8"),
    ) as {
      resourceSpans: Array<{
        scopeSpans: Array<{
          spans: Array<{
            name: string;
            attributes: Array<{ key: string; value: unknown }>;
            events?: Array<{ name: string }>;
          }>;
        }>;
      }>;
    };
    const spans = otlp.resourceSpans[0]!.scopeSpans[0]!.spans;
    expect(
      spans
        .find(({ name }) => name === "benchmark.agent.run")
        ?.events?.map(({ name }) => name),
    ).toContain("benchmark.cli_trace.sealed");
    const readbackAttributes = new Map(
      spans
        .find(({ name }) => name === "benchmark.host.readback")!
        .attributes.map(({ key, value }) => [key, value]),
    );
    expect(readbackAttributes.get("benchmark.readback.payload.sha256")).toEqual(
      {
        stringValue: sha256(JSON.stringify(trustedReadback)),
      },
    );
    const environmentAttributes = new Map(
      spans
        .find(({ name }) => name === "benchmark.environment.capture")!
        .attributes.map(({ key, value }) => [key, value]),
    );
    expect(environmentAttributes).toMatchObject(
      new Map([
        ["benchmark.environment.capture.status", { stringValue: "complete" }],
        [
          "benchmark.environment.input.bundle_digest",
          { stringValue: input.integrity.bundleDigest },
        ],
        [
          "benchmark.environment.modified.bundle_digest",
          { stringValue: modified.integrity.bundleDigest },
        ],
        [
          "benchmark.environment.execution_lock.sha256",
          { stringValue: result.executionLock.sha256 },
        ],
      ]),
    );
    await expect(
      readFile(join(caseRoot, "trace-receipt.json"), "utf8"),
    ).resolves.toContain(result.otlp.trace.sha256);
    const executionLock = await readFile(
      join(caseRoot, "environment-lock.json"),
      "utf8",
    );
    expect(JSON.parse(executionLock)).toMatchObject({
      executionIntent: "execute",
      agent: {
        adapter: "codex",
        provider: { kind: "adapter-bound", id: "openai" },
        model: { kind: "explicit", id: "gpt-5" },
      },
      requirements: {
        models: ["gpt-5"],
        providers: ["openai"],
      },
    });
    expect(executionLock).not.toMatch(/\/private|CLASH_HOME|credential|pid/iu);
  });

  it("seals a completed Pi ATIF projection and receipt into the score-free Attempt", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-pi-atif-"));
    roots.push(root);
    const suiteRoot = join(root, "suite");
    const caseRoot = join(root, "case");
    const inputRoot = join(suiteRoot, "environments", "base-v1");
    const modifiedRoot = join(caseRoot, "modified-workspace");
    const input = await createWorkspaceBundle(inputRoot, "input-project");
    await createWorkspaceBundle(modifiedRoot, "input-project", "modified");
    const benchmarkCase = benchmark(input.integrity.bundleDigest);
    const caseReport = report(caseRoot, "pass");
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);
    await writeFile(
      join(caseRoot, "environment-lock.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "clash.benchmark.environment-lock",
        executionIntent: "execute",
        agent: {
          adapter: "pi",
          provider: { kind: "explicit", id: "test-provider" },
          model: { kind: "explicit", id: "test-model" },
        },
        skills: [],
        requirements: {
          capabilities: [],
          productOperations: [],
          generatorDefinitions: [],
          plugins: [],
          models: ["test-model"],
          providers: ["test-provider"],
        },
      })}\n`,
      "utf8",
    );

    const capture = await writeBenchmarkAttemptCapture({
      caseRoot,
      suiteId: "functional-suite",
      runId: "pi-atif-run",
      benchmark: benchmarkCase,
      agent: {
        adapter: "pi",
        provider: "test-provider",
        model: "test-model",
      },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-15T08:00:00.000Z",
      finishedAt: "2026-08-15T08:00:02.000Z",
      inputWorkspaceBundle: inputRoot,
      modifiedWorkspaceCapture: { status: "complete", path: modifiedRoot },
      serviceVersion: "0.1.0",
    });

    expect(capture.atif).toMatchObject({
      status: "complete",
      format: "ATIF-v1.7",
      trajectory: { path: "logs/trajectory.atif.json" },
      receipt: { path: "logs/trajectory.atif-receipt.json" },
    });
    await writeBenchmarkAttempt({ caseRoot, suiteRoot });
    const attempt = JSON.parse(
      await readFile(join(caseRoot, "attempt.json"), "utf8"),
    ) as {
      evidence: {
        trajectories: { native: { adapter: string }; atif?: { path: string } };
        logs: Array<{ path: string }>;
      };
    };
    expect(attempt.evidence.trajectories).toMatchObject({
      native: { adapter: "pi" },
      atif: { path: "logs/trajectory.atif.json" },
    });
    expect(attempt.evidence.logs).toContainEqual(
      expect.objectContaining({
        path: "logs/trajectory.atif-receipt.json",
      }),
    );
  });

  it("seals an ATIF projection infrastructure failure without requiring a missing receipt", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-atif-failure-"));
    roots.push(root);
    const suiteRoot = join(root, "suite");
    const caseRoot = join(root, "case");
    const inputRoot = join(suiteRoot, "environments", "base-v1");
    const modifiedRoot = join(caseRoot, "modified-workspace");
    const input = await createWorkspaceBundle(inputRoot, "input-project");
    await createWorkspaceBundle(modifiedRoot, "input-project", "modified");
    const benchmarkCase = benchmark(input.integrity.bundleDigest);
    const caseReport = report(caseRoot, "fail");
    caseReport.failure = {
      classification: "infrastructure",
      retryable: true,
      phase: "atif-projection",
      detail: "Unsupported Pi control event",
    };
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);
    await Promise.all([
      rm(join(caseRoot, "logs", "trajectory.atif.json")),
      rm(join(caseRoot, "logs", "trajectory.atif-receipt.json")),
    ]);

    const capture = await writeBenchmarkAttemptCapture({
      caseRoot,
      suiteId: "functional-suite",
      runId: "pi-atif-failure-run",
      benchmark: benchmarkCase,
      agent: {
        adapter: "pi",
        provider: "test-provider",
        model: "test-model",
      },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-15T08:00:00.000Z",
      finishedAt: "2026-08-15T08:00:02.000Z",
      inputWorkspaceBundle: inputRoot,
      modifiedWorkspaceCapture: { status: "complete", path: modifiedRoot },
      serviceVersion: "0.1.0",
    });

    expect(capture.atif).toEqual({
      status: "unsupported",
      format: "ATIF-v1.7",
      detail: "Unsupported Pi control event",
    });
    await expect(
      writeBenchmarkAttempt({ caseRoot, suiteRoot }),
    ).resolves.toMatchObject({ path: "attempt.json" });
  });

  it("emits a blocked result without fabricating either Workspace bundle", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-blocked-"));
    roots.push(root);
    const caseRoot = join(root, "case");
    const benchmarkCase = benchmark("a".repeat(64));
    benchmarkCase.execution = {
      ...benchmarkCase.execution!,
      lane: "blocked-contract",
      preflight: {
        status: "blocked",
        checks: [
          {
            capability: "project-asset-file-import",
            status: "missing",
            detail: "The import surface is unavailable.",
          },
        ],
      },
      environment: {
        ...benchmarkCase.execution!.environment!,
      },
    };
    delete benchmarkCase.execution.environment!.initialState;
    const caseReport = report(caseRoot, "blocked");
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);

    const result = await writeBenchmarkEnvironmentResult({
      caseRoot,
      suiteId: "functional-suite",
      runId: "run-1",
      benchmark: benchmarkCase,
      agent: { adapter: "codex" },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-14T08:00:00.000Z",
      finishedAt: "2026-08-14T08:00:00.001Z",
      modifiedWorkspaceCapture: { status: "blocked" },
      serviceVersion: "0.1.0",
    });

    expect(result).toMatchObject({
      rollout: { status: "not-run" },
      gate: { status: "blocked" },
      capture: { status: "blocked" },
    });
    expect(result.inputWorkspace).toBeUndefined();
    expect(result.modifiedWorkspace).toBeUndefined();
    const executionLock = JSON.parse(
      await readFile(join(caseRoot, "environment-lock.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(executionLock).toMatchObject({
      agent: {
        adapter: "codex",
        provider: { kind: "adapter-bound", id: "openai" },
        model: { kind: "unselected" },
      },
      requirements: {
        providers: ["openai"],
      },
    });
  });

  it("records a ready-gate export failure without inventing a modified digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-capture-fail-"));
    roots.push(root);
    const caseRoot = join(root, "case");
    const inputRoot = join(root, "suite", "environments", "base-v1");
    const input = await createWorkspaceBundle(inputRoot, "input-project");
    const benchmarkCase = benchmark(input.integrity.bundleDigest);
    const caseReport = report(caseRoot, "fail");
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);

    const result = await writeBenchmarkEnvironmentResult({
      caseRoot,
      suiteId: "functional-suite",
      runId: "run-1",
      benchmark: benchmarkCase,
      agent: { adapter: "codex", model: "gpt-5" },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-14T08:00:00.000Z",
      finishedAt: "2026-08-14T08:00:02.000Z",
      inputWorkspaceBundle: inputRoot,
      modifiedWorkspaceCapture: {
        status: "failed",
        error: "Workspace export failed after the agent exited",
      },
      serviceVersion: "0.1.0",
    });

    expect(result.capture.status).toBe("failed");
    if (result.capture.status !== "failed") return;
    expect(result.capture.error).toMatchObject({ bytes: 46 });
    expect(result.modifiedWorkspace).toBeUndefined();
  });

  it("records empty provider requirements instead of inferring credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-lock-empty-"));
    roots.push(root);
    const caseRoot = join(root, "case");
    const benchmarkCase = benchmark("a".repeat(64));
    benchmarkCase.execution = {
      ...benchmarkCase.execution!,
      lane: "blocked-contract",
      preflight: {
        status: "blocked",
        checks: [
          {
            capability: "project-asset-file-import",
            status: "missing",
            detail: "Unavailable for this lock-only case.",
          },
        ],
      },
      environment: {
        ...benchmarkCase.execution!.environment!,
      },
    };
    delete benchmarkCase.execution.environment!.requirements;
    delete benchmarkCase.execution.environment!.initialState;
    const caseReport = report(caseRoot, "blocked");
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);
    await writeFile(
      join(caseRoot, "environment-lock.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "clash.benchmark.environment-lock",
        executionIntent: "blocked-no-run",
        agent: {
          adapter: "command",
          provider: { kind: "unselected" },
          model: { kind: "unselected" },
        },
        skills: [],
        requirements: {
          capabilities: [],
          productOperations: [],
          generatorDefinitions: [],
          plugins: [],
          models: [],
          providers: [],
        },
      })}\n`,
      "utf8",
    );

    await writeBenchmarkEnvironmentResult({
      caseRoot,
      suiteId: "functional-suite",
      runId: "run-1",
      benchmark: benchmarkCase,
      agent: { adapter: "command", command: "agent" },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-14T08:00:00.000Z",
      finishedAt: "2026-08-14T08:00:00.001Z",
      modifiedWorkspaceCapture: { status: "blocked" },
      serviceVersion: "0.1.0",
    });

    const executionLock = JSON.parse(
      await readFile(join(caseRoot, "environment-lock.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(executionLock).toMatchObject({
      agent: {
        adapter: "command",
        provider: { kind: "unselected" },
        model: { kind: "unselected" },
      },
      requirements: { plugins: [], models: [], providers: [] },
    });
  });

  it("rejects a forged trusted CLI receipt before emitting OTLP", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-forged-trace-"));
    roots.push(root);
    const caseRoot = join(root, "case");
    const inputRoot = join(root, "suite", "environments", "base-v1");
    const input = await createWorkspaceBundle(inputRoot, "input-project");
    const benchmarkCase = benchmark(input.integrity.bundleDigest);
    const caseReport = report(caseRoot, "fail");
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);
    const receiptPath = join(caseRoot, "logs", "clash-cli-trace-receipt.json");
    const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as {
      traceSha256: string;
    };
    receipt.traceSha256 = "f".repeat(64);
    await writeFile(receiptPath, `${JSON.stringify(receipt)}\n`, "utf8");

    await expect(
      writeBenchmarkEnvironmentResult({
        caseRoot,
        suiteId: "functional-suite",
        runId: "run-1",
        benchmark: benchmarkCase,
        agent: { adapter: "codex" },
        report: caseReport,
        attempt: 1,
        startedAt: "2026-08-14T08:00:00.000Z",
        finishedAt: "2026-08-14T08:00:02.000Z",
        inputWorkspaceBundle: inputRoot,
        modifiedWorkspaceCapture: {
          status: "failed",
          error: "Workspace export failed",
        },
        serviceVersion: "0.1.0",
      }),
    ).rejects.toThrow(/SHA-256/u);
  });

  it("still emits a failed Environment when infrastructure stopped the agent before tracing", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-bench-no-agent-trace-"));
    roots.push(root);
    const caseRoot = join(root, "case");
    const inputRoot = join(root, "suite", "environments", "base-v1");
    const input = await createWorkspaceBundle(inputRoot, "input-project");
    const benchmarkCase = benchmark(input.integrity.bundleDigest);
    const caseReport = report(caseRoot, "fail");
    caseReport.agent.status = "not-run";
    caseReport.agent.exitCode = null;
    caseReport.agent.durationMs = 0;
    caseReport.failure = {
      classification: "infrastructure",
      retryable: true,
      phase: "environment-import",
      detail: "The Host stopped before Agent launch.",
    };
    await writeCaseEvidence(caseRoot, caseReport, benchmarkCase);
    await Promise.all([
      rm(join(caseRoot, "logs", "clash-cli-events.jsonl")),
      rm(join(caseRoot, "logs", "clash-cli-trace-receipt.json")),
    ]);

    const result = await writeBenchmarkEnvironmentResult({
      caseRoot,
      suiteId: "functional-suite",
      runId: "run-1",
      benchmark: benchmarkCase,
      agent: { adapter: "codex", model: "gpt-5" },
      report: caseReport,
      attempt: 1,
      startedAt: "2026-08-14T08:00:00.000Z",
      finishedAt: "2026-08-14T08:00:00.100Z",
      inputWorkspaceBundle: inputRoot,
      modifiedWorkspaceCapture: {
        status: "failed",
        error: "Workspace import failed before Agent launch",
      },
      serviceVersion: "0.1.0",
    });

    expect(result).toMatchObject({
      rollout: { status: "not-run" },
      gate: { status: "ready" },
      capture: { status: "failed" },
    });
  });
});
