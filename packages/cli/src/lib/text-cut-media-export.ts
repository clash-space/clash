import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AssetMetadataFillActionSchema } from "@clash/shared-types";

type ProductionAssetManifestAsset = {
  id: string;
  type: string;
  path?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type ProductionAssetManifest = {
  assets: ProductionAssetManifestAsset[];
  [key: string]: unknown;
};

type KeepSegment = {
  id: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  outputStartFrame: number;
  outputEndFrame: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
};

type DeletedRange = {
  id: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  reason?: string;
  confidence?: number;
  detectionSource?: string;
  startSeconds: number;
  endSeconds: number;
};

type ReviewRange = DeletedRange & {
  requiresReview: true;
};

type TextCutMediaProbe = {
  durationSeconds: number;
  hasVideo: boolean;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  width?: number;
  height?: number;
};

export type ExportTextCutMediaOptions = {
  cwd: string;
  actionPath: string;
  assetsPath?: string;
  sourceAssetId?: string;
  outputAssetId: string;
  outPath?: string;
  render?: boolean;
  includeAudio?: boolean;
  ffmpegPath?: string;
  ffprobePath?: string;
};

export type ExportTextCutMediaResult = {
  exported: true;
  sourceAssetId: string;
  outputAssetId: string;
  outputPath: string;
  packagePath: string;
  concatPath: string;
  ffmpegPlanPath: string;
  assetsPath: string;
  rendered: boolean;
  keepSegments: number;
  deletedRanges: number;
  reviewRanges: number;
  probe?: TextCutMediaProbe;
};

export async function exportTextCutMedia(
  options: ExportTextCutMediaOptions,
): Promise<ExportTextCutMediaResult> {
  const cwd = resolve(options.cwd);
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "assets path");
  const actionPath = resolveProjectPath(cwd, options.actionPath, "action path");
  const action = AssetMetadataFillActionSchema.parse(
    JSON.parse(await readFile(actionPath, "utf8")),
  );
  if (action.metadata.kind !== "talking-head.analysis") {
    throw new Error(`export-text-cut-media requires talking-head.analysis metadata, got ${action.metadata.kind}`);
  }

  const sourceAssetId = options.sourceAssetId ?? action.targetAssetId;
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);
  const sourceAsset = manifest.assets.find((asset) => asset.id === sourceAssetId);
  if (!sourceAsset) {
    throw new Error(`Source asset ${sourceAssetId} not found in ${assetsPath}`);
  }
  if (!sourceAsset.path) {
    throw new Error(`Source asset ${sourceAssetId} must have a local path`);
  }
  const sourcePath = resolveProjectPath(cwd, sourceAsset.path, `source asset ${sourceAssetId} path`);
  const outputRelativePath = normalizeProjectRelativePath(
    options.outPath ?? join("assets", "video", `${safeFileStem(options.outputAssetId)}.mp4`),
    "output path",
  );
  const outputPath = resolveProjectPath(cwd, outputRelativePath, "output path");
  const packageRelativePath = join("projections", "media-cuts", `${safeFileStem(options.outputAssetId)}.media-cut.json`);
  const concatRelativePath = join("projections", "media-cuts", `${safeFileStem(options.outputAssetId)}.ffconcat`);
  const ffmpegPlanRelativePath = join("projections", "media-cuts", `${safeFileStem(options.outputAssetId)}.ffmpeg-plan.json`);
  const packagePath = resolve(cwd, packageRelativePath);
  const concatPath = resolve(cwd, concatRelativePath);
  const ffmpegPlanPath = resolve(cwd, ffmpegPlanRelativePath);

  const keepSegments = buildKeepSegments(action.metadata.cuts, action.metadata.fps);
  const deletedRanges = buildDeletedRanges(action.metadata.cuts, action.metadata.fps);
  const reviewRanges = buildReviewRanges(action.metadata.cuts, action.metadata.fps);
  if (keepSegments.length === 0) {
    throw new Error("talking-head cut plan has no keep segments to export");
  }
  const shouldRender = options.render === true;
  if (shouldRender && reviewRanges.length > 0) {
    throw new Error(
      `talking-head cut plan has ${reviewRanges.length} review range(s); approve or remove review cuts before rendering`,
    );
  }

  await writeText(concatPath, buildFfconcat(sourcePath, keepSegments));
  const ffmpegArgs = buildFfmpegArgs({
    sourcePath,
    outputPath,
    keepSegments,
    includeAudio: options.includeAudio !== false,
  });
  const ffmpegPlan = {
    kind: "clash.talking-head.ffmpeg-plan",
    version: 1,
    ffmpeg: options.ffmpegPath ?? process.env.CLASH_FFMPEG_PATH ?? process.env.FFMPEG_PATH ?? "ffmpeg",
    args: ffmpegArgs,
    concatPath: toProjectRelativePath(cwd, concatPath),
  };
  await writeJson(ffmpegPlanPath, ffmpegPlan);

  let probe: TextCutMediaProbe | undefined;
  if (shouldRender) {
    await mkdir(dirname(outputPath), { recursive: true });
    await runFfmpeg(ffmpegPlan.ffmpeg, ffmpegArgs);
    probe = await probeRenderedMedia(
      options.ffprobePath ?? process.env.CLASH_FFPROBE_PATH ?? process.env.FFPROBE_PATH ?? "ffprobe",
      outputPath,
    );
  }

  const cutPackage = {
    kind: "clash.talking-head.media-cut-export",
    version: 1,
    sourceAssetId,
    outputAssetId: options.outputAssetId,
    sourcePath: toProjectRelativePath(cwd, sourcePath),
    outputPath: outputRelativePath,
    actionId: action.actionId,
    metadataKind: action.metadataKind,
    fps: action.metadata.fps,
    rendered: shouldRender,
    renderMode: shouldRender ? "ffmpeg-trim-concat" : "plan-only",
    artifacts: {
      packagePath: packageRelativePath,
      concatPath: concatRelativePath,
      ffmpegPlanPath: ffmpegPlanRelativePath,
      outputPath: outputRelativePath,
    },
    keepSegments,
    deletedRanges,
    reviewRanges,
    sourceToOutputMap: keepSegments.map((segment) => ({
      sourceStartFrame: segment.sourceStartFrame,
      sourceEndFrame: segment.sourceEndFrame,
      outputStartFrame: segment.outputStartFrame,
      outputEndFrame: segment.outputEndFrame,
    })),
    ...(probe ? { probe } : {}),
  };
  await writeJson(packagePath, cutPackage);

  upsertOutputAsset(manifest, {
    outputAssetId: options.outputAssetId,
    type: shouldRender ? "video" : "video-cut-plan",
    path: shouldRender ? outputRelativePath : packageRelativePath,
    metadata: {
      "talking-head.media-cut-export": {
        sourceAssetId,
        actionId: action.actionId,
        metadataKind: action.metadataKind,
        rendered: shouldRender,
        packagePath: packageRelativePath,
        concatPath: concatRelativePath,
        ffmpegPlanPath: ffmpegPlanRelativePath,
        outputPath: outputRelativePath,
        deletedRanges: cutPackage.deletedRanges,
        reviewRanges: cutPackage.reviewRanges,
        sourceToOutputMap: cutPackage.sourceToOutputMap,
        ...(probe ? { probe } : {}),
      },
    },
  });
  await writeJson(assetsPath, manifest);

  return {
    exported: true,
    sourceAssetId,
    outputAssetId: options.outputAssetId,
    outputPath,
    packagePath,
    concatPath,
    ffmpegPlanPath,
    assetsPath,
    rendered: shouldRender,
    keepSegments: keepSegments.length,
    deletedRanges: deletedRanges.length,
    reviewRanges: reviewRanges.length,
    ...(probe ? { probe } : {}),
  };
}

