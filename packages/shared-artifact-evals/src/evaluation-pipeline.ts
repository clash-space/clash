import { createHash } from "node:crypto";

import {
  createAggregateRecord,
  createEvaluationRecord,
  createRewardRecord,
} from "./evaluation-records";
import type {
  BenchmarkEvaluationAggregateRecord,
  BenchmarkEvaluationDimension,
  BenchmarkEvaluationEvidenceReference,
  BenchmarkEvaluationRecord,
  BenchmarkRewardRecord,
} from "./evaluation-records";
import type { ArtifactBenchmarkCase, BenchmarkCaseReport } from "./types";

export type BenchmarkEvaluationPipelineInput = Readonly<{
  attemptDigest: string;
  benchmark: ArtifactBenchmarkCase;
  report: BenchmarkCaseReport;
  evidence: Readonly<{
    technical: readonly BenchmarkEvaluationEvidenceReference[];
    quality?: readonly BenchmarkEvaluationEvidenceReference[];
  }>;
  includeReward?: boolean;
}>;

export type BenchmarkEvaluationPipeline = Readonly<{
  technicalEvaluation: BenchmarkEvaluationRecord;
  qualityEvaluation?: BenchmarkEvaluationRecord;
  evaluations: readonly BenchmarkEvaluationRecord[];
  aggregate: BenchmarkEvaluationAggregateRecord;
  reward?: BenchmarkRewardRecord;
}>;

const TECHNICAL_EVALUATOR_SUBJECT = {
  schemaVersion: 1,
  kind: "clash.benchmark.evaluator-subject",
  id: "clash.benchmark.technical-evaluator",
  version: "1",
  contract: {
    agent: "completed rollout gate",
    artifact: "artifact evaluator score and verdict",
    product: "required product execution gate",
  },
} as const;

const AGGREGATE_POLICY_SUBJECT = {
  schemaVersion: 1,
  kind: "clash.benchmark.aggregate-policy-subject",
  id: "clash.benchmark.required-gates-aggregate",
  version: "1",
  score: "artifact.correctness",
  verdict: {
    fail: "any selected required dimension fails",
    pending: "no failure and any selected required dimension is pending",
    pass: "all selected required dimensions pass",
  },
  quality: "selected when the case report declares it required",
} as const;

const REWARD_POLICY_SUBJECT = {
  schemaVersion: 1,
  kind: "clash.benchmark.reward-policy-subject",
  id: "clash.benchmark.normalized-aggregate-reward",
  version: "1",
  value: "aggregate.score / 100",
} as const;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

function publicSubjectDigest(subject: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(subject)))
    .digest("hex");
}

function technicalVerdict(
  status: BenchmarkCaseReport["evaluation"]["status"],
): BenchmarkEvaluationDimension["verdict"] {
  return status === "pass" ? "pass" : status === "fail" ? "fail" : "pending";
}

function agentVerdict(
  status: BenchmarkCaseReport["agent"]["status"],
): BenchmarkEvaluationDimension["verdict"] {
  return status === "completed"
    ? "pass"
    : status === "not-run"
      ? "pending"
      : "fail";
}

function executionVerdict(
  status: BenchmarkCaseReport["execution"]["status"],
): BenchmarkEvaluationDimension["verdict"] {
  return status === "pass" ? "pass" : status === "blocked" ? "pending" : "fail";
}

function qualityVerdict(
  status: NonNullable<BenchmarkCaseReport["qualityReview"]>["status"],
): BenchmarkEvaluationDimension["verdict"] {
  return status === "pass" ? "pass" : status === "fail" ? "fail" : "pending";
}

function aggregateVerdict(
  dimensions: readonly BenchmarkEvaluationDimension[],
  report: BenchmarkCaseReport,
): BenchmarkEvaluationAggregateRecord["verdict"] {
  const selectedVerdicts = dimensions.map(({ verdict }) => verdict);
  if (report.qualityReview?.required) {
    selectedVerdicts.push(qualityVerdict(report.qualityReview.status));
  }
  if (selectedVerdicts.includes("fail")) return "fail";
  if (selectedVerdicts.includes("pending")) return "pending";
  return "pass";
}

function assertMatchingCase(
  benchmark: ArtifactBenchmarkCase,
  report: BenchmarkCaseReport,
): void {
  if (
    benchmark.id !== report.id ||
    benchmark.id !== report.evaluation.benchmarkId ||
    benchmark.id !== report.outcome.caseId
  ) {
    throw new Error("Evaluation inputs must describe the same benchmark case");
  }
}

