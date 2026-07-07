import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

type PipelineArtifactKind = "action" | "metadata" | "asset" | "projection" | "review-gate" | "export";
type CoverageKey = "action" | "metadata" | "asset" | "projection" | "reviewGate" | "export";

type PipelineArtifact = {
  kind: PipelineArtifactKind;
  stage: string;
  path: string;
  casRequired?: boolean;
};

type PipelineManifest = {
  schemaVersion: 1;
  projectKind: string;
  stages: string[];
  artifacts: PipelineArtifact[];
};

export type PipelineValidationStatus = "pass" | "blocked";

export type PipelineValidationReport = {
  schemaVersion: 1;
  kind: "clash.production.pipeline-validation";
  status: PipelineValidationStatus;
  projectKind: string;
  pipelinePath: string;
  coverage: Record<CoverageKey, boolean>;
  missingArtifacts: string[];
  blockedReasons: string[];
  casRequiredProjectionPaths: string[];
  artifacts: {
    total: number;
    present: number;
    missing: number;
    byKind: Record<CoverageKey, { total: number; present: number }>;
  };
  validatedAt: string;
};

export type ValidatePipelineManifestOptions = {
  cwd: string;
  pipelinePath: string;
  outPath?: string;
};

export type ValidatePipelineManifestResult = {
  validated: true;
  status: PipelineValidationStatus;
  projectKind: string;
  pipelinePath: string;
  reportPath: string;
  coverage: Record<CoverageKey, boolean>;
  missingArtifacts: string[];
  blockedReasons: string[];
};

const ARTIFACT_KINDS: PipelineArtifactKind[] = [
  "action",
  "metadata",
  "asset",
  "projection",
  "review-gate",
  "export",
];

const COVERAGE_KEYS: CoverageKey[] = ["action", "metadata", "asset", "projection", "reviewGate", "export"];

export async function validatePipelineManifest(
  options: ValidatePipelineManifestOptions,
): Promise<ValidatePipelineManifestResult> {
  const cwd = resolve(options.cwd);
  const pipelinePath = resolveProjectPath(cwd, options.pipelinePath, "pipeline manifest");
  const manifest = parsePipelineManifest(JSON.parse(await readFile(pipelinePath, "utf8")));
  const pipelineProjectPath = toProjectPath(cwd, pipelinePath);
  const artifacts = manifest.artifacts.map((artifact) => ({
    ...artifact,
    projectPath: normalizeProjectRelativePath(artifact.path, "artifact path"),
    absolutePath: resolveProjectPath(cwd, artifact.path, "artifact path"),
  }));
  const missingArtifacts = artifacts
    .filter((artifact) => !existsSync(artifact.absolutePath))
    .map((artifact) => artifact.projectPath);
  const coverage = buildCoverage(artifacts);
  const blockedReasons = [
    ...missingArtifacts.map((artifactPath) => `required artifact missing: ${artifactPath}`),
    ...requiredCoverageKeys(manifest.stages)
      .filter((key) => !coverage[key])
      .map((key) => `required artifact kind missing or absent: ${coverageLabel(key)}`),
    ...artifacts
      .filter((artifact) => artifact.kind === "projection" && artifact.casRequired !== true)
      .map((artifact) => `projection artifact must declare casRequired: true: ${artifact.projectPath}`),
  ];
  const status: PipelineValidationStatus = blockedReasons.length > 0 ? "blocked" : "pass";
  const reportPath = resolveProjectPath(
    cwd,
    options.outPath ?? join("qa", "pipeline", `${safeFileStem(manifest.projectKind)}.pipeline-validation.json`),
    "pipeline validation report",
  );
  const report: PipelineValidationReport = {
    schemaVersion: 1,
    kind: "clash.production.pipeline-validation",
    status,
    projectKind: manifest.projectKind,
    pipelinePath: pipelineProjectPath,
    coverage,
    missingArtifacts,
    blockedReasons,
    casRequiredProjectionPaths: artifacts
      .filter((artifact) => artifact.kind === "projection" && artifact.casRequired === true)
      .map((artifact) => artifact.projectPath),
    artifacts: {
      total: artifacts.length,
      present: artifacts.length - missingArtifacts.length,
      missing: missingArtifacts.length,
      byKind: buildArtifactCounts(artifacts),
    },
    validatedAt: new Date().toISOString(),
  };
  await writeJson(reportPath, report);
  return {
    validated: true,
    status,
    projectKind: manifest.projectKind,
    pipelinePath,
    reportPath,
    coverage,
    missingArtifacts,
    blockedReasons,
  };
}

