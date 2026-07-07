import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AssetMetadataFillActionSchema,
  ImageEmbeddingBaselineForSchema,
  ImageEmbeddingDistanceMetricSchema,
  ImageEmbeddingStoreMetadataSchema,
  type AssetMetadataFillAction,
  type ImageEmbeddingBaselineFor,
  type ImageEmbeddingStoreItem,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ImageEmbeddingStoreReport = {
  schemaVersion: 1;
  kind: "clash.image.embedding-store";
  targetAssetId: string;
  embeddingSetId: string;
  modelId: string;
  dimension: number;
  distanceMetric: "cosine" | "dot" | "euclidean";
  items: ImageEmbeddingStoreItem[];
  copyOnWriteRequired: boolean;
  decisionLog: string[];
};

export type PlanImageEmbeddingStoreOptions = {
  cwd: string;
  targetAssetId: string;
  embeddingsPath: string;
  outPath?: string;
  reportPath?: string;
  producer?: string;
};

export type PlanImageEmbeddingStoreResult = {
  planned: true;
  targetAssetId: string;
  embeddingSetId: string;
  actionPath: string;
  reportPath: string;
  items: number;
  dimension: number;
};

type ImageEmbeddingStoreRequestItem = {
  assetId: string;
  roleId?: string;
  subjectId?: string;
  path: string;
  vectorPath: string;
  baselineFor: ImageEmbeddingBaselineFor[];
  locked: boolean;
  copyOnWriteRequired: boolean;
  tags: string[];
};

type ImageEmbeddingStoreRequest = {
  embeddingSetId: string;
  modelId: string;
  dimension: number;
  distanceMetric: "cosine" | "dot" | "euclidean";
  items: ImageEmbeddingStoreRequestItem[];
};

export async function planImageEmbeddingStoreAction(
  options: PlanImageEmbeddingStoreOptions,
): Promise<PlanImageEmbeddingStoreResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const embeddingsPath = resolveProjectPath(cwd, options.embeddingsPath, "image embedding store request");
  const request = parseRequest(JSON.parse(await readFile(embeddingsPath, "utf8")));
  const items = await Promise.all(
    request.items.map((item) => materializeEmbeddingItem(cwd, request.dimension, item)),
  );
  const metadata = ImageEmbeddingStoreMetadataSchema.parse({
    kind: "image.embedding-store",
    embeddingSetId: request.embeddingSetId,
    modelId: request.modelId,
    dimension: request.dimension,
    distanceMetric: request.distanceMetric,
    items,
    copyOnWriteRequired: items.every((item) => item.copyOnWriteRequired),
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `image-embedding-store-${safeSlug(metadata.embeddingSetId)}`,
    targetAssetId,
    metadataKind: "image.embedding-store",
    producer: options.producer ?? "clash-production-plan-image-embedding-store",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const report: ImageEmbeddingStoreReport = {
    schemaVersion: 1,
    kind: "clash.image.embedding-store",
    targetAssetId,
    embeddingSetId: metadata.embeddingSetId,
    modelId: metadata.modelId,
    dimension: metadata.dimension,
    distanceMetric: metadata.distanceMetric,
    items: metadata.items,
    copyOnWriteRequired: metadata.copyOnWriteRequired,
    decisionLog: [
      `registered ${metadata.items.length} image embedding vectors for ${metadata.embeddingSetId}`,
      "did not execute image embedding backends",
    ],
  };
  const actionPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("actions", `${safeSlug(metadata.embeddingSetId)}.image-embedding-store.json`),
      "image embedding store action",
    ),
    writeVerb: "Image embedding store action",
  });
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.reportPath ?? join("qa", "image", `${safeSlug(metadata.embeddingSetId)}.embedding-store.json`),
      "image embedding store report",
    ),
    writeVerb: "Image embedding store report",
  });
  await writeJson(actionPath, action);
  await writeJson(reportPath, report);
  return {
    planned: true,
    targetAssetId,
    embeddingSetId: metadata.embeddingSetId,
    actionPath,
    reportPath,
    items: metadata.items.length,
    dimension: metadata.dimension,
  };
}

