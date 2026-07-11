import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AssetMetadataFillActionSchema,
  buildBeatSectionCutPlan,
  timelineDslToYaml,
  type AudioBeatMetadata,
} from "@clash/shared-types";
import { timelineProjectionCasApply } from "./timeline-projection";

export type MvBeatVisualClip = {
  assetId: string;
  type: "video" | "image";
  path: string;
  sourceStartFrame?: number;
};

export type ProjectMvBeatCutsOptions = {
  cwd: string;
  actionPath: string;
  audioSrc: string;
  clips: MvBeatVisualClip[];
  assetsPath?: string;
};

export type ProjectMvBeatCutsResult = {
  projected: true;
  targetAssetId: string;
  timelineProjectionPath: string;
  manifestPath: string;
  cuts: number;
};

export async function projectMvBeatCutsTimeline(
  options: ProjectMvBeatCutsOptions,
): Promise<ProjectMvBeatCutsResult> {
  const cwd = resolve(options.cwd);
  const actionPath = resolveProjectPath(cwd, options.actionPath, "action");
  const action = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(actionPath, "utf8")));
  if (action.metadata.kind !== "audio.beat-analysis") {
    throw new Error(`Expected audio.beat-analysis action, got ${action.metadata.kind}`);
  }
  if (options.clips.length === 0) {
    throw new Error("At least one MV visual clip is required");
  }

  const metadata = action.metadata;
  const audioSrc = normalizeAssetPath(options.audioSrc, "audio source");
  const clips = options.clips.map((clip, index) => normalizeClip(clip, index));
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);
  assertRegisteredMvAssets({
    manifest,
    targetAssetId: action.targetAssetId,
    audioSrc,
    clips,
    assetsPath,
  });
  const cuts = buildBeatSectionCutPlan(metadata);
  const assignments = cuts.map((cut, index) => {
    const clip = clips[index % clips.length];
    return {
      ...cut,
      clipAssetId: clip.assetId,
      clipType: clip.type,
      clipPath: clip.path,
      sourceStartFrame: clip.sourceStartFrame,
    };
  });

  const timelineProjectionPath = join(
    cwd,
    "projections",
    "timelines",
    `${safeSlug(action.targetAssetId)}.mv-beat-cut.timeline.yaml`,
  );
  const { casApply } = timelineProjectionCasApply({
    cwd,
    filePath: timelineProjectionPath,
  });
  const manifestPath = join(
    dirname(timelineProjectionPath),
    `${basename(timelineProjectionPath, ".yaml")}-manifest.json`,
  );
  const timelineItems = assignments.map((assignment) => ({
    id: `mv-cut-${safeSlug(assignment.sectionId)}`,
    type: assignment.clipType,
    from: assignment.outputStartFrame,
    durationInFrames: Math.max(1, assignment.outputEndFrame - assignment.outputStartFrame),
    assetId: assignment.clipAssetId,
    src: assignment.clipPath,
    ...(assignment.sourceStartFrame === undefined ? {} : { sourceStartInFrames: assignment.sourceStartFrame }),
    beatSectionId: assignment.sectionId,
    ...(assignment.semanticLabel === undefined ? {} : { semanticLabel: assignment.semanticLabel }),
    ...(assignment.semanticConfidence === undefined ? {} : { semanticConfidence: assignment.semanticConfidence }),
    ...(assignment.reviewRequired === undefined ? {} : { reviewRequired: assignment.reviewRequired }),
    ...(assignment.semanticSource === undefined ? {} : { semanticSource: assignment.semanticSource }),
    cutDensity: assignment.cutDensity,
    anchorFrames: assignment.anchorFrames,
  }));
  const durationInFrames = timelineDuration(metadata, cuts);
  const timeline = {
    compositionWidth: 1080,
    compositionHeight: 1920,
    fps: metadata.fps,
    durationInFrames,
    tracks: [
      {
        id: "mv-cuts",
        name: "MV Beat Cuts",
        role: "primary-video",
        items: timelineItems,
      },
      {
        id: "music",
        name: "Music",
        role: "music",
        items: [{
          id: `${action.targetAssetId}-music`,
          type: "audio",
          from: 0,
          durationInFrames,
          assetId: action.targetAssetId,
          src: audioSrc,
        }],
      },
    ],
  };

  await writeText(timelineProjectionPath, timelineDslToYaml(timeline as any));
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.mv.beat-cut.timeline-projection",
    targetAssetId: action.targetAssetId,
    sourceActionPath: toProjectPath(cwd, actionPath),
    metadataKind: action.metadataKind,
    bpm: metadata.bpm,
    fps: metadata.fps,
    beats: metadata.beats.length,
    sections: metadata.sections.length,
    cutAssignments: assignments.map((assignment) => ({
      sectionId: assignment.sectionId,
      label: assignment.label,
      clipAssetId: assignment.clipAssetId,
      clipPath: assignment.clipPath,
      clipType: assignment.clipType,
      outputStartFrame: assignment.outputStartFrame,
      outputEndFrame: assignment.outputEndFrame,
      anchorFrames: assignment.anchorFrames,
      semanticLabel: assignment.semanticLabel,
      semanticConfidence: assignment.semanticConfidence,
      reviewRequired: assignment.reviewRequired,
      semanticSource: assignment.semanticSource,
      cutDensity: assignment.cutDensity,
      recommendedCutEveryFrames: assignment.recommendedCutEveryFrames,
    })),
    timelineItems,
    casApply,
  });

  return {
    projected: true,
    targetAssetId: action.targetAssetId,
    timelineProjectionPath,
    manifestPath,
    cuts: cuts.length,
  };
}

