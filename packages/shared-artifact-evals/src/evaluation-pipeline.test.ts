import { describe, expect, it } from "vitest";

import { createBenchmarkEvaluationPipeline } from "./evaluation-pipeline";
import type {
  ArtifactBenchmarkCase,
  BenchmarkCaseReport,
  QualityReviewReport,
} from "./types";

const ATTEMPT_DIGEST = "a".repeat(64);

const TECHNICAL_EVIDENCE = [
  {
    path: "evaluation.json",
    bytes: 701,
    sha256: "b".repeat(64),
  },
  {
    path: "execution.json",
    bytes: 509,
    sha256: "c".repeat(64),
  },
] as const;

const QUALITY_EVIDENCE = [
  {
    path: "quality-review.json",
    bytes: 1_203,
    sha256: "d".repeat(64),
  },
] as const;

function benchmark(): ArtifactBenchmarkCase {
  return {
    id: "report-case",
    title: "Create a grounded report",
    category: "document",
    outcome: {
      objective: "Create the requested report in Clash.",
      acceptanceCriteria: ["The report is readable."],
      deliverables: [
        {
          artifactId: "final-report",
          kind: "report",
          description: "The final report.",
        },
      ],
    },
    passScore: 80,
    timeoutMs: 60_000,
    skills: [],
    execution: {
      profile: "clash-host",
      requiredProductOperations: ["asset.read"],
      environment: {
        profile: "clash-agent-environment-v1",
        track: "functional",
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
        id: "report-exists",
        type: "artifact-exists",
        artifactId: "final-report",
        weight: 1,
        required: true,
        minBytes: 10,
      },
    ],
  };
}

function report(): BenchmarkCaseReport {
  return {
    id: "report-case",
    workspace: "/benchmark/run/report-case/attempt-1/workspace",
    status: "pass",
    attempt: 1,
    agent: {
      status: "completed",
      exitCode: 0,
      signal: null,
      durationMs: 120,
      stdoutPath: "agent.stdout.log",
      stderrPath: "agent.stderr.log",
    },
    execution: {
      profile: "clash-host",
      status: "pass",
      requiredProductOperations: ["asset.read"],
      observedProductOperations: [
        {
          operation: "asset.read",
          transport: "mcp",
          invocation: "clash_asset_read",
        },
      ],
      missingProductOperations: [],
      forbiddenProductOperations: [],
      observedForbiddenProductOperations: [],
      requiredMcpTools: [],
      observedMcpTools: ["clash_asset_read"],
      missingMcpTools: [],
      requiredCliCommands: [],
      observedCliCommands: [],
      missingCliCommands: [],
      detail: "Required product readback was observed.",
    },
    evaluation: {
      schemaVersion: 1,
      benchmarkId: "report-case",
      taskId: "report-case",
      status: "pass",
      score: 90,
      checks: [
        {
          id: "report-exists",
          type: "artifact-exists",
          status: "pass",
          required: true,
          weight: 1,
          awardedWeight: 1,
          detail: "The submitted report exists.",
        },
      ],
      artifacts: [
        {
          id: "final-report",
          kind: "report",
          path: "report.md",
          bytes: 128,
          sha256: "e".repeat(64),
        },
      ],
      outcomeGate: {
        status: "pass",
        detail: "All required artifacts are valid.",
        missingArtifactIds: [],
        invalidArtifactIds: [],
      },
    },
    outcome: {
      schemaVersion: 1,
      caseId: "report-case",
      objective: "Create the requested report in Clash.",
      status: "achieved",
      score: 90,
      passScore: 80,
      agentStatus: "completed",
      evaluationStatus: "pass",
      executionStatus: "pass",
      completedAt: "2026-08-14T00:00:00.000Z",
    },
  };
}

