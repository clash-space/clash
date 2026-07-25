import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  timelineDslFromYaml,
  type ResolvedTimelineDsl,
} from "@clash/shared-types";
import { exportCaptionFile } from "./caption-export";
import {
  createTimelineSourceProvenance,
  type ProjectTimelineRevisionRef,
} from "./timeline-projection";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

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

type CaptionSourceToOutputMap = {
  sourceStartFrame: number;
  sourceEndFrame: number;
  outputStartFrame: number;
  outputEndFrame: number;
};

type CaptionBurnStats = {
  captionItems: number;
  cues: number;
  wordRefs: number;
  sourceToOutputMaps: number;
  sourceToOutputMap: CaptionSourceToOutputMap[];
};

export type ExportCaptionBurnOptions = {
  cwd: string;
  timelinePath: string;
  assetsPath?: string;
  sourceAssetId: string;
  outputAssetId: string;
  outPath?: string;
  captionSidecarPath?: string;
  packagePath?: string;
  ffmpegPlanPath?: string;
  render?: boolean;
  ffmpegPath?: string;
  timelineRevision?: ProjectTimelineRevisionRef;
};

export type ExportCaptionBurnResult = {
  exported: true;
  sourceAssetId: string;
  outputAssetId: string;
  outputPath: string;
  captionSidecarPath: string;
  packagePath: string;
  ffmpegPlanPath: string;
  assetsPath: string;
  rendered: boolean;
  cues: number;
  captionItems: number;
};

export async function exportCaptionBurn(
  options: ExportCaptionBurnOptions,
): Promise<ExportCaptionBurnResult> {
  const cwd = resolve(options.cwd);
  const assetsPath = resolveAgentOutputPath(
    cwd,
    options.assetsPath ?? join("assets", "manifest.json"),
    "Caption burn asset manifest",
  );
  const sourceTimelinePath = resolveProjectPath(cwd, options.timelinePath, "caption timeline");
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);
  const sourceAsset = requireAsset(manifest, options.sourceAssetId, assetsPath);
  const sourceAssetPath = normalizeProjectRelativePath(sourceAsset.path, `source asset ${sourceAsset.id} path`);
  const outputRelativePath = normalizeProjectRelativePath(
    options.outPath ?? join("assets", "video", `${safeFileStem(options.outputAssetId)}.mp4`),
    "caption burn output path",
  );
  const captionSidecarRelativePath = normalizeProjectRelativePath(
    options.captionSidecarPath ?? join("exports", "captions", `${safeFileStem(options.outputAssetId)}.burn-in.ass`),
    "caption burn sidecar path",
  );
  const packageRelativePath = normalizeProjectRelativePath(
    options.packagePath ?? join("projections", "caption-burn", `${safeFileStem(options.outputAssetId)}.caption-burn.json`),
    "caption burn package path",
  );
  const ffmpegPlanRelativePath = normalizeProjectRelativePath(
    options.ffmpegPlanPath ?? join("projections", "caption-burn", `${safeFileStem(options.outputAssetId)}.ffmpeg-plan.json`),
    "caption burn ffmpeg plan path",
  );

  const parsed = timelineDslFromYaml(await readFile(sourceTimelinePath, "utf8"));
  if (!parsed.ok) {
    throw new Error(`Invalid caption timeline YAML: ${parsed.error}`);
  }
  const stats = collectCaptionBurnStats(parsed.dsl);
  if (stats.captionItems === 0 || stats.cues === 0) {
    throw new Error("Caption burn export requires structured type: text items with cues on a subtitle track.");
  }
  const timelineProvenance = createTimelineSourceProvenance({
    cwd,
    filePath: sourceTimelinePath,
    dsl: parsed.dsl,
    timelineRevision: options.timelineRevision,
  });

  const captionSidecarPath = resolveAgentOutputPath(cwd, captionSidecarRelativePath, "Caption burn sidecar");
  const outputPath = resolveAgentOutputPath(cwd, outputRelativePath, "Caption burn output");
  const ffmpegPlanPath = resolveAgentOutputPath(cwd, ffmpegPlanRelativePath, "Caption burn ffmpeg plan");
  const packagePath = resolveAgentOutputPath(cwd, packageRelativePath, "Caption burn package");
  await exportCaptionFile({
    cwd,
    timelinePath: toProjectRelativePath(cwd, sourceTimelinePath),
    outPath: captionSidecarRelativePath,
    format: "ass",
    timelineRevision: options.timelineRevision,
  });

  const sourceAbsolutePath = resolveProjectPath(cwd, sourceAssetPath, `source asset ${sourceAsset.id} path`);
  const filtergraph = `ass=${escapeFfmpegFilterPath(captionSidecarPath)}`;
  const ffmpeg = options.ffmpegPath ?? process.env.CLASH_FFMPEG_PATH ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const ffmpegArgs = [
    "-y",
    "-i",
    sourceAbsolutePath,
    "-vf",
    filtergraph,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "copy",
    outputPath,
  ];
  await writeJson(ffmpegPlanPath, {
    kind: "clash.caption.burn-in.ffmpeg-plan",
    version: 1,
    sourceAssetId: options.sourceAssetId,
    outputAssetId: options.outputAssetId,
    ...timelineProvenance,
    sourcePath: sourceAssetPath,
    captionSidecarPath: captionSidecarRelativePath,
    outputPath: outputRelativePath,
    ffmpeg,
    args: ffmpegArgs,
    filtergraph,
  });

  const shouldRender = options.render === true;
  if (shouldRender) {
    await mkdir(dirname(outputPath), { recursive: true });
    await runFfmpeg(ffmpeg, ffmpegArgs);
  }

  await writeJson(packagePath, {
    schemaVersion: 1,
    kind: "clash.caption.burn-in-export",
    sourceAssetId: options.sourceAssetId,
    outputAssetId: options.outputAssetId,
    ...timelineProvenance,
    sourcePath: sourceAssetPath,
    captionSidecarPath: captionSidecarRelativePath,
    packagePath: packageRelativePath,
    ffmpegPlanPath: ffmpegPlanRelativePath,
    outputPath: outputRelativePath,
    rendered: shouldRender,
    renderMode: shouldRender ? "ffmpeg-ass-burn-in" : "plan-only",
    derivation: {
      kind: "caption-burn",
      sourceAssetId: options.sourceAssetId,
      derivedAssetId: options.outputAssetId,
      copyOnWrite: true,
    },
    captionItems: stats.captionItems,
    cues: stats.cues,
    wordRefs: stats.wordRefs,
    sourceToOutputMaps: stats.sourceToOutputMaps,
    sourceToOutputMap: stats.sourceToOutputMap,
  });

  upsertOutputAsset(manifest, {
    outputAssetId: options.outputAssetId,
    type: shouldRender ? "video" : "caption-burn-plan",
    path: shouldRender ? outputRelativePath : packageRelativePath,
    metadata: {
      "caption.burn-in-export": {
        sourceAssetId: options.sourceAssetId,
        ...timelineProvenance,
        captionSidecarPath: captionSidecarRelativePath,
        packagePath: packageRelativePath,
        ffmpegPlanPath: ffmpegPlanRelativePath,
        outputPath: outputRelativePath,
        rendered: shouldRender,
        derivationKind: "caption-burn",
        copyOnWrite: true,
        cues: stats.cues,
        captionItems: stats.captionItems,
        wordRefs: stats.wordRefs,
        sourceToOutputMaps: stats.sourceToOutputMaps,
      },
    },
  });
  await writeJson(assetsPath, manifest);

  return {
    exported: true,
    sourceAssetId: options.sourceAssetId,
    outputAssetId: options.outputAssetId,
    outputPath,
    captionSidecarPath,
    packagePath,
    ffmpegPlanPath,
    assetsPath,
    rendered: shouldRender,
    cues: stats.cues,
    captionItems: stats.captionItems,
  };
}