function parseRequest(input: unknown): ImageEmbeddingStoreRequest {
  if (!input || typeof input !== "object") {
    throw new Error("image embedding store request must be an object");
  }
  const record = input as Record<string, unknown>;
  const dimension = parsePositiveInteger(record.dimension, "dimension");
  const items = record.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("image embedding store request must include items");
  }
  return {
    embeddingSetId: requireNonEmpty(record.embeddingSetId, "embeddingSetId"),
    modelId: requireNonEmpty(record.modelId, "modelId"),
    dimension,
    distanceMetric: ImageEmbeddingDistanceMetricSchema.parse(record.distanceMetric),
    items: items.map(parseRequestItem),
  };
}

function parseRequestItem(input: unknown, index: number): ImageEmbeddingStoreRequestItem {
  if (!input || typeof input !== "object") {
    throw new Error(`embedding item ${index + 1} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const baselineFor = record.baselineFor;
  if (!Array.isArray(baselineFor) || baselineFor.length === 0) {
    throw new Error(`embedding item ${index + 1} baselineFor must be a non-empty array`);
  }
  return {
    assetId: requireNonEmpty(record.assetId, `embedding item ${index + 1} assetId`),
    ...(typeof record.roleId === "string" && record.roleId.trim() ? { roleId: record.roleId.trim() } : {}),
    ...(typeof record.subjectId === "string" && record.subjectId.trim() ? { subjectId: record.subjectId.trim() } : {}),
    path: normalizeProjectRelativePath(
      requireNonEmpty(record.path, `embedding item ${index + 1} path`),
      `embedding item ${index + 1} path`,
    ),
    vectorPath: normalizeProjectRelativePath(
      requireNonEmpty(record.vectorPath, `embedding item ${index + 1} vectorPath`),
      `embedding item ${index + 1} vectorPath`,
    ),
    baselineFor: baselineFor.map((item) => ImageEmbeddingBaselineForSchema.parse(item)),
    locked: record.locked === undefined ? true : record.locked === true,
    copyOnWriteRequired: record.copyOnWriteRequired === undefined ? true : record.copyOnWriteRequired === true,
    tags: parseStringList(record.tags, `embedding item ${index + 1} tags`),
  };
}

async function materializeEmbeddingItem(
  cwd: string,
  expectedDimension: number,
  item: ImageEmbeddingStoreRequestItem,
): Promise<ImageEmbeddingStoreItem> {
  const vectorPath = resolveProjectPath(cwd, item.vectorPath, `embedding vector ${item.assetId}`);
  const raw = await readFile(vectorPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error(`embedding vector ${item.vectorPath} must be a JSON array of finite numbers`);
  }
  if (parsed.length !== expectedDimension) {
    throw new Error(`embedding vector ${item.vectorPath} dimension ${parsed.length} does not match ${expectedDimension}`);
  }
  return {
    assetId: item.assetId,
    ...(item.roleId ? { roleId: item.roleId } : {}),
    ...(item.subjectId ? { subjectId: item.subjectId } : {}),
    path: item.path,
    vectorPath: item.vectorPath,
    vectorHash: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    dimension: parsed.length,
    baselineFor: item.baselineFor,
    locked: item.locked,
    copyOnWriteRequired: item.copyOnWriteRequired,
    tags: item.tags,
  };
}

function parsePositiveInteger(input: unknown, label: string): number {
  if (typeof input !== "number" || !Number.isInteger(input) || input <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return input;
}

function parseStringList(input: unknown, label: string): string[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) throw new Error(`${label} must be an array`);
  return input.map((item) => requireNonEmpty(item, label));
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
  return slug || "image-embedding-store";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
