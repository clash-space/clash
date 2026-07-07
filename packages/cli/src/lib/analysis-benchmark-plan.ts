import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AnalysisBackendBenchmarkMetadataSchema,
  AssetMetadataFillActionSchema,
  buildAnalysisBackendBenchmarkVerdict,
  type AnalysisBackendBenchmarkCandidate,
  type AnalysisBackendBenchmarkMetric,
  type AssetMetadataFillAction,
} from "@clash/shared-types";

export type AnalysisBenchmarkReport = {
  schemaVersion: 1;
  kind: "clash.analysis.backend-benchmark";
  benchmarkId: string;
  targetAssetId: string;
  targetCapability: string;
  fixtureSetPath: string;
  candidates: AnalysisBackendBenchmarkCandidate[];
  selectedBackendId?: string;
  verdict: "pass" | "requires-review" | "fail";
  blockedReasons: string[];
  decisionLog: string[];
};

export type PlanAnalysisBenchmarkOptions = {
  cwd: string;
  targetAssetId: string;
  requestPath: string;
  outPath?: string;
  reportPath?: string;
  producer?: string;
};

export type PlanAnalysisBenchmarkResult = {
  planned: true;
  targetAssetId: string;
  benchmarkId: string;
  actionPath: string;
  reportPath: string;
  verdict: "pass" | "requires-review" | "fail";
  selectedBackendId?: string;
  candidates: number;
};

type AnalysisBenchmarkRequestCandidate = {
  backendId: string;
  capability: string;
  resultPath: string;
  metrics: Array<{
    id: string;
    label?: string;
    score: number;
    threshold: number;
    weight?: number;
    higherIsBetter?: boolean;
  }>;
};

type AnalysisBenchmarkRequest = {
  benchmarkId: string;
  targetCapability: string;
  fixtureSetPath: string;
  candidates: AnalysisBenchmarkRequestCandidate[];
};

export async function planAnalysisBenchmarkAction(
  options: PlanAnalysisBenchmarkOptions,
): Promise<PlanAnalysisBenchmarkResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const requestPath = resolveProjectPath(cwd, options.requestPath, "analysis benchmark request");
  const request = parseRequest(JSON.parse(await readFile(requestPath, "utf8")));
  const candidates = await Promise.all(
    request.candidates.map((candidate) => buildCandidate(cwd, candidate, request.targetCapability)),
  );
  const verdict = buildAnalysisBackendBenchmarkVerdict(candidates);
  const decisionLog = [
    `loaded ${candidates.length} candidate backend results for ${request.targetCapability}`,
    ...(verdict.selectedBackendId
      ? [
          `selected ${verdict.selectedBackendId} with weighted score ${
            candidates.find((candidate) => candidate.backendId === verdict.selectedBackendId)?.weightedScore.toFixed(3)
          }`,
        ]
      : ["no backend passed required thresholds"]),
    "did not execute analysis backends",
  ];
  const metadata = AnalysisBackendBenchmarkMetadataSchema.parse({
    kind: "analysis.backend-benchmark",
    benchmarkId: request.benchmarkId,
    targetCapability: request.targetCapability,
    fixtureSetPath: normalizeProjectRelativePath(request.fixtureSetPath, "fixture set path"),
    candidates,
    ...(verdict.selectedBackendId ? { selectedBackendId: verdict.selectedBackendId } : {}),
    verdict: verdict.verdict,
    blockedReasons: verdict.blockedReasons,
    decisionLog,
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `analysis-benchmark-${safeSlug(request.benchmarkId)}`,
    targetAssetId,
    metadataKind: "analysis.backend-benchmark",
    producer: options.producer ?? "clash-production-plan-analysis-benchmark",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const report: AnalysisBenchmarkReport = {
    schemaVersion: 1,
    kind: "clash.analysis.backend-benchmark",
    benchmarkId: metadata.benchmarkId,
    targetAssetId,
    targetCapability: metadata.targetCapability,
    fixtureSetPath: metadata.fixtureSetPath,
    candidates: metadata.candidates,
    ...(metadata.selectedBackendId ? { selectedBackendId: metadata.selectedBackendId } : {}),
    verdict: metadata.verdict,
    blockedReasons: metadata.blockedReasons,
    decisionLog: metadata.decisionLog,
  };
  const actionPath = resolveProjectPath(
    cwd,
    options.outPath ?? join("actions", `${safeSlug(request.benchmarkId)}.analysis-benchmark.json`),
    "analysis benchmark action",
  );
  const reportPath = resolveProjectPath(
    cwd,
    options.reportPath ?? join("qa", "analysis", `${safeSlug(request.benchmarkId)}.backend-benchmark.json`),
    "analysis benchmark report",
  );
  await writeJson(actionPath, action);
  await writeJson(reportPath, report);
  return {
    planned: true,
    targetAssetId,
    benchmarkId: metadata.benchmarkId,
    actionPath,
    reportPath,
    verdict: metadata.verdict,
    ...(metadata.selectedBackendId ? { selectedBackendId: metadata.selectedBackendId } : {}),
    candidates: metadata.candidates.length,
  };
}

function parseRequest(input: unknown): AnalysisBenchmarkRequest {
  if (!input || typeof input !== "object") {
    throw new Error("analysis benchmark request must be an object");
  }
  const record = input as Record<string, unknown>;
  const candidates = record.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new Error("analysis benchmark request must include candidates");
  }
  return {
    benchmarkId: requireNonEmpty(record.benchmarkId, "benchmarkId"),
    targetCapability: requireNonEmpty(record.targetCapability, "targetCapability"),
    fixtureSetPath: requireNonEmpty(record.fixtureSetPath, "fixtureSetPath"),
    candidates: candidates.map(parseCandidateRequest),
  };
}

