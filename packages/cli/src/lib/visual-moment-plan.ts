import {
  AssetMetadataFillActionSchema,
  VideoVisualMomentMetadataSchema,
  buildVisualMomentClipLibrary,
  type AssetMetadataFillAction,
} from "@clash/shared-types";

export type PlanVisualMomentsActionOptions = {
  targetAssetId: string;
  fps: number;
  moments: unknown;
  sourcePath?: string;
  actionId?: string;
  producer?: string;
  createdAt?: string;
};

export function planVisualMomentsAction(
  options: PlanVisualMomentsActionOptions,
): AssetMetadataFillAction {
  if (!options.targetAssetId.trim()) {
    throw new Error("target asset id is required");
  }
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    throw new Error("fps must be a positive number");
  }
  const raw = parseVisualMomentInput(options.moments);
  const metadata = VideoVisualMomentMetadataSchema.parse({
    kind: "video.visual-moments",
    sourceVideoAssetId: options.targetAssetId,
    fps: options.fps,
    sourcePath: options.sourcePath,
    sceneChanges: (raw.sceneChanges ?? []).map((frame) => parseNonNegativeInteger(frame, "scene change")),
    candidates: raw.candidates.map((candidate, index) => normalizeCandidate(candidate, index, options.fps)),
  });
  return AssetMetadataFillActionSchema.parse({
    actionId: options.actionId ?? `visual-moments-${options.targetAssetId}`,
    targetAssetId: options.targetAssetId,
    metadataKind: "video.visual-moments",
    producer: options.producer ?? "clash-production-plan-visual-moments",
    createdAt: options.createdAt,
    metadata,
  });
}

export function summarizeVisualMomentAction(action: AssetMetadataFillAction): {
  candidates: number;
  topCandidateId: string;
} {
  if (action.metadata.kind !== "video.visual-moments") {
    throw new Error(`Expected video.visual-moments action, got ${action.metadata.kind}`);
  }
  const clips = buildVisualMomentClipLibrary(action.metadata);
  return {
    candidates: action.metadata.candidates.length,
    topCandidateId: clips[0]?.id ?? "",
  };
}

function parseVisualMomentInput(input: unknown): {
  sceneChanges?: unknown[];
  candidates: unknown[];
} {
  if (Array.isArray(input)) return { candidates: input };
  if (input && typeof input === "object") {
    const record = input as Record<string, unknown>;
    if (!Array.isArray(record.candidates)) {
      throw new Error("visual moments JSON object must include a candidates array");
    }
    if (record.sceneChanges !== undefined && !Array.isArray(record.sceneChanges)) {
      throw new Error("visual moments sceneChanges must be an array when provided");
    }
    return {
      sceneChanges: record.sceneChanges as unknown[] | undefined,
      candidates: record.candidates,
    };
  }
  throw new Error("visual moments JSON must be an array or an object with candidates");
}

function normalizeCandidate(input: unknown, index: number, fps: number) {
  if (!input || typeof input !== "object") {
    throw new Error(`visual moment candidate ${index} must be an object`);
  }
  const record = input as Record<string, unknown>;
  const startMs = parseNonNegativeNumber(record.startMs, `candidate ${index} startMs`);
  const endMs = parseNonNegativeNumber(record.endMs, `candidate ${index} endMs`);
  const peakMs = parseNonNegativeNumber(record.peakMs, `candidate ${index} peakMs`);
  return {
    id: parseString(record.id, `candidate ${index} id`),
    startMs,
    endMs,
    peakMs,
    startFrame: record.startFrame === undefined
      ? msToFrame(startMs, fps)
      : parseNonNegativeInteger(record.startFrame, `candidate ${index} startFrame`),
    endFrame: record.endFrame === undefined
      ? msToFrame(endMs, fps)
      : parseNonNegativeInteger(record.endFrame, `candidate ${index} endFrame`),
    peakFrame: record.peakFrame === undefined
      ? msToFrame(peakMs, fps)
      : parseNonNegativeInteger(record.peakFrame, `candidate ${index} peakFrame`),
    sceneIndex: parseNonNegativeInteger(record.sceneIndex, `candidate ${index} sceneIndex`),
    motion: parseScore(record.motion, `candidate ${index} motion`),
    quality: parseScore(record.quality, `candidate ${index} quality`),
    ...(record.action === undefined ? {} : { action: parseScore(record.action, `candidate ${index} action`) }),
    ...(record.emotion === undefined ? {} : { emotion: parseScore(record.emotion, `candidate ${index} emotion`) }),
    ...(record.semantic === undefined ? {} : { semantic: parseString(record.semantic, `candidate ${index} semantic`) }),
    tags: parseStringArray(record.tags, `candidate ${index} tags`),
  };
}

function parseString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function parseStringArray(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

function parseNonNegativeNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, label: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseScore(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be a number from 0 to 1`);
  }
  return value;
}

function msToFrame(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}