function buildKeepSegments(cuts: Array<{
  id: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  outputStartFrame: number;
  outputEndFrame: number;
  action: string;
}>, fps: number): KeepSegment[] {
  return cuts
    .filter((cut) => cut.action === "keep" && cut.sourceEndFrame > cut.sourceStartFrame)
    .map((cut) => {
      const startSeconds = frameToSeconds(cut.sourceStartFrame, fps);
      const endSeconds = frameToSeconds(cut.sourceEndFrame, fps);
      return {
        id: cut.id,
        sourceStartFrame: cut.sourceStartFrame,
        sourceEndFrame: cut.sourceEndFrame,
        outputStartFrame: cut.outputStartFrame,
        outputEndFrame: cut.outputEndFrame,
        startSeconds,
        endSeconds,
        durationSeconds: endSeconds - startSeconds,
      };
    });
}

function buildDeletedRanges(cuts: Array<{
  id: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  action: string;
  reason?: string;
  confidence?: number;
  detectionSource?: string;
}>, fps: number): DeletedRange[] {
  return cuts
    .filter((cut) => cut.action === "delete" && cut.sourceEndFrame >= cut.sourceStartFrame)
    .map((cut) => ({
      id: cut.id,
      sourceStartFrame: cut.sourceStartFrame,
      sourceEndFrame: cut.sourceEndFrame,
      reason: cut.reason,
      confidence: cut.confidence,
      detectionSource: cut.detectionSource,
      startSeconds: frameToSeconds(cut.sourceStartFrame, fps),
      endSeconds: frameToSeconds(cut.sourceEndFrame, fps),
    }));
}

