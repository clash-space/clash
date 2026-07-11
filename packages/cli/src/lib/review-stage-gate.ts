import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ReviewGateStatus = "blocked" | "pending-review" | "approved" | "changes-requested";
export type ReviewGateDecision = "approve" | "request-changes";

export type ReviewGateArtifact = {
  path: string;
  exists: boolean;
};

export type ReviewGateApproval = {
  reviewer: string;
  decision: ReviewGateDecision;
  note?: string;
  decidedAt: string;
};

export type ReviewStageGate = {
  schemaVersion: 1;
  kind: "clash.review.stage-gate";
  projectKind: string;
  stage: string;
  pipelinePath: string;
  status: ReviewGateStatus;
  requiredArtifacts: ReviewGateArtifact[];
  blockedReasons: string[];
  approvals: ReviewGateApproval[];
  gatePolicy: {
    requiresExplicitApproval: true;
    applyBlockedUntilApproved: true;
    finalExportBlockedUntilApproved: boolean;
  };
  decisionLog: string[];
  createdAt: string;
  updatedAt: string;
};

export type PlanReviewStageGateOptions = {
  cwd: string;
  pipelinePath: string;
  stage: string;
  requiredArtifactPaths?: string[];
  outPath?: string;
};

export type PlanReviewStageGateResult = {
  planned: true;
  status: ReviewGateStatus;
  projectKind: string;
  stage: string;
  gatePath: string;
  version: string;
  blockedReasons: string[];
};

export type ApproveReviewStageGateOptions = {
  cwd: string;
  gatePath: string;
  expectedVersion: string;
  reviewer: string;
  decision: ReviewGateDecision;
  note?: string;
};

export type ApproveReviewStageGateResult = {
  approved: boolean;
  status: ReviewGateStatus;
  stage: string;
  gatePath: string;
  version: string;
  reviewer: string;
  decision: ReviewGateDecision;
};

export async function planReviewStageGate(
  options: PlanReviewStageGateOptions,
): Promise<PlanReviewStageGateResult> {
  const cwd = resolve(options.cwd);
  const pipelinePath = resolveProjectPath(cwd, options.pipelinePath, "pipeline manifest");
  const pipeline = parsePipelineManifest(JSON.parse(await readFile(pipelinePath, "utf8")));
  const stage = requireNonEmpty(options.stage, "stage");
  if (!pipeline.stages.includes(stage)) {
    throw new Error(`stage ${stage} is not listed in ${toProjectPath(cwd, pipelinePath)}`);
  }
  const requiredArtifacts = normalizeRequiredArtifacts(cwd, options.requiredArtifactPaths ?? []);
  const blockedReasons = requiredArtifacts
    .filter((artifact) => !artifact.exists)
    .map((artifact) => `required artifact missing: ${artifact.path}`);
  const now = new Date().toISOString();
  const gatePath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("reviews", "gates", `${safeSlug(stage)}.review-gate.json`),
      "review gate",
    ),
    writeVerb: "Review gate",
  });
  const gate: ReviewStageGate = {
    schemaVersion: 1,
    kind: "clash.review.stage-gate",
    projectKind: pipeline.projectKind,
    stage,
    pipelinePath: toProjectPath(cwd, pipelinePath),
    status: blockedReasons.length > 0 ? "blocked" : "pending-review",
    requiredArtifacts,
    blockedReasons,
    approvals: [],
    gatePolicy: {
      requiresExplicitApproval: true,
      applyBlockedUntilApproved: true,
      finalExportBlockedUntilApproved: stage === "export",
    },
    decisionLog: [
      `planned review gate for ${stage}`,
      blockedReasons.length > 0
        ? "blocked until required artifacts exist"
        : "all required artifacts exist; explicit approval required",
    ],
    createdAt: now,
    updatedAt: now,
  };
  const version = await writeGate(gatePath, gate);
  return {
    planned: true,
    status: gate.status,
    projectKind: gate.projectKind,
    stage,
    gatePath,
    version,
    blockedReasons,
  };
}

export async function approveReviewStageGate(
  options: ApproveReviewStageGateOptions,
): Promise<ApproveReviewStageGateResult> {
  const cwd = resolve(options.cwd);
  const gatePath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(cwd, options.gatePath, "review gate"),
    writeVerb: "Review gate",
  });
  const gateText = await readFile(gatePath, "utf8");
  const currentVersion = reviewGateVersion(gateText);
  if (!options.expectedVersion) {
    throw new Error("READ_REQUIRED: Plan or read the review gate before approving it.");
  }
  if (options.expectedVersion !== currentVersion) {
    throw new Error("STALE_READ: The review gate changed after it was read. Plan or read it again before approving.");
  }
  const gate = parseReviewStageGate(JSON.parse(gateText));
  const reviewer = requireNonEmpty(options.reviewer, "reviewer");
  if (gate.status === "blocked") {
    throw new Error("cannot approve a blocked review gate");
  }
  if (options.decision === "approve" && gate.blockedReasons.length > 0) {
    throw new Error("cannot approve a review gate with blocked reasons");
  }
  const now = new Date().toISOString();
  const approval: ReviewGateApproval = {
    reviewer,
    decision: options.decision,
    ...(options.note ? { note: options.note } : {}),
    decidedAt: now,
  };
  const updatedGate: ReviewStageGate = {
    ...gate,
    status: options.decision === "approve" ? "approved" : "changes-requested",
    approvals: [...gate.approvals, approval],
    decisionLog: [
      ...gate.decisionLog,
      `${reviewer} ${options.decision === "approve" ? "approved" : "requested changes"}`,
    ],
    updatedAt: now,
  };
  const version = await writeGate(gatePath, updatedGate);
  return {
    approved: options.decision === "approve",
    status: updatedGate.status,
    stage: updatedGate.stage,
    gatePath,
    version,
    reviewer,
    decision: options.decision,
  };
}