function collectCaptionBurnStats(dsl: ResolvedTimelineDsl): CaptionBurnStats {
  const stats: CaptionBurnStats = {
    captionItems: 0,
    cues: 0,
    wordRefs: 0,
    sourceToOutputMaps: 0,
    sourceToOutputMap: [],
  };
  for (const track of dsl.tracks) {
    if (track.role !== "subtitle") continue;
    for (const item of track.items) {
      if (item.type !== "text") continue;
      stats.captionItems += 1;
      stats.cues += Array.isArray(item.cues) ? item.cues.length : 0;
      stats.wordRefs += Array.isArray(item.wordRefs) ? item.wordRefs.length : 0;
      const maps = Array.isArray(item.sourceToOutputMap) ? item.sourceToOutputMap : [];
      for (const map of maps) {
        if (!map || typeof map !== "object") continue;
        const record = map as Record<string, unknown>;
        if (
          typeof record.sourceStartFrame === "number" &&
          typeof record.sourceEndFrame === "number" &&
          typeof record.outputStartFrame === "number" &&
          typeof record.outputEndFrame === "number"
        ) {
          stats.sourceToOutputMap.push({
            sourceStartFrame: record.sourceStartFrame,
            sourceEndFrame: record.sourceEndFrame,
            outputStartFrame: record.outputStartFrame,
            outputEndFrame: record.outputEndFrame,
          });
        }
      }
      stats.sourceToOutputMaps += maps.length;
    }
  }
  return stats;
}

function requireAsset(
  manifest: ProductionAssetManifest,
  assetId: string,
  assetsPath: string,
): ProductionAssetManifestAsset {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (!asset) {
    throw new Error(`Asset ${assetId} not found in ${assetsPath}`);
  }
  return asset;
}

function upsertOutputAsset(
  manifest: ProductionAssetManifest,
  input: {
    outputAssetId: string;
    type: string;
    path: string;
    metadata: Record<string, unknown>;
  },
): void {
  const existingIndex = manifest.assets.findIndex((asset) => asset.id === input.outputAssetId);
  if (existingIndex >= 0) {
    const existing = manifest.assets[existingIndex];
    manifest.assets[existingIndex] = {
      ...existing,
      type: input.type,
      path: input.path,
      metadata: {
        ...(existing.metadata ?? {}),
        ...input.metadata,
      },
    };
    return;
  }
  manifest.assets.push({
    id: input.outputAssetId,
    type: input.type,
    path: input.path,
    metadata: input.metadata,
  });
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

function normalizeProjectRelativePath(path: unknown, label: string): string {
  if (typeof path !== "string" || !path.trim()) {
    throw new Error(`${label} is required`);
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} must be a local project path, not a URL`);
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

function resolveAgentOutputPath(cwd: string, rawPath: string, writeVerb: string): string {
  return resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(cwd, rawPath, writeVerb),
    writeVerb,
  });
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toProjectRelativePath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function escapeFfmpegFilterPath(path: string): string {
  return path.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`ffmpeg caption burn failed with exit code ${code}: ${stderr.trim()}`));
      }
    });
  });
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

function safeFileStem(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "caption-burn";
}
