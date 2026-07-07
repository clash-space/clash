import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AdDeliverySpecProjectionSchema,
  AdVisualQaCheckKindSchema,
  AdVisualQaMetadataSchema,
  AssetMetadataFillActionSchema,
  type AdVisualQaCheck,
  type AdVisualQaCheckKind,
  type AdVisualQaMetadata,
  type AssetMetadataFillAction,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type AdVisualQaReport = {
  schemaVersion: 1;
  kind: "clash.ad.visual-qa";
  targetAssetId: string;
  variantId: string;
  renderedPath: string;
  evidencePath: string;
  checks: AdVisualQaCheck[];
  verdict: "pass" | "requires-review" | "fail";
  blockedReasons: string[];
  visualQa: AdVisualQaMetadata["visualQa"];
  decisionLog: string[];
};

export type PlanAdVisualQaOptions = {
  cwd: string;
  targetAssetId: string;
  deliverySpecPath: string;
  variantId: string;
  evidencePath: string;
  outPath?: string;
  reportPath?: string;
  producer?: string;
};

export type PlanAdVisualQaResult = {
  planned: true;
  targetAssetId: string;
  variantId: string;
  verdict: "pass" | "requires-review" | "fail";
  actionPath: string;
  reportPath: string;
  checks: number;
};

type AdVisualQaEvidence = {
  targetAssetId: string;
  variantId: string;
  renderedPath: string;
  checks: AdVisualQaCheck[];
  analysisBackend?: {
    id: string;
  };
};

export async function planAdVisualQaAction(
  options: PlanAdVisualQaOptions,
): Promise<PlanAdVisualQaResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const deliverySpecPath = resolveProjectPath(cwd, options.deliverySpecPath, "delivery spec");
  const deliverySpec = AdDeliverySpecProjectionSchema.parse(
    JSON.parse(await readFile(deliverySpecPath, "utf8")),
  );
  if (deliverySpec.targetAssetId !== targetAssetId) {
    throw new Error(`delivery spec target ${deliverySpec.targetAssetId} does not match ${targetAssetId}`);
  }
  const variant = deliverySpec.variants.find((item) => item.id === options.variantId);
  if (!variant) throw new Error(`delivery spec does not include variant ${options.variantId}`);
  const evidenceProjectPath = normalizeProjectRelativePath(options.evidencePath, "evidence path");
  const evidencePath = resolveProjectPath(cwd, evidenceProjectPath, "ad visual QA evidence");
  const evidence = parseEvidence(JSON.parse(await readFile(evidencePath, "utf8")));
  if (evidence.targetAssetId !== targetAssetId) {
    throw new Error(`ad visual QA target ${evidence.targetAssetId} does not match ${targetAssetId}`);
  }
  if (evidence.variantId !== variant.id) {
    throw new Error(`ad visual QA variant ${evidence.variantId} does not match ${variant.id}`);
  }
  const verdict = buildVerdict(evidence.checks);
  const blockedReasons = evidence.checks
    .filter((check) => check.required && check.status !== "pass")
    .map((check) => `${check.id} ${check.status}: ${check.actual}`);
  const visualQa = buildVisualQaReport(evidence.checks);
  const decisionLog = [
    `loaded ${evidence.checks.length} ad visual QA evidence checks`,
    ...(evidence.analysisBackend ? [`consumed evidence from ${evidence.analysisBackend.id}`] : []),
    "did not execute OCR/logo/pixel analysis backends",
  ];
  const metadata = AdVisualQaMetadataSchema.parse({
    kind: "ad.visual-qa",
    targetAssetId,
    variantId: variant.id,
    renderedPath: evidence.renderedPath,
    evidencePath: evidenceProjectPath,
    checks: evidence.checks,
    verdict,
    blockedReasons,
    visualQa,
    decisionLog,
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `ad-visual-qa-${safeSlug(metadata.variantId)}`,
    targetAssetId,
    metadataKind: "ad.visual-qa",
    producer: options.producer ?? "clash-production-plan-ad-visual-qa",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const report: AdVisualQaReport = {
    schemaVersion: 1,
    kind: "clash.ad.visual-qa",
    targetAssetId,
    variantId: metadata.variantId,
    renderedPath: metadata.renderedPath,
    evidencePath: metadata.evidencePath,
    checks: metadata.checks,
    verdict: metadata.verdict,
    blockedReasons: metadata.blockedReasons,
    visualQa: metadata.visualQa,
    decisionLog,
  };
  const actionPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("actions", `${safeSlug(metadata.variantId)}.ad-visual-qa.json`),
      "ad visual QA action",
    ),
    writeVerb: "Ad visual QA action",
  });
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.reportPath ?? join("qa", "visual", `${safeSlug(metadata.variantId)}.visual-qa.json`),
      "ad visual QA report",
    ),
    writeVerb: "Ad visual QA report",
  });
  await writeJson(actionPath, action);
  await writeJson(reportPath, report);
  return {
    planned: true,
    targetAssetId,
    variantId: metadata.variantId,
    verdict: metadata.verdict,
    actionPath,
    reportPath,
    checks: metadata.checks.length,
  };
}

