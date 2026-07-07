import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AssetMetadataFillActionSchema,
  ProductLogoQaCheckKindSchema,
  ProductLogoQaMetadataSchema,
  SemanticReferenceRoleSchema,
  buildProductLogoQaVerdict,
  type AssetMetadataFillAction,
  type ProductLogoQaCheck,
  type ProductLogoQaReference,
  type SemanticReferenceRole,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ProductLogoQaReport = {
  schemaVersion: 1;
  kind: "clash.image.product-logo-qa";
  targetAssetId: string;
  referencePackAssetId?: string;
  requiredReferenceAssetIds: string[];
  references: ProductLogoQaReference[];
  checks: ProductLogoQaCheck[];
  verdict: "pass" | "requires-review" | "fail";
  blockedReasons: string[];
  copyOnWriteRequired: boolean;
};

export type PlanProductLogoQaOptions = {
  cwd: string;
  targetAssetId: string;
  referenceRolesPath: string;
  evidencePath: string;
  outPath?: string;
  reportPath?: string;
  producer?: string;
};

export type PlanProductLogoQaResult = {
  planned: true;
  targetAssetId: string;
  actionPath: string;
  reportPath: string;
  verdict: "pass" | "requires-review" | "fail";
  checks: number;
  blockedReasons: string[];
};

type ProductLogoQaObservation = {
  id: string;
  roleId: string;
  check: ProductLogoQaCheck["check"];
  status: ProductLogoQaCheck["status"];
  required: boolean;
  expected?: string;
  actual?: string;
  confidence?: number;
  deltaE?: number;
  evidence?: string;
};

export async function planProductLogoQaAction(
  options: PlanProductLogoQaOptions,
): Promise<PlanProductLogoQaResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const referenceRolesPath = resolveProjectPath(cwd, options.referenceRolesPath, "reference roles");
  const evidencePath = resolveProjectPath(cwd, options.evidencePath, "product/logo QA evidence");
  const roleInput = JSON.parse(await readFile(referenceRolesPath, "utf8"));
  const evidenceInput = JSON.parse(await readFile(evidencePath, "utf8"));
  const allRoles = parseSemanticReferenceRoles(roleInput);
  const referencePackAssetId = parseReferencePackAssetId(roleInput);
  const references = allRoles
    .filter(isProductLogoReferenceRole)
    .map((role): ProductLogoQaReference => ({
      roleId: role.roleId,
      assetId: role.assetId,
      role: role.role,
      ...(role.subjectId ? { subjectId: role.subjectId } : {}),
      path: role.path,
      locked: role.locked,
      copyOnWriteRequired: role.copyOnWriteRequired,
      constraints: role.constraints,
    }));
  if (references.length === 0) {
    throw new Error("product/logo QA requires at least one logo-lock or product-packshot reference role");
  }
  const observations = parseEvidenceObservations(evidenceInput, targetAssetId);
  const checks = buildProductLogoChecks(references, observations);
  const verdict = buildProductLogoQaVerdict(checks);
  const metadata = ProductLogoQaMetadataSchema.parse({
    kind: "image.product-logo-qa",
    targetAssetId,
    ...(referencePackAssetId ? { referencePackAssetId } : {}),
    requiredReferenceAssetIds: references.map((reference) => reference.assetId),
    references,
    checks,
    verdict: verdict.verdict,
    blockedReasons: verdict.blockedReasons,
    copyOnWriteRequired: references.every((reference) => reference.copyOnWriteRequired),
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `product-logo-qa-${safeSlug(targetAssetId)}`,
    targetAssetId,
    metadataKind: "image.product-logo-qa",
    producer: options.producer ?? "clash-production-plan-product-logo-qa",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const report: ProductLogoQaReport = {
    schemaVersion: 1,
    kind: "clash.image.product-logo-qa",
    targetAssetId,
    ...(referencePackAssetId ? { referencePackAssetId } : {}),
    requiredReferenceAssetIds: metadata.requiredReferenceAssetIds,
    references: metadata.references,
    checks: metadata.checks,
    verdict: metadata.verdict,
    blockedReasons: metadata.blockedReasons,
    copyOnWriteRequired: metadata.copyOnWriteRequired,
  };
  const actionPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("actions", `${safeSlug(targetAssetId)}.product-logo-qa.json`),
      "product/logo QA action",
    ),
    writeVerb: "Product/logo QA action",
  });
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.reportPath ?? join("qa", "image", `${safeSlug(targetAssetId)}.product-logo-qa.json`),
      "product/logo QA report",
    ),
    writeVerb: "Product/logo QA report",
  });
  await writeJson(actionPath, action);
  await writeJson(reportPath, report);
  return {
    planned: true,
    targetAssetId,
    actionPath,
    reportPath,
    verdict: metadata.verdict,
    checks: metadata.checks.length,
    blockedReasons: metadata.blockedReasons,
  };
}

function isProductLogoReferenceRole(
  role: SemanticReferenceRole,
): role is SemanticReferenceRole & { role: "logo-lock" | "product-packshot" } {
  return role.role === "logo-lock" || role.role === "product-packshot";
}