function qualityReview(): QualityReviewReport {
  return {
    required: true,
    status: "pass",
    detail: "Independent content quality passed.",
    request: {
      schemaVersion: 1,
      kind: "clash.benchmark.quality-review-request",
      benchmarkId: "report-case",
      objective: "Create the requested report in Clash.",
      criteriaSource: "quality-criteria",
      criteria: [
        {
          id: "editorial-clarity",
          description: "The report communicates clearly.",
          weight: 1,
          evidenceArtifactIds: ["final-report"],
        },
      ],
      artifacts: [
        {
          id: "final-report",
          kind: "report",
          bytes: 128,
          sha256: "e".repeat(64),
        },
      ],
      passThreshold: 80,
      requestSha256: "f".repeat(64),
    },
    result: {
      schemaVersion: 1,
      kind: "clash.benchmark.quality-review-result",
      benchmarkId: "report-case",
      requestSha256: "f".repeat(64),
      artifacts: [
        {
          id: "final-report",
          kind: "report",
          bytes: 128,
          sha256: "e".repeat(64),
        },
      ],
      reviewer: {
        kind: "codex",
        provider: "openai",
        model: "gpt-5.6",
        adapterVersion: "1.0.0",
      },
      provenance: {
        promptSha256: "1".repeat(64),
        rubricSha256: "2".repeat(64),
        rawResponseSha256: "3".repeat(64),
      },
      criteria: [
        {
          id: "editorial-clarity",
          score: 84,
          rationale: "The hierarchy and prose are clear.",
        },
      ],
      aggregate: {
        score: 84,
        threshold: 80,
        status: "pass",
      },
      overallRationale: "The report is clear and well structured.",
    },
  };
}

function reverseObjectKeyOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, child]) => [key, reverseObjectKeyOrder(child)]),
    );
  }
  return value;
}

