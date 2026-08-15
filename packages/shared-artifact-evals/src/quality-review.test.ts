import { describe, expect, it } from "vitest";

import {
  createQualityReviewRequest,
  createQualityReviewResult,
  evaluateQualityReview,
  QualityJudgeResponseSchema,
} from "./quality-review";
import type {
  ArtifactBenchmarkCase,
  ArtifactEvaluationReport,
  QualityReviewResult,
} from "./types";

const FRAME_SHA =
  "1111111111111111111111111111111111111111111111111111111111111111";

function contentBenchmark(): ArtifactBenchmarkCase {
  return {
    id: "content-image",
    title: "Content image",
    category: "mixed",
    tags: ["content-effect"],
    outcome: {
      objective: "Make a readable premium product hero image.",
      acceptanceCriteria: [
        "The product remains the unmistakable focal point.",
        "The composition reads as premium rather than cluttered.",
      ],
      deliverables: [
        {
          artifactId: "hero",
          kind: "image",
          description: "Rendered hero frame",
        },
      ],
    },
    qualityCriteria: [
      {
        id: "focal-point",
        description: "The product remains the unmistakable focal point.",
        weight: 2,
        evidenceArtifactIds: ["hero"],
      },
      {
        id: "premium-read",
        description: "The composition reads as premium rather than cluttered.",
        weight: 1,
        evidenceKinds: ["image"],
      },
    ],
    passScore: 80,
    timeoutMs: 10_000,
    skills: [],
    execution: {
      profile: "clash-host",
      requiredProductOperations: ["timeline.render"],
      environment: {
        profile: "clash-workspace-v1",
        track: "content-effect",
        inputWorkspace: {
          path: "environments/base-v1",
          bundleDigest:
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
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
        id: "hero-exists",
        type: "artifact-exists",
        artifactId: "hero",
        weight: 1,
        required: true,
      },
    ],
  };
}

function technicalPass(): ArtifactEvaluationReport {
  return {
    schemaVersion: 1,
    benchmarkId: "content-image",
    taskId: "content-image",
    status: "pass",
    score: 100,
    checks: [
      {
        id: "hero-exists",
        type: "artifact-exists",
        status: "pass",
        required: true,
        weight: 1,
        awardedWeight: 1,
        detail: "The image exists and is technically valid.",
      },
    ],
    artifacts: [
      {
        id: "hero",
        kind: "image",
        path: "renders/hero.png",
        bytes: 2_048,
        sha256: FRAME_SHA,
      },
    ],
    outcomeGate: {
      status: "pass",
      detail: "All declared deliverables are present.",
      missingArtifactIds: [],
      invalidArtifactIds: [],
    },
  };
}

function technicalFailWithExactArtifact(): ArtifactEvaluationReport {
  const evaluation = technicalPass();
  return {
    ...evaluation,
    status: "fail",
    score: 0,
    checks: evaluation.checks.map((check) => ({
      ...check,
      status: "fail",
      awardedWeight: 0,
      detail:
        "The artifact exists as exact review evidence, but failed its technical acceptance check.",
    })),
  };
}

function acceptedJudgeResponse() {
  return {
    schemaVersion: 1 as const,
    criteria: [
      {
        id: "focal-point",
        score: 92,
        rationale: "The single product dominates the visual hierarchy.",
      },
      {
        id: "premium-read",
        score: 86,
        rationale: "Restrained lighting and spacing create a premium read.",
      },
    ],
    overallRationale:
      "The evidence satisfies both content-effect criteria without relying on technical validity alone.",
  };
}

describe("content-effect quality review", () => {
  it("creates an independent semantic request when technical checks fail but exact artifact evidence exists", () => {
    const request = createQualityReviewRequest({
      benchmark: contentBenchmark(),
      evaluation: technicalFailWithExactArtifact(),
    });

    expect(request.artifacts).toEqual([
      {
        id: "hero",
        kind: "image",
        bytes: 2_048,
        sha256: FRAME_SHA,
      },
    ]);
    expect(request).toEqual(
      createQualityReviewRequest({
        benchmark: contentBenchmark(),
        evaluation: technicalPass(),
      }),
    );
  });

  it("still rejects technically failing reports with missing or invalid artifact evidence", () => {
    const missingArtifact: ArtifactEvaluationReport = {
      ...technicalFailWithExactArtifact(),
      artifacts: [],
      outcomeGate: {
        status: "fail",
        detail: "The required artifact is missing.",
        missingArtifactIds: ["hero"],
        invalidArtifactIds: [],
      },
    };
    expect(() =>
      createQualityReviewRequest({
        benchmark: contentBenchmark(),
        evaluation: missingArtifact,
      }),
    ).toThrow(/lacks exact evaluated artifact evidence/i);

    const invalidArtifact: ArtifactEvaluationReport = {
      ...technicalFailWithExactArtifact(),
      outcomeGate: {
        status: "fail",
        detail: "The required artifact has invalid evidence.",
        missingArtifactIds: [],
        invalidArtifactIds: ["hero"],
      },
    };
    expect(() =>
      createQualityReviewRequest({
        benchmark: contentBenchmark(),
        evaluation: invalidArtifact,
      }),
    ).toThrow(/lacks exact evaluated artifact evidence/i);

    const malformedHash: ArtifactEvaluationReport = {
      ...technicalFailWithExactArtifact(),
      artifacts: technicalFailWithExactArtifact().artifacts.map((artifact) => ({
        ...artifact,
        sha256: "not-a-sha256",
      })),
    };
    expect(() =>
      createQualityReviewRequest({
        benchmark: contentBenchmark(),
        evaluation: malformedHash,
      }),
    ).toThrow();
  });

  it("keeps technically valid but semantically unreviewed content pending", () => {
    const request = createQualityReviewRequest({
      benchmark: contentBenchmark(),
      evaluation: technicalPass(),
    });

    const review = evaluateQualityReview({ request });

    expect(review.status).toBe("pending");
    expect(request.criteria.map(({ description }) => description)).toEqual([
      "The product remains the unmistakable focal point.",
      "The composition reads as premium rather than cluttered.",
    ]);
    expect(request.criteria.map(({ id }) => id)).toEqual([
      "focal-point",
      "premium-read",
    ]);
    expect(request.artifacts).toEqual([
      {
        id: "hero",
        kind: "image",
        bytes: 2_048,
        sha256: FRAME_SHA,
      },
    ]);
  });

  it("passes a result whose reviewer, rubric, response, and exact artifacts are bound", () => {
    const request = createQualityReviewRequest({
      benchmark: contentBenchmark(),
      evaluation: technicalPass(),
    });
    const result = createQualityReviewResult({
      request,
      reviewer: {
        kind: "human",
        provider: "internal-review-panel",
        model: "human",
        adapterVersion: "review-form-v1",
      },
      response: acceptedJudgeResponse(),
      prompt: "Judge the exact bound evidence against the exact rubric.",
      rawResponse: JSON.stringify(acceptedJudgeResponse()),
    });

    const review = evaluateQualityReview({ request, result });

    expect(review.status).toBe("pass");
    expect(result.aggregate).toEqual({
      score: 90,
      threshold: 80,
      status: "pass",
    });
    expect(result.requestSha256).toBe(request.requestSha256);
    expect(result.artifacts).toEqual(request.artifacts);
  });

  it("fails closed when a result names a stale artifact hash", () => {
    const request = createQualityReviewRequest({
      benchmark: contentBenchmark(),
      evaluation: technicalPass(),
    });
    const valid = createQualityReviewResult({
      request,
      reviewer: {
        kind: "codex",
        provider: "openai",
        model: "gpt-5.6-sol",
        adapterVersion: "codex-cli 0.147.0",
      },
      response: acceptedJudgeResponse(),
      prompt: "Judge the exact bound evidence against the exact rubric.",
      rawResponse: JSON.stringify(acceptedJudgeResponse()),
    });
    const stale: QualityReviewResult = {
      ...valid,
      artifacts: [
        {
          ...valid.artifacts[0]!,
          sha256:
            "9999999999999999999999999999999999999999999999999999999999999999",
        },
      ],
    };

    const review = evaluateQualityReview({ request, result: stale });

    expect(review.status).toBe("fail");
    expect(review.detail).toMatch(/artifact binding/i);
  });

  it("rejects judge responses with missing criteria or unbounded scores", () => {
    expect(
      QualityJudgeResponseSchema.safeParse({
        schemaVersion: 1,
        criteria: [
          {
            id: "focal-point",
            score: 101,
            rationale: "Looks fine.",
          },
        ],
        overallRationale: "Pass.",
      }).success,
    ).toBe(false);

    const request = createQualityReviewRequest({
      benchmark: contentBenchmark(),
      evaluation: technicalPass(),
    });
    expect(() =>
      createQualityReviewResult({
        request,
        reviewer: {
          kind: "codex",
          provider: "openai",
          model: "gpt-5.6-sol",
          adapterVersion: "codex-cli 0.147.0",
        },
        response: {
          schemaVersion: 1,
          criteria: acceptedJudgeResponse().criteria.slice(0, 1),
          overallRationale: "Only one criterion was judged.",
        },
        prompt: "Judge the exact bound evidence against the exact rubric.",
        rawResponse: JSON.stringify(acceptedJudgeResponse()),
      }),
    ).toThrow(/criteria.*exactly/i);
  });
});
