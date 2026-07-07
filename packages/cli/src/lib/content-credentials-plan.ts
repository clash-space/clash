import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AssetMetadataFillActionSchema,
  ContentCredentialIngredientRelationshipSchema,
  ContentCredentialModeSchema,
  ContentCredentialSignatureStatusSchema,
  ContentCredentialsMetadataSchema,
  type AssetMetadataFillAction,
  type ContentCredentialAction,
  type ContentCredentialAssertion,
  type ContentCredentialIngredient,
  type ContentCredentialIngredientRelationship,
  type ContentCredentialMode,
  type ContentCredentialSignatureStatus,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ContentCredentialsReport = {
  schemaVersion: 1;
  kind: "clash.provenance.content-credentials";
  targetAssetId: string;
  credentialId: string;
  targetPath?: string;
  targetHash?: string;
  mode: ContentCredentialMode;
  signatureStatus: ContentCredentialSignatureStatus;
  c2paManifestPath?: string;
  c2paManifestHash?: string;
  issuer?: string;
  ingredients: ContentCredentialIngredient[];
  actions: ContentCredentialAction[];
  assertions: ContentCredentialAssertion[];
  decisionLog: string[];
};

export type PlanContentCredentialsOptions = {
  cwd: string;
  targetAssetId: string;
  requestPath: string;
  outPath?: string;
  reportPath?: string;
  producer?: string;
};

export type PlanContentCredentialsResult = {
  planned: true;
  targetAssetId: string;
  credentialId: string;
  actionPath: string;
  reportPath: string;
  signatureStatus: ContentCredentialSignatureStatus;
  ingredients: number;
};

type ContentCredentialsRequestIngredient = {
  assetId?: string;
  path: string;
  relationship: ContentCredentialIngredientRelationship;
  hash?: string;
  title?: string;
  rights?: string;
};

type ContentCredentialsRequest = {
  credentialId: string;
  targetAssetId: string;
  targetPath: string;
  mode: ContentCredentialMode;
  signatureStatus: ContentCredentialSignatureStatus;
  c2paManifestPath?: string;
  issuer?: string;
  ingredients: ContentCredentialsRequestIngredient[];
  actions: ContentCredentialAction[];
  assertions: ContentCredentialAssertion[];
};

export async function planContentCredentialsAction(
  options: PlanContentCredentialsOptions,
): Promise<PlanContentCredentialsResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const requestPath = resolveProjectPath(cwd, options.requestPath, "content credentials request");
  const request = parseRequest(JSON.parse(await readFile(requestPath, "utf8")));
  if (request.targetAssetId !== targetAssetId) {
    throw new Error(`content credentials targetAssetId ${request.targetAssetId} does not match ${targetAssetId}`);
  }
  const targetHash = await hashProjectFile(cwd, request.targetPath, "content credentials target");
  const ingredients = await Promise.all(
    request.ingredients.map((ingredient) => materializeIngredient(cwd, ingredient)),
  );
  const manifestHash = request.c2paManifestPath
    ? await hashProjectFile(cwd, request.c2paManifestPath, "C2PA manifest")
    : undefined;
  const decisionLog = buildDecisionLog(request.credentialId, request.signatureStatus);
  const metadata = ContentCredentialsMetadataSchema.parse({
    kind: "provenance.content-credentials",
    credentialId: request.credentialId,
    targetAssetId,
    targetPath: request.targetPath,
    targetHash,
    mode: request.mode,
    signatureStatus: request.signatureStatus,
    c2paManifestPath: request.c2paManifestPath,
    c2paManifestHash: manifestHash,
    issuer: request.issuer,
    ingredients,
    actions: request.actions,
    assertions: request.assertions,
    decisionLog,
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `content-credentials-${safeSlug(metadata.credentialId)}`,
    targetAssetId,
    metadataKind: "provenance.content-credentials",
    producer: options.producer ?? "clash-production-plan-content-credentials",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const report: ContentCredentialsReport = {
    schemaVersion: 1,
    kind: "clash.provenance.content-credentials",
    targetAssetId,
    credentialId: metadata.credentialId,
    targetPath: metadata.targetPath,
    targetHash: metadata.targetHash,
    mode: metadata.mode,
    signatureStatus: metadata.signatureStatus,
    c2paManifestPath: metadata.c2paManifestPath,
    c2paManifestHash: metadata.c2paManifestHash,
    issuer: metadata.issuer,
    ingredients: metadata.ingredients,
    actions: metadata.actions,
    assertions: metadata.assertions,
    decisionLog,
  };
  const actionPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("actions", `${safeSlug(metadata.credentialId)}.content-credentials.json`),
      "content credentials action",
    ),
    writeVerb: "Content credentials action",
  });
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.reportPath ?? join("qa", "provenance", `${safeSlug(metadata.credentialId)}.content-credentials.json`),
      "content credentials report",
    ),
    writeVerb: "Content credentials report",
  });
  await writeJson(actionPath, action);
  await writeJson(reportPath, report);
  return {
    planned: true,
    targetAssetId,
    credentialId: metadata.credentialId,
    actionPath,
    reportPath,
    signatureStatus: metadata.signatureStatus,
    ingredients: metadata.ingredients.length,
  };
}