function buildReviewRanges(cuts: Array<{
  id: string;
  sourceStartFrame: number;
  sourceEndFrame: number;
  action: string;
  reason?: string;
  requiresReview?: boolean;
  confidence?: number;
  detectionSource?: string;
}>, fps: number): ReviewRange[] {
  return cuts
    .filter((cut) => cut.action === "review" && cut.sourceEndFrame >= cut.sourceStartFrame)
    .map((cut) => ({
      id: cut.id,
      sourceStartFrame: cut.sourceStartFrame,
      sourceEndFrame: cut.sourceEndFrame,
      reason: cut.reason,
      confidence: cut.confidence,
      detectionSource: cut.detectionSource,
      requiresReview: true,
      startSeconds: frameToSeconds(cut.sourceStartFrame, fps),
      endSeconds: frameToSeconds(cut.sourceEndFrame, fps),
    }));
}

function buildFfmpegArgs(options: {
  sourcePath: string;
  outputPath: string;
  keepSegments: KeepSegment[];
  includeAudio: boolean;
}): string[] {
  const filterParts: string[] = [];
  const concatInputs: string[] = [];
  options.keepSegments.forEach((segment, index) => {
    filterParts.push(
      `[0:v]trim=start=${formatSeconds(segment.startSeconds)}:end=${formatSeconds(segment.endSeconds)},setpts=PTS-STARTPTS[v${index}]`,
    );
    concatInputs.push(`[v${index}]`);
    if (options.includeAudio) {
      filterParts.push(
        `[0:a]atrim=start=${formatSeconds(segment.startSeconds)}:end=${formatSeconds(segment.endSeconds)},asetpts=PTS-STARTPTS[a${index}]`,
      );
      concatInputs.push(`[a${index}]`);
    }
  });
  filterParts.push(
    `${concatInputs.join("")}concat=n=${options.keepSegments.length}:v=1:a=${options.includeAudio ? 1 : 0}${options.includeAudio ? "[vout][aout]" : "[vout]"}`,
  );
  const args = [
    "-y",
    "-i",
    options.sourcePath,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[vout]",
  ];
  if (options.includeAudio) {
    args.push("-map", "[aout]");
  } else {
    args.push("-an");
  }
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p");
  if (options.includeAudio) {
    args.push("-c:a", "aac");
  }
  args.push("-movflags", "+faststart", options.outputPath);
  return args;
}