type ProductionAssetManifestAsset = {
  id: string;
  type?: string;
  path?: string;
  [key: string]: unknown;
};

type ProductionAssetManifest = {
  assets: ProductionAssetManifestAsset[];
  [key: string]: unknown;
};

function parseAssetManifest(raw: string, path: string): ProductionAssetManifest {
  const parsed = JSON.parse(raw) as Partial<ProductionAssetManifest>;
  if (!Array.isArray(parsed.assets)) {
    throw new Error(`Invalid asset manifest at ${path}: expected assets array`);
  }
  return { ...parsed, assets: parsed.assets } as ProductionAssetManifest;
}

function assertRegisteredMvAssets(options: {
  manifest: ProductionAssetManifest;
  targetAssetId: string;
  audioSrc: string;
  clips: MvBeatVisualClip[];
  assetsPath: string;
}): void {
  const byId = new Map(options.manifest.assets.map((asset) => [asset.id, asset]));
  const target = byId.get(options.targetAssetId);
  if (!target) {
    throw new Error(`MV audio asset ${options.targetAssetId} is not registered in ${toProjectDisplayPath(options.assetsPath)}`);
  }
  if (target.path !== undefined && normalizeAssetPath(target.path, `MV audio asset ${target.id} path`) !== options.audioSrc) {
    throw new Error(`MV audio asset ${target.id} path does not match --audio-src`);
  }
  for (const clip of options.clips) {
    const asset = byId.get(clip.assetId);
    if (!asset) {
      throw new Error(`MV clip asset ${clip.assetId} is not registered in ${toProjectDisplayPath(options.assetsPath)}`);
    }
    if (asset.path !== undefined && normalizeAssetPath(asset.path, `MV clip asset ${asset.id} path`) !== clip.path) {
      throw new Error(`MV clip asset ${asset.id} path does not match clips plan`);
    }
  }
}

function timelineDuration(metadata: AudioBeatMetadata, cuts: ReturnType<typeof buildBeatSectionCutPlan>): number {
  const cutEnd = cuts.reduce((end, cut) => Math.max(end, cut.outputEndFrame), 0);
  const beatEnd = metadata.beats.reduce((end, beat) => Math.max(end, beat.frame), 0);
  const sectionEnd = metadata.sections.reduce((end, section) => Math.max(end, section.endFrame), 0);
  return Math.max(1, cutEnd, sectionEnd, beatEnd);
}

function normalizeClip(raw: MvBeatVisualClip, index: number): MvBeatVisualClip {
  if (!raw || typeof raw !== "object") {
    throw new Error(`MV clip ${index} must be an object`);
  }
  if (typeof raw.assetId !== "string" || !raw.assetId.trim()) {
    throw new Error(`MV clip ${index} assetId is required`);
  }
  if (raw.type !== "video" && raw.type !== "image") {
    throw new Error(`MV clip ${index} type must be video or image`);
  }
  if (raw.sourceStartFrame !== undefined && (!Number.isInteger(raw.sourceStartFrame) || raw.sourceStartFrame < 0)) {
    throw new Error(`MV clip ${index} sourceStartFrame must be a non-negative integer`);
  }
  return {
    assetId: raw.assetId,
    type: raw.type,
    path: normalizeAssetPath(raw.path, `MV clip ${index} path`),
    ...(raw.sourceStartFrame === undefined ? {} : { sourceStartFrame: raw.sourceStartFrame }),
  };
}

function normalizeAssetPath(path: unknown, label: string): string {
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

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function toProjectDisplayPath(path: string): string {
  const normalized = path.split(sep).join("/");
  const marker = "/assets/manifest.json";
  return normalized.endsWith(marker) ? "assets/manifest.json" : normalized;
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mv";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
