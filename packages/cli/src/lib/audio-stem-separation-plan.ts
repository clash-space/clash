import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AssetMetadataFillActionSchema,
  AudioStemSeparationMetadataSchema,
  AudioStemTypeSchema,
  type AssetMetadataFillAction,
  type AudioStemAsset,
  type AudioStemType,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type AudioStemSeparationReport = {
  schemaVersion: 1;
  kind: "clash.audio.stem-separation";
  targetAssetId: string;
  separationId: string;
  sourceAssetId: string;
  sourcePath?: string;
  backendId?: string;
  modelId?: string;
  stems: AudioStemAsset[];
  vocalStemAssetId?: string;
  decisionLog: string[];
};

export type PlanAudioStemSeparationOptions = {
  cwd: string;
  targetAssetId: string;
  stemsPath: string;
  outPath?: string;
  reportPath?: string;
  producer?: string;
};

export type PlanAudioStemSeparationResult = {
  planned: true;
  targetAssetId: string;
  separationId: string;
  actionPath: string;
  reportPath: string;
  stems: number;
  vocalStemAssetId?: string;
};

type AudioStemSeparationRequestStem = {
  stemAssetId: string;
  stemType: AudioStemType;
  path: string;
  codec?: string;
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
};

type AudioStemSeparationRequest = {
  separationId: string;
  sourceAssetId: string;
  sourcePath?: string;
  backendId?: string;
  modelId?: string;
  stems: AudioStemSeparationRequestStem[];
};

export async function planAudioStemSeparationAction(
  options: PlanAudioStemSeparationOptions,
): Promise<PlanAudioStemSeparationResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const stemsPath = resolveProjectPath(cwd, options.stemsPath, "audio stem separation request");
  const request = parseRequest(JSON.parse(await readFile(stemsPath, "utf8")));
  if (request.sourceAssetId !== targetAssetId) {
    throw new Error(`stem separation sourceAssetId ${request.sourceAssetId} does not match ${targetAssetId}`);
  }

  const stems = await Promise.all(
    request.stems.map((stem) => materializeStem(cwd, stem)),
  );
  const decisionLog = [
    `registered ${stems.length} audio stem files for ${request.separationId}`,
    "did not execute stem separation backends",
  ];
  const metadata = AudioStemSeparationMetadataSchema.parse({
    kind: "audio.stem-separation",
    separationId: request.separationId,
    sourceAssetId: request.sourceAssetId,
    sourcePath: request.sourcePath,
    backendId: request.backendId,
    modelId: request.modelId,
    stems,
    vocalStemAssetId: stems.find((stem) => stem.stemType === "vocal")?.stemAssetId,
    decisionLog,
  });
  const action: AssetMetadataFillAction = AssetMetadataFillActionSchema.parse({
    actionId: `audio-stem-separation-${safeSlug(metadata.separationId)}`,
    targetAssetId,
    metadataKind: "audio.stem-separation",
    producer: options.producer ?? "clash-production-plan-audio-stem-separation",
    createdAt: new Date().toISOString(),
    metadata,
  });
  const report: AudioStemSeparationReport = {
    schemaVersion: 1,
    kind: "clash.audio.stem-separation",
    targetAssetId,
    separationId: metadata.separationId,
    sourceAssetId: metadata.sourceAssetId,
    sourcePath: metadata.sourcePath,
    backendId: metadata.backendId,
    modelId: metadata.modelId,
    stems: metadata.stems,
    vocalStemAssetId: metadata.vocalStemAssetId,
    decisionLog,
  };
  const actionPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("actions", `${safeSlug(metadata.separationId)}.audio-stem-separation.json`),
      "audio stem separation action",
    ),
    writeVerb: "Audio stem separation action",
  });
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.reportPath ?? join("qa", "audio", `${safeSlug(metadata.separationId)}.stem-separation.json`),
      "audio stem separation report",
    ),
    writeVerb: "Audio stem separation report",
  });
  await writeJson(actionPath, action);
  await writeJson(reportPath, report);
  return {
    planned: true,
    targetAssetId,
    separationId: metadata.separationId,
    actionPath,
    reportPath,
    stems: metadata.stems.length,
    vocalStemAssetId: metadata.vocalStemAssetId,
  };
}

function parseRequest(input: unknown): AudioStemSeparationRequest {
  if (!input || typeof input !== "object") {
    throw new Error("audio stem separation request must be an object");
  }
  const record = input as Record<string, unknown>;
  const stems = record.stems;
  if (!Array.isArray(stems) || stems.length === 0) {
    throw new Error("audio stem separation request must include stems");
  }
  const sourcePath = optionalProjectRelativePath(record.sourcePath, "sourcePath");
  return {
    separationId: requireNonEmpty(record.separationId, "separationId"),
    sourceAssetId: requireNonEmpty(record.sourceAssetId, "sourceAssetId"),
    ...(sourcePath ? { sourcePath } : {}),
    ...optionalStringProp(record.backendId, "backendId"),
    ...optionalStringProp(record.modelId, "modelId"),
    stems: stems.map(parseRequestStem),
  };
}

function parseRequestStem(input: unknown, index: number): AudioStemSeparationRequestStem {
  if (!input || typeof input !== "object") {
    throw new Error(`stem ${index + 1} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const path = record.path ?? record.filePath;
  return {
    stemAssetId: requireNonEmpty(record.stemAssetId, `stem ${index + 1} stemAssetId`),
    stemType: AudioStemTypeSchema.parse(record.stemType),
    path: normalizeProjectRelativePath(
      requireNonEmpty(path, `stem ${index + 1} path`),
      `stem ${index + 1} path`,
    ),
    ...optionalStringProp(record.codec, "codec"),
    ...optionalPositiveNumberProp(record.durationSeconds, "durationSeconds"),
    ...optionalPositiveIntegerProp(record.sampleRate, "sampleRate"),
    ...optionalPositiveIntegerProp(record.channels, "channels"),
  };
}

async function materializeStem(cwd: string, stem: AudioStemSeparationRequestStem): Promise<AudioStemAsset> {
  const stemPath = resolveProjectPath(cwd, stem.path, `audio stem ${stem.stemAssetId}`);
  const raw = await readFile(stemPath);
  return {
    stemAssetId: stem.stemAssetId,
    stemType: stem.stemType,
    filePath: stem.path,
    fileHash: `sha256:${createHash("sha256").update(raw).digest("hex")}`,
    ...(stem.codec ? { codec: stem.codec } : {}),
    ...(stem.durationSeconds === undefined ? {} : { durationSeconds: stem.durationSeconds }),
    ...(stem.sampleRate === undefined ? {} : { sampleRate: stem.sampleRate }),
    ...(stem.channels === undefined ? {} : { channels: stem.channels }),
  };
}

function optionalStringProp(input: unknown, label: string): Record<string, string> {
  if (input === undefined) return {};
  return { [label]: requireNonEmpty(input, label) };
}

function optionalPositiveNumberProp(input: unknown, label: string): Record<string, number> {
  if (input === undefined) return {};
  if (typeof input !== "number" || !Number.isFinite(input) || input <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return { [label]: input };
}

function optionalPositiveIntegerProp(input: unknown, label: string): Record<string, number> {
  if (input === undefined) return {};
  if (typeof input !== "number" || !Number.isInteger(input) || input <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return { [label]: input };
}

function optionalProjectRelativePath(input: unknown, label: string): string | undefined {
  if (input === undefined) return undefined;
  return normalizeProjectRelativePath(requireNonEmpty(input, label), label);
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
  return slug || "audio-stem-separation";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