function parseCandidateRequest(input: unknown, index: number): AnalysisBenchmarkRequestCandidate {
  if (!input || typeof input !== "object") {
    throw new Error(`candidate ${index + 1} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const metrics = record.metrics;
  if (!Array.isArray(metrics) || metrics.length === 0) {
    throw new Error(`candidate ${index + 1} must include metrics`);
  }
  return {
    backendId: requireNonEmpty(record.backendId, `candidate ${index + 1} backendId`),
    capability: requireNonEmpty(record.capability, `candidate ${index + 1} capability`),
    resultPath: normalizeProjectRelativePath(
      requireNonEmpty(record.resultPath, `candidate ${index + 1} resultPath`),
      `candidate ${index + 1} resultPath`,
    ),
    metrics: metrics.map((metric, metricIndex) => parseMetricRequest(metric, index, metricIndex)),
  };
}

function parseMetricRequest(
  input: unknown,
  candidateIndex: number,
  metricIndex: number,
): AnalysisBenchmarkRequestCandidate["metrics"][number] {
  if (!input || typeof input !== "object") {
    throw new Error(`candidate ${candidateIndex + 1} metric ${metricIndex + 1} must be an object`);
  }
  const record = input as Record<string, unknown>;
  return {
    id: requireNonEmpty(record.id, `candidate ${candidateIndex + 1} metric ${metricIndex + 1} id`),
    ...(typeof record.label === "string" && record.label.trim() ? { label: record.label.trim() } : {}),
    score: parseScore(record.score, `candidate ${candidateIndex + 1} metric ${metricIndex + 1} score`),
    threshold: parseScore(record.threshold, `candidate ${candidateIndex + 1} metric ${metricIndex + 1} threshold`),
    ...(record.weight === undefined ? {} : {
      weight: parsePositiveNumber(record.weight, `candidate ${candidateIndex + 1} metric ${metricIndex + 1} weight`),
    }),
    ...(record.higherIsBetter === undefined ? {} : { higherIsBetter: record.higherIsBetter === true }),
  };
}

async function buildCandidate(
  cwd: string,
  candidate: AnalysisBenchmarkRequestCandidate,
  targetCapability: string,
): Promise<AnalysisBackendBenchmarkCandidate> {
  if (candidate.capability !== targetCapability) {
    throw new Error(`candidate ${candidate.backendId} capability ${candidate.capability} does not match ${targetCapability}`);
  }
  resolveProjectPath(cwd, candidate.resultPath, `candidate ${candidate.backendId} result`);
  await readFile(resolve(cwd, candidate.resultPath), "utf8");
  const metrics = candidate.metrics.map(buildMetric);
  const weightedScore = weightedAverage(metrics);
  return {
    backendId: candidate.backendId,
    capability: candidate.capability,
    resultPath: candidate.resultPath,
    metrics,
    weightedScore,
    status: metrics.every((metric) => metric.status === "pass") ? "pass" : "fail",
  };
}

function buildMetric(metric: AnalysisBenchmarkRequestCandidate["metrics"][number]): AnalysisBackendBenchmarkMetric {
  const higherIsBetter = metric.higherIsBetter ?? true;
  return {
    id: metric.id,
    ...(metric.label ? { label: metric.label } : {}),
    score: metric.score,
    threshold: metric.threshold,
    weight: metric.weight ?? 1,
    higherIsBetter,
    status: higherIsBetter
      ? (metric.score >= metric.threshold ? "pass" : "fail")
      : (metric.score <= metric.threshold ? "pass" : "fail"),
  };
}

function weightedAverage(metrics: AnalysisBackendBenchmarkMetric[]): number {
  const totalWeight = metrics.reduce((sum, metric) => sum + metric.weight, 0);
  const weighted = metrics.reduce((sum, metric) => sum + metric.score * metric.weight, 0);
  return Math.round((weighted / totalWeight) * 1000) / 1000;
}

function parseScore(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return input;
}

function parsePositiveNumber(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return input;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function resolveProjectPath(cwd: string, rawPath: string, label: string): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error(`${label} path is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawPath)) {
    throw new Error(`${label} path must be a local project path, not a URL`);
  }
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  if (!isInsideOrEqual(cwd, resolved)) {
    throw new Error(`${label} path must stay inside the current project cwd`);
  }
  return resolved;
}

function normalizeProjectRelativePath(path: string, label: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} must be a local project-relative path, not a URL`);
  }
  if (isAbsolute(path)) {
    throw new Error(`${label} must be project-relative, not absolute`);
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.includes("..")) {
    throw new Error(`${label} must stay inside the project`);
  }
  return parts.join("/");
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "analysis-benchmark";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
