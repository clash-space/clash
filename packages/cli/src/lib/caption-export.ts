import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  timelineDslFromYaml,
  type ResolvedItem,
  type ResolvedTimelineDsl,
  type ResolvedTrack,
} from "@clash/shared-types";
import { createTimelineSourceProvenance } from "./timeline-projection";

export type CaptionExportFormat = "srt" | "vtt" | "ass";

export type CaptionExportResult = {
  exported: true;
  format: CaptionExportFormat;
  outputPath: string;
  manifestPath: string;
  cues: number;
  captionItems: number;
};

type ExportCaptionFileOptions = {
  cwd: string;
  timelinePath: string;
  outPath: string;
  manifestPath?: string;
  format?: CaptionExportFormat;
  fps?: number;
};

type CaptionCue = {
  id: string;
  startFrame: number;
  durationInFrames: number;
  text: string;
  wordIds: string[];
  sourceStartFrame?: number;
  sourceEndFrame?: number;
};

type CaptionEntry = CaptionCue & {
  trackId: string;
  itemId: string;
  absoluteStartFrame: number;
  absoluteEndFrame: number;
};

type CaptionSource = {
  trackId: string;
  itemId: string;
  cueIds: string[];
};

export async function exportCaptionFile(options: ExportCaptionFileOptions): Promise<CaptionExportResult> {
  const cwd = resolve(options.cwd);
  const timelinePath = resolveProjectPath(cwd, options.timelinePath, "timeline");
  const outputPath = resolveProjectPath(cwd, options.outPath, "caption output");
  const format = options.format ?? inferCaptionFormat(outputPath);
  const manifestPath = resolveProjectPath(
    cwd,
    options.manifestPath ?? defaultManifestPath(outputPath),
    "caption manifest",
  );
  const parsed = timelineDslFromYaml(await readFile(timelinePath, "utf8"));
  if (!parsed.ok) {
    throw new Error(`Invalid timeline YAML: ${parsed.error}`);
  }
  const fps = options.fps ?? parsed.dsl.fps ?? 30;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Caption export requires a positive fps from --fps or timeline fps");
  }
  const timelineProvenance = createTimelineSourceProvenance({
    cwd,
    filePath: timelinePath,
    dsl: parsed.dsl,
  });
  const captions = collectCaptionEntries(parsed.dsl);
  if (captions.entries.length === 0) {
    throw new Error("No structured caption items found. Caption export requires timeline items with type: caption.");
  }

  const content = format === "srt"
    ? renderSrt(captions.entries, fps)
    : format === "vtt"
      ? renderVtt(captions.entries, fps)
      : renderAss(captions.entries, fps, parsed.dsl.compositionWidth, parsed.dsl.compositionHeight);
  await writeText(outputPath, content);
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.caption.export",
    ...timelineProvenance,
    format,
    outputPath: toProjectPath(cwd, outputPath),
    fps,
    captionItems: captions.captionItems,
    cues: captions.entries.length,
    wordRefs: captions.wordRefs,
    sourceToOutputMaps: captions.sourceToOutputMaps,
    sources: captions.sources,
    exportedAt: new Date().toISOString(),
  });

  return {
    exported: true,
    format,
    outputPath,
    manifestPath,
    cues: captions.entries.length,
    captionItems: captions.captionItems,
  };
}

export function parseCaptionExportFormat(value: string): CaptionExportFormat {
  if (value === "srt" || value === "vtt" || value === "ass") return value;
  throw new Error("caption export format must be srt, vtt, or ass");
}

function collectCaptionEntries(dsl: ResolvedTimelineDsl): {
  entries: CaptionEntry[];
  captionItems: number;
  wordRefs: number;
  sourceToOutputMaps: number;
  sources: CaptionSource[];
} {
  const entries: CaptionEntry[] = [];
  const sources: CaptionSource[] = [];
  let captionItems = 0;
  let wordRefs = 0;
  let sourceToOutputMaps = 0;
  for (const track of dsl.tracks) {
    for (const item of track.items) {
      if (item.type !== "caption") continue;
      captionItems += 1;
      const cues = readCaptionCues(track, item);
      entries.push(...cues.map((cue) => ({
        ...cue,
        trackId: track.id,
        itemId: item.id,
        absoluteStartFrame: item.from + cue.startFrame,
        absoluteEndFrame: item.from + cue.startFrame + cue.durationInFrames,
      })));
      sources.push({
        trackId: track.id,
        itemId: item.id,
        cueIds: cues.map((cue) => cue.id),
      });
      wordRefs += Array.isArray(item.wordRefs) ? item.wordRefs.length : 0;
      sourceToOutputMaps += Array.isArray(item.sourceToOutputMap) ? item.sourceToOutputMap.length : 0;
    }
  }
  entries.sort((a, b) => a.absoluteStartFrame - b.absoluteStartFrame || a.id.localeCompare(b.id));
  return { entries, captionItems, wordRefs, sourceToOutputMaps, sources };
}