function parsePipelineManifest(input: unknown): PipelineManifest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("pipeline manifest must be an object");
  }
  const record = input as Record<string, unknown>;
  return {
    schemaVersion: 1,
    projectKind: requireNonEmpty(record.projectKind, "projectKind"),
    stages: parseStringArray(record.stages, "stages"),
    artifacts: parseArtifacts(record.artifacts),
  };
}

function parseArtifacts(input: unknown): PipelineArtifact[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error("pipeline manifest must list artifacts");
  }
  return input.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`artifacts[${index}] must be an object`);
    }
    const record = item as Record<string, unknown>;
    const kind = parseArtifactKind(record.kind, `artifacts[${index}].kind`);
    return {
      kind,
      stage: requireNonEmpty(record.stage, `artifacts[${index}].stage`),
      path: requireNonEmpty(record.path, `artifacts[${index}].path`),
      ...(typeof record.casRequired === "boolean" ? { casRequired: record.casRequired } : {}),
    };
  });
}

function parseArtifactKind(input: unknown, label: string): PipelineArtifactKind {
  const value = requireNonEmpty(input, label);
  if (!ARTIFACT_KINDS.includes(value as PipelineArtifactKind)) {
    throw new Error(`${label} must be one of ${ARTIFACT_KINDS.join(", ")}`);
  }
  return value as PipelineArtifactKind;
}

function buildCoverage(
  artifacts: Array<PipelineArtifact & { absolutePath: string }>,
): Record<CoverageKey, boolean> {
  return Object.fromEntries(COVERAGE_KEYS.map((key) => [
    key,
    artifacts.some((artifact) => coverageKeyForKind(artifact.kind) === key && existsSync(artifact.absolutePath)),
  ])) as Record<CoverageKey, boolean>;
}

function buildArtifactCounts(
  artifacts: Array<PipelineArtifact & { absolutePath: string }>,
): Record<CoverageKey, { total: number; present: number }> {
  const counts = Object.fromEntries(COVERAGE_KEYS.map((key) => [key, { total: 0, present: 0 }])) as Record<CoverageKey, {
    total: number;
    present: number;
  }>;
  for (const artifact of artifacts) {
    const key = coverageKeyForKind(artifact.kind);
    counts[key].total += 1;
    if (existsSync(artifact.absolutePath)) counts[key].present += 1;
  }
  return counts;
}

function requiredCoverageKeys(stages: string[]): CoverageKey[] {
  const required: CoverageKey[] = ["action", "metadata", "asset", "projection"];
  if (stages.includes("review")) required.push("reviewGate");
  if (stages.includes("export")) required.push("export");
  return required;
}

function coverageKeyForKind(kind: PipelineArtifactKind): CoverageKey {
  return kind === "review-gate" ? "reviewGate" : kind;
}

function coverageLabel(key: CoverageKey): string {
  return key === "reviewGate" ? "review-gate" : key;
}

function parseStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`${label} must be a non-empty string array`);
  }
  return input.map((item, index) => requireNonEmpty(item, `${label}[${index}]`));
}

function requireNonEmpty(input: unknown, label: string): string {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return input.trim();
}

function resolveProjectPath(cwd: string, path: string, label: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} must be a local file path, not a URL`);
  }
  const absolutePath = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const relativePath = relative(cwd, absolutePath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error(`${label} must stay inside the project`);
  }
  return absolutePath;
}

function normalizeProjectRelativePath(path: string, label: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} must be a local project-relative path, not a URL`);
  }
  if (isAbsolute(path)) {
    throw new Error(`${label} must be project-relative, not absolute`);
  }
  const parts = path.split(/[\\/]+/).filter(Boolean);
  if (parts.length === 0 || parts.includes("..")) {
    throw new Error(`${label} must stay inside the project`);
  }
  return parts.join("/");
}

function toProjectPath(cwd: string, path: string): string {
  return normalizeProjectRelativePath(relative(cwd, path), "project path");
}

function safeFileStem(value: string): string {
  const stem = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "pipeline";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