function buildFfconcat(sourcePath: string, keepSegments: KeepSegment[]): string {
  const lines = ["ffconcat version 1.0"];
  for (const segment of keepSegments) {
    lines.push(`file '${escapeFfconcatPath(sourcePath)}'`);
    lines.push(`inpoint ${formatSeconds(segment.startSeconds)}`);
    lines.push(`outpoint ${formatSeconds(segment.endSeconds)}`);
  }
  return `${lines.join("\n")}\n`;
}

function upsertOutputAsset(
  manifest: ProductionAssetManifest,
  options: {
    outputAssetId: string;
    type: string;
    path: string;
    metadata: Record<string, unknown>;
  },
): void {
  const existingIndex = manifest.assets.findIndex((asset) => asset.id === options.outputAssetId);
  const next = {
    ...(existingIndex >= 0 ? manifest.assets[existingIndex] : {}),
    id: options.outputAssetId,
    type: options.type,
    path: options.path,
    metadata: {
      ...(existingIndex >= 0 ? manifest.assets[existingIndex].metadata ?? {} : {}),
      ...options.metadata,
    },
  };
  if (existingIndex >= 0) {
    manifest.assets[existingIndex] = next;
  } else {
    manifest.assets.push(next);
  }
}

function parseAssetManifest(raw: string, path: string): ProductionAssetManifest {
  const parsed = JSON.parse(raw) as Partial<ProductionAssetManifest>;
  if (!Array.isArray(parsed.assets)) {
    throw new Error(`Invalid asset manifest at ${path}: expected assets array`);
  }
  return {
    ...parsed,
    assets: parsed.assets.map((asset) => ({
      ...asset,
      metadata: asset.metadata && typeof asset.metadata === "object" && !Array.isArray(asset.metadata)
        ? asset.metadata as Record<string, unknown>
        : {},
    })),
  } as ProductionAssetManifest;
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
  if (parts.includes("..")) {
    throw new Error(`${label} must stay inside the project`);
  }
  return parts.join("/");
}

function toProjectRelativePath(cwd: string, path: string): string {
  return normalizeProjectRelativePath(relative(cwd, path), "artifact path");
}

function safeFileStem(value: string): string {
  const stem = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return stem.length > 0 ? stem : "text-cut-media";
}

function frameToSeconds(frame: number, fps: number): number {
  return frame / fps;
}

function formatSeconds(value: number): string {
  return value.toFixed(6);
}

function escapeFfconcatPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/'/g, "\\'");
}

async function runFfmpeg(ffmpegPath: string, args: string[]): Promise<void> {
  const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await new Promise<void>((resolvePromise, reject) => {
    proc.on("error", (error) => reject(new Error(`ffmpeg spawn failed: ${error.message}`)));
    proc.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`));
    });
  });
}

async function probeRenderedMedia(ffprobePath: string, outputPath: string): Promise<TextCutMediaProbe> {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height,duration",
    "-of",
    "json",
    outputPath,
  ];
  const proc = spawn(ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  proc.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  await new Promise<void>((resolvePromise, reject) => {
    proc.on("error", (error) => reject(new Error(`ffprobe spawn failed: ${error.message}`)));
    proc.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`ffprobe exited ${code}: ${stderr.slice(-800)}`));
    });
  });
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
    }>;
    format?: { duration?: string };
  };
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  const durationSeconds = Number(parsed.format?.duration ?? video?.duration ?? audio?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe did not report a valid duration for ${outputPath}`);
  }
  return {
    durationSeconds,
    hasVideo: Boolean(video),
    hasAudio: Boolean(audio),
    ...(video?.codec_name ? { videoCodec: video.codec_name } : {}),
    ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
    ...(typeof video?.width === "number" ? { width: video.width } : {}),
    ...(typeof video?.height === "number" ? { height: video.height } : {}),
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