function readCaptionCues(track: ResolvedTrack, item: ResolvedItem): CaptionCue[] {
  if (!Array.isArray(item.cues)) {
    throw new Error(`Caption item ${track.id}/${item.id} must include cues`);
  }
  return item.cues.map((rawCue, index) => {
    if (!rawCue || typeof rawCue !== "object") {
      throw new Error(`Caption item ${track.id}/${item.id} cue ${index} must be an object`);
    }
    const cue = rawCue as Record<string, unknown>;
    const id = typeof cue.id === "string" && cue.id.length > 0 ? cue.id : `cue-${index + 1}`;
    const startFrame = typeof cue.startFrame === "number" && Number.isInteger(cue.startFrame)
      ? cue.startFrame
      : null;
    const durationInFrames = typeof cue.durationInFrames === "number" && Number.isInteger(cue.durationInFrames)
      ? cue.durationInFrames
      : null;
    if (startFrame === null || startFrame < 0) {
      throw new Error(`Caption cue ${id} must include a non-negative startFrame`);
    }
    if (durationInFrames === null || durationInFrames <= 0) {
      throw new Error(`Caption cue ${id} must include a positive durationInFrames`);
    }
    if (typeof cue.text !== "string" || cue.text.length === 0) {
      throw new Error(`Caption cue ${id} must include non-empty text`);
    }
    const sourceStartFrame = typeof cue.sourceStartFrame === "number" && Number.isInteger(cue.sourceStartFrame)
      ? cue.sourceStartFrame
      : null;
    const sourceEndFrame = typeof cue.sourceEndFrame === "number" && Number.isInteger(cue.sourceEndFrame)
      ? cue.sourceEndFrame
      : null;
    return {
      id,
      startFrame,
      durationInFrames,
      text: cue.text,
      wordIds: Array.isArray(cue.wordIds)
        ? cue.wordIds.filter((wordId): wordId is string => typeof wordId === "string")
        : [],
      ...(sourceStartFrame !== null ? { sourceStartFrame } : {}),
      ...(sourceEndFrame !== null ? { sourceEndFrame } : {}),
    };
  });
}

function renderSrt(entries: CaptionEntry[], fps: number): string {
  return `${entries.map((entry, index) => [
    String(index + 1),
    `${formatTimestamp(entry.absoluteStartFrame, fps, ",")} --> ${formatTimestamp(entry.absoluteEndFrame, fps, ",")}`,
    normalizeCaptionText(entry.text),
  ].join("\n")).join("\n\n")}\n`;
}

function renderVtt(entries: CaptionEntry[], fps: number): string {
  return `WEBVTT\n\n${entries.map((entry) => [
    `${formatTimestamp(entry.absoluteStartFrame, fps, ".")} --> ${formatTimestamp(entry.absoluteEndFrame, fps, ".")}`,
    normalizeCaptionText(entry.text),
  ].join("\n")).join("\n\n")}\n`;
}

function renderAss(entries: CaptionEntry[], fps: number, width = 1080, height = 1920): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    `PlayResX: ${Math.max(1, Math.round(width))}`,
    `PlayResY: ${Math.max(1, Math.round(height))}`,
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,54,&H00FFFFFF,&H000000FF,&H00111111,&H99000000,-1,0,0,0,100,100,0,0,1,3,1,2,60,60,96,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...entries.map((entry) =>
      `Dialogue: 0,${formatAssTimestamp(entry.absoluteStartFrame, fps)},${formatAssTimestamp(entry.absoluteEndFrame, fps)},Default,,0,0,0,,${escapeAssText(entry.text)}`
    ),
    "",
  ].join("\n");
}

function formatTimestamp(frame: number, fps: number, millisecondSeparator: "," | "."): string {
  const totalMs = Math.max(0, Math.round((frame / fps) * 1000));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1000);
  const milliseconds = totalMs % 1000;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}${millisecondSeparator}${pad3(milliseconds)}`;
}

function formatAssTimestamp(frame: number, fps: number): string {
  const totalCentiseconds = Math.max(0, Math.round((frame / fps) * 100));
  const hours = Math.floor(totalCentiseconds / 360_000);
  const minutes = Math.floor((totalCentiseconds % 360_000) / 6_000);
  const seconds = Math.floor((totalCentiseconds % 6_000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${pad2(minutes)}:${pad2(seconds)}.${pad2(centiseconds)}`;
}

function normalizeCaptionText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function escapeAssText(text: string): string {
  return normalizeCaptionText(text)
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/\n/g, "\\N");
}

function inferCaptionFormat(outputPath: string): CaptionExportFormat {
  const ext = extname(outputPath).toLowerCase();
  if (ext === ".srt") return "srt";
  if (ext === ".vtt") return "vtt";
  if (ext === ".ass") return "ass";
  throw new Error("Caption export format must be passed with --format or inferred from .srt/.vtt/.ass output path");
}

function defaultManifestPath(outputPath: string): string {
  const ext = extname(outputPath);
  const base = basename(outputPath, ext);
  return join(dirname(outputPath), `${base}.caption-export.json`);
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

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function pad3(value: number): string {
  return String(value).padStart(3, "0");
}
