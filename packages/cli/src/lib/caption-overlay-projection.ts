import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  timelineDslFromYaml,
  timelineDslToYaml,
  type ResolvedItem,
  type ResolvedTimelineDsl,
} from "@clash/shared-types";
import { timelineProjectionCasApply } from "./timeline-projection";

export type ProjectCaptionOverlayOptions = {
  cwd: string;
  timelinePath: string;
  outPath: string;
  manifestPath?: string;
};

export type ProjectCaptionOverlayResult = {
  projected: true;
  sourceTimelinePath: string;
  timelineProjectionPath: string;
  manifestPath: string;
  captionItems: number;
  cues: number;
};

type CaptionProjectionStats = {
  captionItems: number;
  cues: number;
  wordRefs: number;
  sourceToOutputMaps: number;
};

export async function projectCaptionOverlayTimeline(
  options: ProjectCaptionOverlayOptions,
): Promise<ProjectCaptionOverlayResult> {
  const cwd = resolve(options.cwd);
  const sourceTimelinePath = resolveProjectPath(cwd, options.timelinePath, "source timeline");
  const timelineProjectionPath = resolveProjectPath(cwd, options.outPath, "caption overlay timeline");
  const manifestPath = resolveProjectPath(
    cwd,
    options.manifestPath ?? defaultManifestPath(timelineProjectionPath),
    "caption overlay manifest",
  );
  const parsed = timelineDslFromYaml(await readFile(sourceTimelinePath, "utf8"));
  if (!parsed.ok) {
    throw new Error(`Invalid timeline YAML: ${parsed.error}`);
  }

  const projection = buildCaptionOnlyTimeline(parsed.dsl);
  if (projection.stats.captionItems === 0) {
    throw new Error("Caption overlay projection requires structured type: text items on a subtitle track");
  }

  const { casApply } = timelineProjectionCasApply({
    cwd,
    filePath: timelineProjectionPath,
  });
  await writeText(timelineProjectionPath, timelineDslToYaml(projection.timeline));
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.caption.timeline-overlay",
    sourceTimelinePath: toProjectPath(cwd, sourceTimelinePath),
    timelineProjectionPath: toProjectPath(cwd, timelineProjectionPath),
    fps: projection.timeline.fps ?? 30,
    dimensions: {
      width: projection.timeline.compositionWidth ?? 1080,
      height: projection.timeline.compositionHeight ?? 1920,
    },
    timelineItems: projection.timeline.tracks.flatMap((track) => track.items),
    rendering: {
      previewRenderer: "remotion-components.caption",
      sidecarFormats: ["srt", "vtt", "ass"],
      burnInRequires: "clash production export-caption-burn",
    },
    validation: {
      timelineItemType: "text",
      captionItems: projection.stats.captionItems,
      cues: projection.stats.cues,
      wordRefs: projection.stats.wordRefs,
      sourceToOutputMaps: projection.stats.sourceToOutputMaps,
      structuredCaptionOnly: true,
    },
    casApply,
  });

  return {
    projected: true,
    sourceTimelinePath,
    timelineProjectionPath,
    manifestPath,
    captionItems: projection.stats.captionItems,
    cues: projection.stats.cues,
  };
}