function parseSemanticReferenceRoles(input: unknown): SemanticReferenceRole[] {
  const rawRoles: unknown[] | undefined = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as Record<string, unknown>).roles)
      ? (input as Record<string, unknown>).roles as unknown[]
      : undefined;
  if (!rawRoles || rawRoles.length === 0) {
    throw new Error("reference roles must be a non-empty array or an object with roles");
  }
  return SemanticReferenceRoleSchema.array().parse(rawRoles);
}

function parseReferencePackAssetId(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const targetAssetId = (input as Record<string, unknown>).targetAssetId;
  return typeof targetAssetId === "string" && targetAssetId.trim() ? targetAssetId.trim() : undefined;
}

function parseEvidenceObservations(
  input: unknown,
  targetAssetId: string,
): ProductLogoQaObservation[] {
  if (!input || typeof input !== "object") {
    throw new Error("product/logo QA evidence must be an object");
  }
  const record = input as Record<string, unknown>;
  if (
    typeof record.targetAssetId === "string" &&
    record.targetAssetId.trim() &&
    record.targetAssetId.trim() !== targetAssetId
  ) {
    throw new Error(`evidence targetAssetId ${record.targetAssetId} does not match ${targetAssetId}`);
  }
  if (!Array.isArray(record.observations) || record.observations.length === 0) {
    throw new Error("product/logo QA evidence must include observations");
  }
  return record.observations.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`observation ${index} must be an object`);
    }
    const observation = item as Record<string, unknown>;
    return {
      id: typeof observation.id === "string" && observation.id.trim()
        ? observation.id.trim()
        : `observation-${index + 1}`,
      roleId: requireNonEmpty(observation.roleId, `observation ${index + 1} roleId`),
      check: ProductLogoQaCheckKindSchema.parse(observation.check),
      status: parseCheckStatus(observation.status, index),
      required: observation.required === undefined ? true : observation.required === true,
      expected: typeof observation.expected === "string" && observation.expected.trim()
        ? observation.expected.trim()
        : undefined,
      actual: typeof observation.actual === "string" && observation.actual.trim()
        ? observation.actual.trim()
        : undefined,
      confidence: parseOptionalScore(observation.confidence, `observation ${index + 1} confidence`),
      deltaE: parseOptionalNonNegativeNumber(observation.deltaE, `observation ${index + 1} deltaE`),
      evidence: typeof observation.evidence === "string" && observation.evidence.trim()
        ? observation.evidence.trim()
        : undefined,
    };
  });
}

function buildProductLogoChecks(
  references: ProductLogoQaReference[],
  observations: ProductLogoQaObservation[],
): ProductLogoQaCheck[] {
  const referenceByRoleId = new Map(references.map((reference) => [reference.roleId, reference]));
  const checks: ProductLogoQaCheck[] = [];
  const observedRoleIds = new Set<string>();
  for (const observation of observations) {
    const reference = referenceByRoleId.get(observation.roleId);
    if (!reference) {
      throw new Error(`observation ${observation.id} references unknown product/logo role ${observation.roleId}`);
    }
    observedRoleIds.add(observation.roleId);
    checks.push({
      id: observation.id,
      roleId: observation.roleId,
      referenceAssetId: reference.assetId,
      check: observation.check,
      status: observation.status,
      required: observation.required,
      expected: observation.expected ?? summarizeReferenceExpectation(reference),
      actual: observation.actual ?? (observation.status === "pass" ? "observed" : "not observed"),
      ...(observation.confidence === undefined ? {} : { confidence: observation.confidence }),
      ...(observation.deltaE === undefined ? {} : { deltaE: observation.deltaE }),
      ...(observation.evidence === undefined ? {} : { evidence: observation.evidence }),
    });
  }
  for (const reference of references) {
    if (observedRoleIds.has(reference.roleId)) continue;
    checks.push({
      id: `missing-${reference.roleId}`,
      roleId: reference.roleId,
      referenceAssetId: reference.assetId,
      check: reference.role === "logo-lock" ? "logo-presence" : "packshot-presence",
      status: "fail",
      required: true,
      expected: summarizeReferenceExpectation(reference),
      actual: "no evidence observation provided",
    });
  }
  return checks;
}

function summarizeReferenceExpectation(reference: ProductLogoQaReference): string {
  if (reference.constraints.length > 0) return reference.constraints.join("; ");
  return reference.role === "logo-lock"
    ? "locked brand logo must be preserved"
    : "locked product packshot must be preserved";
}

function parseCheckStatus(input: unknown, index: number): ProductLogoQaCheck["status"] {
  if (input === "pass" || input === "requires-review" || input === "fail") return input;
  throw new Error(`observation ${index + 1} status must be pass, requires-review, or fail`);
}

function parseOptionalScore(input: unknown, label: string): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0 || input > 1) {
    throw new Error(`${label} must be between 0 and 1`);
  }
  return input;
}

function parseOptionalNonNegativeNumber(input: unknown, label: string): number | undefined {
  if (input === undefined) return undefined;
  if (typeof input !== "number" || !Number.isFinite(input) || input < 0) {
    throw new Error(`${label} must be a non-negative number`);
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

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "product-logo-qa";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