describe("Benchmark Evaluation pipeline adapter", () => {
  it("turns current technical reports into one score-bearing Evaluation bound to immutable Attempt evidence", () => {
    const result = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: benchmark(),
      report: report(),
      evidence: { technical: TECHNICAL_EVIDENCE },
    });

    expect(result.technicalEvaluation).toMatchObject({
      kind: "clash.benchmark.evaluation",
      attemptDigest: ATTEMPT_DIGEST,
      evaluator: {
        id: "clash.benchmark.technical-evaluator",
        version: "1",
      },
      spec: {
        id: "clash.benchmark.technical-spec",
        version: "1",
      },
      dimensions: [
        { id: "agent.completion", score: 100, verdict: "pass" },
        { id: "artifact.correctness", score: 90, verdict: "pass" },
        { id: "product.execution", score: 100, verdict: "pass" },
      ],
      evidence: TECHNICAL_EVIDENCE,
    });
    expect(result.evaluations).toEqual([result.technicalEvaluation]);
    expect(result.aggregate).toMatchObject({
      attemptDigest: ATTEMPT_DIGEST,
      evaluationDigests: [result.technicalEvaluation.digest],
      verdict: "pass",
      score: 90,
      policy: {
        id: "clash.benchmark.required-gates-aggregate",
        version: "1",
      },
    });
    expect(result.reward).toBeUndefined();
    expect(result.technicalEvaluation.evaluator.digest).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(result.technicalEvaluation.spec.digest).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("derives stable evaluator identity and a case-sensitive spec identity from canonical public subjects", () => {
    const first = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: benchmark(),
      report: report(),
      evidence: { technical: TECHNICAL_EVIDENCE },
    });
    const samePublicCase = reverseObjectKeyOrder(
      benchmark(),
    ) as ArtifactBenchmarkCase;
    const repeated = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: samePublicCase,
      report: structuredClone(report()),
      evidence: { technical: [...TECHNICAL_EVIDENCE].reverse() },
    });
    const changedCase = benchmark();
    const changedRubric = changedCase.rubric[0]!;
    if (changedRubric.type !== "artifact-exists") {
      throw new Error("Fixture requires an artifact-exists rubric");
    }
    changedCase.rubric[0] = {
      ...changedRubric,
      minBytes: 1_000,
    };
    const changed = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: changedCase,
      report: report(),
      evidence: { technical: TECHNICAL_EVIDENCE },
    });

    expect(repeated.technicalEvaluation.evaluator).toEqual(
      first.technicalEvaluation.evaluator,
    );
    expect(repeated.technicalEvaluation.spec).toEqual(
      first.technicalEvaluation.spec,
    );
    expect(repeated.technicalEvaluation.digest).toEqual(
      first.technicalEvaluation.digest,
    );
    expect(changed.technicalEvaluation.evaluator).toEqual(
      first.technicalEvaluation.evaluator,
    );
    expect(changed.technicalEvaluation.spec.digest).not.toEqual(
      first.technicalEvaluation.spec.digest,
    );
  });

  it("represents an independent quality Evaluation even when technical evaluation fails", () => {
    const contentBenchmark = benchmark();
    contentBenchmark.execution!.environment!.track = "content-effect";
    contentBenchmark.qualityCriteria = [
      {
        id: "editorial-clarity",
        description: "The report communicates clearly.",
        weight: 1,
        evidenceArtifactIds: ["final-report"],
      },
    ];
    const failedTechnical = report();
    failedTechnical.status = "fail";
    failedTechnical.evaluation.status = "fail";
    failedTechnical.evaluation.score = 35;
    failedTechnical.outcome.status = "failed";
    failedTechnical.outcome.score = 35;
    failedTechnical.outcome.evaluationStatus = "fail";
    failedTechnical.qualityReview = qualityReview();

    const result = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: contentBenchmark,
      report: failedTechnical,
      evidence: {
        technical: TECHNICAL_EVIDENCE,
        quality: QUALITY_EVIDENCE,
      },
    });

    expect(result.technicalEvaluation.dimensions).toContainEqual(
      expect.objectContaining({
        id: "artifact.correctness",
        score: 35,
        verdict: "fail",
      }),
    );
    expect(result.qualityEvaluation).toMatchObject({
      kind: "clash.benchmark.evaluation",
      attemptDigest: ATTEMPT_DIGEST,
      evaluator: {
        id: "clash.benchmark.quality-reviewer",
        version: "1",
      },
      spec: {
        id: "clash.benchmark.content-quality-spec",
        version: "1",
      },
      dimensions: [
        {
          id: "content.quality",
          score: 84,
          verdict: "pass",
          rationale: "The report is clear and well structured.",
        },
      ],
      evidence: QUALITY_EVIDENCE,
    });
    expect(result.evaluations).toHaveLength(2);
    expect(
      result.evaluations.every(
        (record) => record.attemptDigest === ATTEMPT_DIGEST,
      ),
    ).toBe(true);
    expect(result.aggregate.evaluationDigests).toEqual(
      [
        result.technicalEvaluation.digest,
        result.qualityEvaluation!.digest,
      ].sort(),
    );
    expect(result.aggregate).toMatchObject({ verdict: "fail", score: 35 });
  });

  it("changes quality evaluator identity with reviewer provenance without changing its public spec", () => {
    const contentBenchmark = benchmark();
    contentBenchmark.execution!.environment!.track = "content-effect";
    const firstReport = report();
    firstReport.qualityReview = qualityReview();
    const secondReport = structuredClone(firstReport);
    secondReport.qualityReview!.result!.reviewer.model = "gpt-5.7";

    const first = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: contentBenchmark,
      report: firstReport,
      evidence: {
        technical: TECHNICAL_EVIDENCE,
        quality: QUALITY_EVIDENCE,
      },
    });
    const second = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: contentBenchmark,
      report: secondReport,
      evidence: {
        technical: TECHNICAL_EVIDENCE,
        quality: QUALITY_EVIDENCE,
      },
    });

    expect(second.qualityEvaluation!.evaluator.digest).not.toEqual(
      first.qualityEvaluation!.evaluator.digest,
    );
    expect(second.qualityEvaluation!.spec).toEqual(
      first.qualityEvaluation!.spec,
    );
    expect(second.qualityEvaluation!.attemptDigest).toBe(ATTEMPT_DIGEST);
    expect(second.qualityEvaluation!.digest).not.toBe(
      first.qualityEvaluation!.digest,
    );
  });

  it("keeps an optional quality Evaluation independent from the selected Aggregate", () => {
    const optionalReview = qualityReview();
    optionalReview.required = false;
    optionalReview.status = "fail";
    optionalReview.result!.aggregate = {
      score: 40,
      threshold: 80,
      status: "fail",
    };
    const evaluatedReport = report();
    evaluatedReport.qualityReview = optionalReview;

    const result = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: benchmark(),
      report: evaluatedReport,
      evidence: {
        technical: TECHNICAL_EVIDENCE,
        quality: QUALITY_EVIDENCE,
      },
    });

    expect(result.qualityEvaluation).toMatchObject({
      attemptDigest: ATTEMPT_DIGEST,
      dimensions: [{ id: "content.quality", score: 40, verdict: "fail" }],
    });
    expect(result.aggregate).toMatchObject({
      evaluationDigests: [result.technicalEvaluation.digest],
      verdict: "pass",
      score: 90,
    });
  });

  it("represents a blocked non-run as pending Evaluation gates instead of a zero-score failure", () => {
    const blockedReport = report();
    blockedReport.status = "blocked";
    blockedReport.agent.status = "not-run";
    blockedReport.agent.exitCode = null;
    blockedReport.execution.status = "blocked";
    blockedReport.execution.detail = "The required Host was unavailable.";
    blockedReport.evaluation.status = "not-run";
    blockedReport.evaluation.score = 0;
    blockedReport.evaluation.outcomeGate.status = "fail";
    blockedReport.evaluation.outcomeGate.detail =
      "Artifact evaluation did not run.";
    blockedReport.outcome.status = "failed";
    blockedReport.outcome.score = 0;
    blockedReport.outcome.agentStatus = "not-run";
    blockedReport.outcome.executionStatus = "blocked";
    blockedReport.outcome.evaluationStatus = "not-run";

    const result = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: benchmark(),
      report: blockedReport,
      evidence: { technical: TECHNICAL_EVIDENCE },
    });

    expect(result.technicalEvaluation.dimensions).toEqual([
      expect.objectContaining({
        id: "agent.completion",
        score: 0,
        verdict: "pending",
      }),
      expect.objectContaining({
        id: "artifact.correctness",
        score: 0,
        verdict: "pending",
      }),
      expect.objectContaining({
        id: "product.execution",
        score: 0,
        verdict: "pending",
      }),
    ]);
    expect(result.aggregate).toMatchObject({ verdict: "pending", score: 0 });
  });

  it("rejects technical inputs that are bound to different benchmark cases", () => {
    const mismatchedReport = report();
    mismatchedReport.evaluation.benchmarkId = "different-case";

    expect(() =>
      createBenchmarkEvaluationPipeline({
        attemptDigest: ATTEMPT_DIGEST,
        benchmark: benchmark(),
        report: mismatchedReport,
        evidence: { technical: TECHNICAL_EVIDENCE },
      }),
    ).toThrow(/same benchmark case/iu);
  });

  it("rejects a quality result that has no exact evidence reference", () => {
    const evaluatedReport = report();
    evaluatedReport.qualityReview = qualityReview();

    expect(() =>
      createBenchmarkEvaluationPipeline({
        attemptDigest: ATTEMPT_DIGEST,
        benchmark: benchmark(),
        report: evaluatedReport,
        evidence: { technical: TECHNICAL_EVIDENCE },
      }),
    ).toThrow(/quality Evaluation.*evidence/iu);
  });

  it("rejects a quality result whose public Evaluation spec request is missing", () => {
    const evaluatedReport = report();
    evaluatedReport.qualityReview = qualityReview();
    delete evaluatedReport.qualityReview.request;

    expect(() =>
      createBenchmarkEvaluationPipeline({
        attemptDigest: ATTEMPT_DIGEST,
        benchmark: benchmark(),
        report: evaluatedReport,
        evidence: {
          technical: TECHNICAL_EVIDENCE,
          quality: QUALITY_EVIDENCE,
        },
      }),
    ).toThrow(/quality Evaluation.*request/iu);
  });

  it("leaves required missing quality pending and derives an optional Reward from the Aggregate", () => {
    const pendingReport = report();
    pendingReport.status = "pending-review";
    pendingReport.qualityReview = {
      required: true,
      status: "pending",
      detail: "An independent content review has not completed.",
    };

    const result = createBenchmarkEvaluationPipeline({
      attemptDigest: ATTEMPT_DIGEST,
      benchmark: benchmark(),
      report: pendingReport,
      evidence: { technical: TECHNICAL_EVIDENCE },
      includeReward: true,
    });

    expect(result.qualityEvaluation).toBeUndefined();
    expect(result.aggregate).toMatchObject({
      verdict: "pending",
      score: 90,
    });
    expect(result.reward).toMatchObject({
      attemptDigest: ATTEMPT_DIGEST,
      aggregateDigest: result.aggregate.digest,
      value: 0.9,
      components: [{ id: "aggregate-score", value: 0.9 }],
      policy: {
        id: "clash.benchmark.normalized-aggregate-reward",
        version: "1",
      },
    });
  });
});
