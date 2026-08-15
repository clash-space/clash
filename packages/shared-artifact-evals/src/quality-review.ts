import { createHash } from "node:crypto";

import {
  QualityJudgeResponseSchema,
  QualityReviewerProvenanceSchema,
  QualityReviewRequestSchema,
  QualityReviewResultSchema,
} from "./schemas";
import type {
  ArtifactBenchmarkCase,
  ArtifactEvaluationReport,
  QualityJudgeResponse,
  QualityReviewReport,
  QualityReviewRequest,
  QualityReviewResult,
  QualityReviewerProvenance,
} from "./types";

export { QualityJudgeResponseSchema } from "./schemas";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function requestDigest(
  request: Omit<QualityReviewRequest, "requestSha256"> | QualityReviewRequest,
): string {
  const { requestSha256: _requestSha256, ...unsigned } =
    request as QualityReviewRequest;
  return sha256(canonicalJson(unsigned));
}

function expectedAggregate(input: {
  request: QualityReviewRequest;
  response: QualityJudgeResponse;
}): QualityReviewResult["aggregate"] {
  const scoreById = new Map(
    input.response.criteria.map((criterion) => [criterion.id, criterion.score]),
  );
  const totalWeight = input.request.criteria.reduce(
    (sum, criterion) => sum + criterion.weight,
    0,
  );
  const weightedScore = input.request.criteria.reduce(
    (sum, criterion) => sum + scoreById.get(criterion.id)! * criterion.weight,
    0,
  );
  const score = Math.round((weightedScore / totalWeight) * 100) / 100;
  return {
    score,
    threshold: input.request.passThreshold,
    status: score >= input.request.passThreshold ? "pass" : "fail",
  };
}

function exactCriterionIds(
  request: QualityReviewRequest,
  response: QualityJudgeResponse,
): boolean {
  return (
    request.criteria.length === response.criteria.length &&
    request.criteria.every(
      (criterion, index) => criterion.id === response.criteria[index]?.id,
    )
  );
}