function buildCaptionOnlyTimeline(dsl: ResolvedTimelineDsl): {
  timeline: ResolvedTimelineDsl;
  stats: CaptionProjectionStats;
} {
  const stats: CaptionProjectionStats = {
    captionItems: 0,
    cues: 0,
    wordRefs: 0,
    sourceToOutputMaps: 0,
  };
  const tracks: ResolvedTimelineDsl["tracks"] = [];
  for (const track of dsl.tracks) {
    if (track.role !== "subtitle") continue;
    const items = track.items.filter((item): item is ResolvedItem => item.type === "text");
    const invalidItems = items.filter((item) => !hasStructuredCaptionLineage(item));
    if (invalidItems.length > 0) {
      throw new Error(
        `Caption overlay projection requires structured text items on subtitle tracks with cues, wordRefs, and sourceToOutputMap. Invalid item(s): ${invalidItems
          .map((item) => item.id)
          .join(", ")}`,
      );
    }
    for (const item of items) {
      stats.captionItems += 1;
      stats.cues += Array.isArray(item.cues) ? item.cues.length : 0;
      stats.wordRefs += Array.isArray(item.wordRefs) ? item.wordRefs.length : 0;
      stats.sourceToOutputMaps += Array.isArray(item.sourceToOutputMap) ? item.sourceToOutputMap.length : 0;
    }
    if (items.length === 0) continue;
    tracks.push({
      id: track.id,
      name: track.name ?? "Captions",
      role: "subtitle",
      items: items.map((item) => ({ ...item })),
    });
  }

  return {
    timeline: {
      compositionWidth: dsl.compositionWidth ?? 1080,
      compositionHeight: dsl.compositionHeight ?? 1920,
      fps: dsl.fps ?? 30,
      durationInFrames: dsl.durationInFrames ?? timelineEndFrame(tracks),
      tracks,
    },
    stats,
  };
}

function hasStructuredCaptionLineage(item: ResolvedItem): boolean {
  const cues = Array.isArray(item.cues) ? item.cues : [];
  const wordRefs = Array.isArray(item.wordRefs) ? item.wordRefs : [];
  const sourceToOutputMap = Array.isArray(item.sourceToOutputMap) ? item.sourceToOutputMap : [];
  if (cues.length === 0 || wordRefs.length === 0 || sourceToOutputMap.length === 0) return false;

  const wordIds = new Set<string>();
  for (const wordRef of wordRefs) {
    if (!isRecord(wordRef)) return false;
    if (typeof wordRef.id !== "string" || wordRef.id.length === 0) return false;
    if (typeof wordRef.text !== "string") return false;
    if (!isValidFrameRange(wordRef.sourceStartFrame, wordRef.sourceEndFrame)) return false;
    wordIds.add(wordRef.id);
  }

  for (const cue of cues) {
    if (!isRecord(cue)) return false;
    if (typeof cue.id !== "string" || cue.id.length === 0) return false;
    if (typeof cue.text !== "string") return false;
    if (typeof cue.startFrame !== "number" || !Number.isFinite(cue.startFrame) || cue.startFrame < 0) return false;
    if (
      typeof cue.durationInFrames !== "number" ||
      !Number.isFinite(cue.durationInFrames) ||
      cue.durationInFrames <= 0
    ) {
      return false;
    }
    if (!isValidFrameRange(cue.sourceStartFrame, cue.sourceEndFrame)) return false;
    if (!Array.isArray(cue.wordIds) || cue.wordIds.length === 0) return false;
    for (const wordId of cue.wordIds) {
      if (typeof wordId !== "string" || !wordIds.has(wordId)) return false;
    }
  }

  for (const map of sourceToOutputMap) {
    if (!isRecord(map)) return false;
    if (!isValidFrameRange(map.sourceStartFrame, map.sourceEndFrame)) return false;
    if (!isValidFrameRange(map.outputStartFrame, map.outputEndFrame)) return false;
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidFrameRange(start: unknown, end: unknown): boolean {
  return (
    typeof start === "number" &&
    Number.isFinite(start) &&
    start >= 0 &&
    typeof end === "number" &&
    Number.isFinite(end) &&
    end > start
  );
}

function timelineEndFrame(tracks: ResolvedTimelineDsl["tracks"]): number {
  let max = 0;
  for (const track of tracks) {
    for (const item of track.items) {
      max = Math.max(max, item.from + item.durationInFrames);
    }
  }
  return max;
}

function defaultManifestPath(timelineProjectionPath: string): string {
  const ext = extname(timelineProjectionPath);
  const base = basename(timelineProjectionPath, ext);
  return join(dirname(timelineProjectionPath), `${base}-manifest.json`);
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