function parseRequest(input: unknown): ContentCredentialsRequest {
  if (!input || typeof input !== "object") {
    throw new Error("content credentials request must be an object");
  }
  const record = input as Record<string, unknown>;
  return {
    credentialId: requireNonEmpty(record.credentialId, "credentialId"),
    targetAssetId: requireNonEmpty(record.targetAssetId, "targetAssetId"),
    targetPath: normalizeProjectRelativePath(
      requireNonEmpty(record.targetPath, "targetPath"),
      "targetPath",
    ),
    mode: ContentCredentialModeSchema.parse(record.mode),
    signatureStatus: ContentCredentialSignatureStatusSchema.parse(record.signatureStatus),
    ...(typeof record.c2paManifestPath === "string" && record.c2paManifestPath.trim()
      ? { c2paManifestPath: normalizeProjectRelativePath(record.c2paManifestPath, "c2paManifestPath") }
      : {}),
    ...(typeof record.issuer === "string" && record.issuer.trim() ? { issuer: record.issuer.trim() } : {}),
    ingredients: parseIngredients(record.ingredients),
    actions: parseActions(record.actions),
    assertions: parseAssertions(record.assertions),
  };
}

function parseIngredients(input: unknown): ContentCredentialsRequestIngredient[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("ingredients must be an array");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`ingredient ${index + 1} must be an object`);
    const record = item as Record<string, unknown>;
    return {
      ...(typeof record.assetId === "string" && record.assetId.trim() ? { assetId: record.assetId.trim() } : {}),
      path: normalizeProjectRelativePath(
        requireNonEmpty(record.path, `ingredient ${index + 1} path`),
        `ingredient ${index + 1} path`,
      ),
      relationship: ContentCredentialIngredientRelationshipSchema.parse(record.relationship),
      ...(typeof record.hash === "string" && record.hash.trim() ? { hash: record.hash.trim() } : {}),
      ...(typeof record.title === "string" && record.title.trim() ? { title: record.title.trim() } : {}),
      ...(typeof record.rights === "string" && record.rights.trim() ? { rights: record.rights.trim() } : {}),
    };
  });
}

function parseActions(input: unknown): ContentCredentialAction[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("actions must be an array");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`action ${index + 1} must be an object`);
    const record = item as Record<string, unknown>;
    return {
      ...(typeof record.actionId === "string" && record.actionId.trim() ? { actionId: record.actionId.trim() } : {}),
      action: requireNonEmpty(record.action, `action ${index + 1} action`),
      ...(typeof record.softwareAgent === "string" && record.softwareAgent.trim()
        ? { softwareAgent: record.softwareAgent.trim() }
        : {}),
      ...(typeof record.when === "string" && record.when.trim() ? { when: record.when.trim() } : {}),
    };
  });
}

function parseAssertions(input: unknown): ContentCredentialAssertion[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error("assertions must be an array");
  return input.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`assertion ${index + 1} must be an object`);
    const record = item as Record<string, unknown>;
    return {
      label: requireNonEmpty(record.label, `assertion ${index + 1} label`),
      value: requireNonEmpty(record.value, `assertion ${index + 1} value`),
      ...(typeof record.path === "string" && record.path.trim()
        ? { path: normalizeProjectRelativePath(record.path, `assertion ${index + 1} path`) }
        : {}),
      ...(typeof record.hash === "string" && record.hash.trim() ? { hash: record.hash.trim() } : {}),
    };
  });
}

async function materializeIngredient(
  cwd: string,
  ingredient: ContentCredentialsRequestIngredient,
): Promise<ContentCredentialIngredient> {
  const hash = ingredient.hash ?? await hashProjectFile(cwd, ingredient.path, `ingredient ${ingredient.path}`);
  return {
    ...(ingredient.assetId ? { assetId: ingredient.assetId } : {}),
    path: ingredient.path,
    relationship: ingredient.relationship,
    hash,
    ...(ingredient.title ? { title: ingredient.title } : {}),
    ...(ingredient.rights ? { rights: ingredient.rights } : {}),
  };
}

async function hashProjectFile(cwd: string, rawPath: string, label: string): Promise<string> {
  const filePath = resolveProjectPath(cwd, rawPath, label);
  const raw = await readFile(filePath);
  return `sha256:${createHash("sha256").update(raw).digest("hex")}`;
}

function buildDecisionLog(credentialId: string, signatureStatus: ContentCredentialSignatureStatus): string[] {
  if (signatureStatus === "signed") {
    return [`registered signed content credentials manifest ${credentialId}`, "did not sign C2PA manifest"];
  }
  return [`registered unsigned content credentials manifest ${credentialId}`, "did not sign C2PA manifest"];
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
  return slug || "content-credentials";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