export function createQualityReviewRequest(input: {
  benchmark: ArtifactBenchmarkCase;
  evaluation: ArtifactEvaluationReport;
}): QualityReviewRequest {
  if (input.benchmark.execution?.environment?.track !== "content-effect") {
    throw new Error(
      "A quality review request is only valid for the content-effect track",
    );
  }
  if (input.evaluation.benchmarkId !== input.benchmark.id) {
    throw new Error(
      "A quality review request requires artifact evidence bound to the matching benchmark",
    );
  }
  const qualityCriteria = input.benchmark.qualityCriteria;
  if (!qualityCriteria?.length) {
    throw new Error(
      "A content-effect quality review requires explicit quality criteria",
    );
  }
  const evaluationById = new Map(
    input.evaluation.artifacts.map((artifact) => [artifact.id, artifact]),
  );
  const unavailableArtifactIds = new Set([
    ...input.evaluation.outcomeGate.missingArtifactIds,
    ...input.evaluation.outcomeGate.invalidArtifactIds,
  ]);
  const criteria = qualityCriteria.map((criterion) => {
    const evidenceArtifactIds = [
      ...new Set([
        ...(criterion.evidenceArtifactIds ?? []),
        ...input.evaluation.artifacts
          .filter((artifact) =>
            criterion.evidenceKinds?.includes(artifact.kind),
          )
          .map(({ id }) => id),
      ]),
    ];
    if (
      evidenceArtifactIds.length === 0 ||
      evidenceArtifactIds.some(
        (artifactId) =>
          !evaluationById.has(artifactId) ||
          unavailableArtifactIds.has(artifactId),
      )
    ) {
      throw new Error(
        `Quality criterion '${criterion.id}' lacks exact evaluated artifact evidence`,
      );
    }
    return {
      id: criterion.id,
      description: criterion.description,
      weight: criterion.weight,
      evidenceArtifactIds,
    };
  });
  const requiredArtifactIds = new Set(
    criteria.flatMap(({ evidenceArtifactIds }) => evidenceArtifactIds),
  );
  const artifacts = input.evaluation.artifacts
    .filter(({ id }) => requiredArtifactIds.has(id))
    .map(({ id, kind, bytes, sha256: artifactSha256 }) => ({
      id,
      kind,
      bytes,
      sha256: artifactSha256,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (artifacts.length === 0) {
    throw new Error("A quality review request requires artifact evidence");
  }
  const unsigned = {
    schemaVersion: 1 as const,
    kind: "clash.benchmark.quality-review-request" as const,
    benchmarkId: input.benchmark.id,
    objective: input.benchmark.outcome.objective,
    criteriaSource: "quality-criteria" as const,
    criteria,
    artifacts,
    passThreshold: input.benchmark.passScore,
  };
  return QualityReviewRequestSchema.parse({
    ...unsigned,
    requestSha256: requestDigest(unsigned),
  });
}

export function createQualityReviewResult(input: {
  request: QualityReviewRequest;
  reviewer: QualityReviewerProvenance;
  response: QualityJudgeResponse;
  prompt: string;
  rawResponse: string;
}): QualityReviewResult {
  const request = QualityReviewRequestSchema.parse(input.request);
  const response = QualityJudgeResponseSchema.parse(input.response);
  const reviewer = QualityReviewerProvenanceSchema.parse(input.reviewer);
  if (!exactCriterionIds(request, response)) {
    throw new Error(
      "Judge response criteria must exactly match the review request criteria in order",
    );
  }
  if (request.requestSha256 !== requestDigest(request)) {
    throw new Error("Quality review request digest does not match its payload");
  }
  return QualityReviewResultSchema.parse({
    schemaVersion: 1,
    kind: "clash.benchmark.quality-review-result",
    benchmarkId: request.benchmarkId,
    requestSha256: request.requestSha256,
    artifacts: request.artifacts,
    reviewer,
    provenance: {
      promptSha256: sha256(input.prompt),
      rubricSha256: sha256(
        canonicalJson({
          criteriaSource: request.criteriaSource,
          criteria: request.criteria,
          passThreshold: request.passThreshold,
        }),
      ),
      rawResponseSha256: sha256(input.rawResponse),
    },
    criteria: response.criteria,
    aggregate: expectedAggregate({ request, response }),
    overallRationale: response.overallRationale,
  });
}

export function evaluateQualityReview(input: {
  request: QualityReviewRequest;
  result?: QualityReviewResult;
}): QualityReviewReport {
  const requestParsed = QualityReviewRequestSchema.safeParse(input.request);
  if (!requestParsed.success) {
    return {
      required: true,
      status: "fail",
      detail: "Quality review request is invalid.",
    };
  }
  const request = requestParsed.data;
  if (request.requestSha256 !== requestDigest(request)) {
    return {
      required: true,
      status: "fail",
      detail: "Quality review request digest does not match its payload.",
      request,
    };
  }
  if (!input.result) {
    return {
      required: true,
      status: "pending",
      detail:
        "Technical evidence passed; independent content-effect review is still required.",
      request,
    };
  }
  const resultParsed = QualityReviewResultSchema.safeParse(input.result);
  if (!resultParsed.success) {
    return {
      required: true,
      status: "fail",
      detail: "Quality review result is invalid.",
      request,
    };
  }
  const result = resultParsed.data;
  if (
    result.benchmarkId !== request.benchmarkId ||
    result.requestSha256 !== request.requestSha256
  ) {
    return {
      required: true,
      status: "fail",
      detail:
        "Quality review result is bound to a different benchmark request.",
      request,
      result,
    };
  }
  if (canonicalJson(result.artifacts) !== canonicalJson(request.artifacts)) {
    return {
      required: true,
      status: "fail",
      detail:
        "Quality review artifact binding is stale or does not match the evaluated SHA-256 evidence.",
      request,
      result,
    };
  }
  const response: QualityJudgeResponse = {
    schemaVersion: 1,
    criteria: result.criteria,
    overallRationale: result.overallRationale,
  };
  if (!exactCriterionIds(request, response)) {
    return {
      required: true,
      status: "fail",
      detail: "Quality review criteria do not exactly match the request.",
      request,
      result,
    };
  }
  const aggregate = expectedAggregate({ request, response });
  if (canonicalJson(result.aggregate) !== canonicalJson(aggregate)) {
    return {
      required: true,
      status: "fail",
      detail: "Quality review aggregate does not match the criterion scores.",
      request,
      result,
    };
  }
  return {
    required: true,
    status: aggregate.status,
    detail:
      aggregate.status === "pass"
        ? `Independent content-effect review passed at ${aggregate.score}/${aggregate.threshold}.`
        : `Independent content-effect review failed at ${aggregate.score}/${aggregate.threshold}.`,
    request,
    result,
  };
}