function parseEvidence(input: unknown): AdVisualQaEvidence {
  if (!input || typeof input !== "object") {
    throw new Error("ad visual QA evidence must be an object");
  }
  const record = input as Record<string, unknown>;
  const checks = record.checks;
  if (!Array.isArray(checks) || checks.length === 0) {
    throw new Error("ad visual QA evidence must include checks");
  }
  return {
    targetAssetId: requireNonEmpty(record.targetAssetId, "targetAssetId"),
    variantId: requireNonEmpty(record.variantId, "variantId"),
    renderedPath: normalizeProjectRelativePath(
      requireNonEmpty(record.renderedPath, "renderedPath"),
      "renderedPath",
    ),
    checks: checks.map(parseCheck),
    ...parseAnalysisBackend(record.analysisBackend),
  };
}

function parseAnalysisBackend(input: unknown): { analysisBackend?: { id: string } } {
  if (input === undefined) return {};
  if (!input || typeof input !== "object") {
    throw new Error("ad visual QA analysisBackend must be an object when present");
  }
  const record = input as Record<string, unknown>;
  return { analysisBackend: { id: requireNonEmpty(record.id, "analysisBackend.id") } };
}

function parseCheck(input: unknown, index: number): AdVisualQaCheck {
  if (!input || typeof input !== "object") {
    throw new Error(`ad visual QA check ${index + 1} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const status = record.status;
  if (status !== "pass" && status !== "fail" && status !== "requires-review") {
    throw new Error(`ad visual QA check ${index + 1} status must be pass, fail, or requires-review`);
  }
  return {
    id: requireNonEmpty(record.id, `ad visual QA check ${index + 1} id`),
    check: AdVisualQaCheckKindSchema.parse(record.check),
    status,
    required: record.required === undefined ? true : record.required === true,
    expected: requireNonEmpty(record.expected, `ad visual QA check ${index + 1} expected`),
    actual: requireNonEmpty(record.actual, `ad visual QA check ${index + 1} actual`),
    ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
    ...(typeof record.frame === "number" ? { frame: record.frame } : {}),
    ...(typeof record.evidencePath === "string" && record.evidencePath.trim()
      ? { evidencePath: normalizeProjectRelativePath(record.evidencePath, `ad visual QA check ${index + 1} evidencePath`) }
      : {}),
  };
}

function buildVerdict(checks: AdVisualQaCheck[]): "pass" | "requires-review" | "fail" {
  if (checks.some((check) => check.required && check.status === "fail")) return "fail";
  if (checks.some((check) => check.required && check.status === "requires-review")) return "requires-review";
  return "pass";
}

function buildVisualQaReport(checks: AdVisualQaCheck[]): AdVisualQaMetadata["visualQa"] {
  return {
    captionsPresent: checkPassedOrAbsent(checks, "captions-present"),
    safeZoneViolations: checks
      .filter((check) => check.check === "safe-zone" && check.status === "fail")
      .map((check) => ({
        ...(check.frame === undefined ? {} : { frame: check.frame }),
        description: check.actual,
        severity: "error" as const,
      })),
    packshotVisible: checkPassedOrAbsent(checks, "packshot-visible"),
    endCardVisible: checkPassedOrAbsent(checks, "end-card-visible"),
    disclaimerVisible: checkPassedOrAbsent(checks, "disclaimer-visible")
      && checkPassedOrAbsent(checks, "disclaimer-ocr"),
    ctaVisible: checkPassedOrAbsent(checks, "cta-visible"),
    logoLockupVisible: checkPassedOrAbsent(checks, "logo-lockup-visible"),
    finalFrameHolds: checkPassedOrAbsent(checks, "final-frame-hold"),
  };
}

function checkPassedOrAbsent(checks: AdVisualQaCheck[], kind: AdVisualQaCheckKind): boolean {
  const matching = checks.filter((check) => check.check === kind);
  return matching.length === 0 || matching.every((check) => check.status === "pass");
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
  return slug || "ad-visual-qa";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