function parsePipelineManifest(input: unknown): { projectKind: string; stages: string[] } {
  if (!input || typeof input !== "object") {
    throw new Error("pipeline manifest must be an object");
  }
  const record = input as Record<string, unknown>;
  return {
    projectKind: requireNonEmpty(record.projectKind, "projectKind"),
    stages: parseStringArray(record.stages, "stages"),
  };
}

function parseReviewStageGate(input: unknown): ReviewStageGate {
  if (!input || typeof input !== "object") {
    throw new Error("review gate must be an object");
  }
  const record = input as Record<string, unknown>;
  const status = parseReviewGateStatus(record.status);
  return {
    schemaVersion: 1,
    kind: "clash.review.stage-gate",
    projectKind: requireNonEmpty(record.projectKind, "projectKind"),
    stage: requireNonEmpty(record.stage, "stage"),
    pipelinePath: requireNonEmpty(record.pipelinePath, "pipelinePath"),
    status,
    requiredArtifacts: parseReviewGateArtifacts(record.requiredArtifacts),
    blockedReasons: parseStringArray(record.blockedReasons, "blockedReasons"),
    approvals: parseReviewGateApprovals(record.approvals),
    gatePolicy: parseGatePolicy(record.gatePolicy),
    decisionLog: parseStringArray(record.decisionLog, "decisionLog"),
    createdAt: requireNonEmpty(record.createdAt, "createdAt"),
    updatedAt: requireNonEmpty(record.updatedAt, "updatedAt"),
  };
}

function parseReviewGateStatus(input: unknown): ReviewGateStatus {
  if (
    input === "blocked" ||
    input === "pending-review" ||
    input === "approved" ||
    input === "changes-requested"
  ) {
    return input;
  }
  throw new Error("review gate status must be blocked, pending-review, approved, or changes-requested");
}

function parseGatePolicy(input: unknown): ReviewStageGate["gatePolicy"] {
  if (!input || typeof input !== "object") {
    throw new Error("gatePolicy must be an object");
  }
  const record = input as Record<string, unknown>;
  if (record.requiresExplicitApproval !== true || record.applyBlockedUntilApproved !== true) {
    throw new Error("review gate requires explicit approval and apply blocking policy");
  }
  return {
    requiresExplicitApproval: true,
    applyBlockedUntilApproved: true,
    finalExportBlockedUntilApproved: record.finalExportBlockedUntilApproved === true,
  };
}

function parseReviewGateArtifacts(input: unknown): ReviewGateArtifact[] {
  if (!Array.isArray(input)) {
    throw new Error("requiredArtifacts must be an array");
  }
  return input.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("required artifact must be an object");
    }
    const record = item as Record<string, unknown>;
    return {
      path: requireNonEmpty(record.path, "artifact path"),
      exists: record.exists === true,
    };
  });
}

function parseReviewGateApprovals(input: unknown): ReviewGateApproval[] {
  if (!Array.isArray(input)) {
    throw new Error("approvals must be an array");
  }
  return input.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("approval must be an object");
    }
    const record = item as Record<string, unknown>;
    return {
      reviewer: requireNonEmpty(record.reviewer, "reviewer"),
      decision: parseReviewGateDecision(record.decision),
      ...(typeof record.note === "string" && record.note.trim() ? { note: record.note.trim() } : {}),
      decidedAt: requireNonEmpty(record.decidedAt, "decidedAt"),
    };
  });
}

export function parseReviewGateDecision(input: unknown): ReviewGateDecision {
  if (input === "approve" || input === "request-changes") return input;
  throw new Error("review gate decision must be approve or request-changes");
}

function normalizeRequiredArtifacts(cwd: string, paths: string[]): ReviewGateArtifact[] {
  return paths.map((rawPath) => {
    const absolutePath = resolveProjectPath(cwd, rawPath, "required artifact");
    return {
      path: toProjectPath(cwd, absolutePath),
      exists: existsSync(absolutePath),
    };
  });
}

function parseStringArray(input: unknown, label: string): string[] {
  if (!Array.isArray(input)) {
    throw new Error(`${label} must be an array`);
  }
  const values = input.map((item) => requireNonEmpty(item, label));
  return Array.from(new Set(values));
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

async function writeGate(
  gatePath: string,
  gate: ReviewStageGate,
): Promise<string> {
  const gateText = `${JSON.stringify(gate, null, 2)}\n`;
  await mkdir(dirname(gatePath), { recursive: true });
  await writeFile(gatePath, gateText, "utf8");
  return reviewGateVersion(gateText);
}

export function reviewGateObservationId(options: { cwd: string; gatePath: string }): string {
  const cwd = resolve(options.cwd);
  const gatePath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(cwd, options.gatePath, "review gate"),
    writeVerb: "Review gate",
  });
  return toProjectPath(cwd, gatePath);
}

function reviewGateVersion(gateText: string): string {
  return `review-gate-v1:${sha256(gateText).slice(0, 16)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
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

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "review-gate";
}