function createTechnicalEvaluation(input: {
  attemptDigest: string;
  benchmark: ArtifactBenchmarkCase;
  report: BenchmarkCaseReport;
  evidence: readonly BenchmarkEvaluationEvidenceReference[];
}): BenchmarkEvaluationRecord {
  const dimensions: BenchmarkEvaluationDimension[] = [
    {
      id: "agent.completion",
      score: input.report.agent.status === "completed" ? 100 : 0,
      verdict: agentVerdict(input.report.agent.status),
      rationale:
        input.report.agent.error ??
        `Agent rollout status: ${input.report.agent.status}.`,
    },
    {
      id: "artifact.correctness",
      score: input.report.evaluation.score,
      verdict: technicalVerdict(input.report.evaluation.status),
      rationale:
        input.report.evaluation.error ??
        input.report.evaluation.outcomeGate.detail,
    },
    {
      id: "product.execution",
      score: input.report.execution.status === "pass" ? 100 : 0,
      verdict: executionVerdict(input.report.execution.status),
      rationale: input.report.execution.detail,
    },
  ];
  const technicalSpecSubject = {
    schemaVersion: 1,
    kind: "clash.benchmark.evaluation-spec-subject",
    id: "clash.benchmark.technical-spec",
    version: "1",
    benchmark: input.benchmark,
  } as const;
  return createEvaluationRecord({
    attemptDigest: input.attemptDigest,
    evaluator: {
      id: TECHNICAL_EVALUATOR_SUBJECT.id,
      version: TECHNICAL_EVALUATOR_SUBJECT.version,
      digest: publicSubjectDigest(TECHNICAL_EVALUATOR_SUBJECT),
    },
    spec: {
      id: technicalSpecSubject.id,
      version: technicalSpecSubject.version,
      digest: publicSubjectDigest(technicalSpecSubject),
    },
    dimensions,
    evidence: input.evidence,
  });
}

function createQualityEvaluation(input: {
  attemptDigest: string;
  report: BenchmarkCaseReport;
  evidence?: readonly BenchmarkEvaluationEvidenceReference[];
}): BenchmarkEvaluationRecord | undefined {
  const qualityReview = input.report.qualityReview;
  if (!qualityReview?.result) return undefined;
  if (!qualityReview.request) {
    throw new Error(
      "A quality Evaluation result requires its public review request",
    );
  }
  if (!input.evidence?.length) {
    throw new Error(
      "A quality Evaluation result requires exact evidence references",
    );
  }
  const qualityEvaluatorSubject = {
    schemaVersion: 1,
    kind: "clash.benchmark.evaluator-subject",
    id: "clash.benchmark.quality-reviewer",
    version: "1",
    reviewer: qualityReview.result.reviewer,
  } as const;
  const qualitySpecSubject = {
    schemaVersion: 1,
    kind: "clash.benchmark.evaluation-spec-subject",
    id: "clash.benchmark.content-quality-spec",
    version: "1",
    benchmarkId: qualityReview.request.benchmarkId,
    objective: qualityReview.request.objective,
    criteriaSource: qualityReview.request.criteriaSource,
    criteria: qualityReview.request.criteria,
    passThreshold: qualityReview.request.passThreshold,
  } as const;
  return createEvaluationRecord({
    attemptDigest: input.attemptDigest,
    evaluator: {
      id: qualityEvaluatorSubject.id,
      version: qualityEvaluatorSubject.version,
      digest: publicSubjectDigest(qualityEvaluatorSubject),
    },
    spec: {
      id: qualitySpecSubject.id,
      version: qualitySpecSubject.version,
      digest: publicSubjectDigest(qualitySpecSubject),
    },
    dimensions: [
      {
        id: "content.quality",
        score: qualityReview.result.aggregate.score,
        verdict: qualityVerdict(qualityReview.status),
        rationale: qualityReview.result.overallRationale,
      },
    ],
    evidence: input.evidence,
  });
}

export function createBenchmarkEvaluationPipeline(
  input: BenchmarkEvaluationPipelineInput,
): BenchmarkEvaluationPipeline {
  assertMatchingCase(input.benchmark, input.report);
  const technicalEvaluation = createTechnicalEvaluation({
    attemptDigest: input.attemptDigest,
    benchmark: input.benchmark,
    report: input.report,
    evidence: input.evidence.technical,
  });
  const qualityEvaluation = createQualityEvaluation({
    attemptDigest: input.attemptDigest,
    report: input.report,
    ...(input.evidence.quality ? { evidence: input.evidence.quality } : {}),
  });
  const evaluations = qualityEvaluation
    ? [technicalEvaluation, qualityEvaluation]
    : [technicalEvaluation];
  const aggregateEvaluations =
    qualityEvaluation && input.report.qualityReview?.required
      ? evaluations
      : [technicalEvaluation];
  const selectedDimensions = aggregateEvaluations.flatMap(
    ({ dimensions }) => dimensions,
  );
  const technicalScore = technicalEvaluation.dimensions.find(
    ({ id }) => id === "artifact.correctness",
  )!.score;
  const aggregate = createAggregateRecord({
    attemptDigest: input.attemptDigest,
    evaluations: aggregateEvaluations,
    policy: {
      id: AGGREGATE_POLICY_SUBJECT.id,
      version: AGGREGATE_POLICY_SUBJECT.version,
      digest: publicSubjectDigest(AGGREGATE_POLICY_SUBJECT),
    },
    verdict: aggregateVerdict(selectedDimensions, input.report),
    score: technicalScore,
  });
  const reward = input.includeReward
    ? createRewardRecord({
        attemptDigest: input.attemptDigest,
        aggregate,
        policy: {
          id: REWARD_POLICY_SUBJECT.id,
          version: REWARD_POLICY_SUBJECT.version,
          digest: publicSubjectDigest(REWARD_POLICY_SUBJECT),
        },
        components: [
          {
            id: "aggregate-score",
            value: aggregate.score / 100,
          },
        ],
        value: aggregate.score / 100,
      })
    : undefined;
  return Object.freeze({
    technicalEvaluation,
    ...(qualityEvaluation ? { qualityEvaluation } : {}),
    evaluations: Object.freeze(evaluations),
    aggregate,
    ...(reward ? { reward } : {}),
  });
}
