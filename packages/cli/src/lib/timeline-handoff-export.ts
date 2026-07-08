import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { timelineDslFromYaml, type ResolvedItem, type ResolvedTimelineDsl } from "@clash/shared-types";
import {
  createTimelineSourceProvenance,
  readAppliedTimelineRevisionForSource,
} from "./timeline-projection";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type TimelineHandoffFormat = "csv";

export type TimelineHandoffResult = {
  exported: true;
  format: TimelineHandoffFormat;
  outputPath: string;
  manifestPath: string;
  items: number;
};

export type ExportTimelineHandoffOptions = {
  cwd: string;
  timelinePath: string;
  outPath: string;
  manifestPath?: string;
  format?: TimelineHandoffFormat;
  fps?: number;
};

type HandoffRow = {
  trackId: string;
  itemId: string;
  type: string;
  startFrame: number;
  endFrame: number;
  startTimecode: string;
  endTimecode: string;
  durationFrames: number;
  assetId: string;
  source: string;
  notes: string;
};

export async function exportTimelineHandoff(
  options: ExportTimelineHandoffOptions,
): Promise<TimelineHandoffResult> {
  const cwd = resolve(options.cwd);
  const timelinePath = resolveProjectPath(cwd, options.timelinePath, "timeline");
  const outputPath = resolveAgentOutputPath(cwd, options.outPath, "Timeline handoff output");
  const format = options.format ?? inferTimelineHandoffFormat(outputPath);
  const manifestPath = resolveAgentOutputPath(
    cwd,
    options.manifestPath ?? defaultManifestPath(outputPath),
    "Timeline handoff manifest",
  );
  const parsed = timelineDslFromYaml(await readFile(timelinePath, "utf8"));
  if (!parsed.ok) {
    throw new Error(`Invalid timeline YAML: ${parsed.error}`);
  }
  const fps = options.fps ?? parsed.dsl.fps ?? 30;
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error("Timeline handoff export requires a positive fps from --fps or timeline fps");
  }
  const appliedRevision = await readAppliedTimelineRevisionForSource({
    cwd,
    sourceTimelinePath: timelinePath,
    dsl: parsed.dsl,
  });
  const timelineProvenance = createTimelineSourceProvenance({
    cwd,
    filePath: timelinePath,
    dsl: parsed.dsl,
    appliedRevision,
  });
  const rows = timelineRows(parsed.dsl, fps);
  await writeText(outputPath, renderCsv(rows));
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.timeline.nle-handoff",
    ...timelineProvenance,
    format,
    outputPath: toProjectPath(cwd, outputPath),
    outputs: [toProjectPath(cwd, outputPath)],
    fps,
    items: rows.length,
    tracks: parsed.dsl.tracks.length,
    itemTypes: countBy(rows.map((row) => row.type)),
    exportedAt: new Date().toISOString(),
  });

  return {
    exported: true,
    format,
    outputPath,
    manifestPath,
    items: rows.length,
  };
}

export function parseTimelineHandoffFormat(value: string): TimelineHandoffFormat {
  if (value === "csv") return value;
  throw new Error("timeline handoff format must be csv");
}

function timelineRows(dsl: ResolvedTimelineDsl, fps: number): HandoffRow[] {
  const rows: HandoffRow[] = [];
  for (const track of dsl.tracks) {
    for (const item of track.items) {
      rows.push({
        trackId: track.id,
        itemId: item.id,
        type: item.type,
        startFrame: item.from,
        endFrame: item.from + item.durationInFrames,
        startTimecode: frameToTimecode(item.from, fps),
        endTimecode: frameToTimecode(item.from + item.durationInFrames, fps),
        durationFrames: item.durationInFrames,
        assetId: readString(item.assetId),
        source: itemSource(item),
        notes: itemNotes(item),
      });
    }
  }
  return rows;
}

function itemSource(item: ResolvedItem): string {
  return readString(item.src) ||
    readString(item.sourcePath) ||
    readString(item.renderedAssetPath) ||
    readString(item.path) ||
    readString(item.outputPath);
}

function itemNotes(item: ResolvedItem): string {
  if (item.type === "caption" && Array.isArray(item.cues)) {
    return item.cues
      .map((cue) => cue && typeof cue === "object" && "text" in cue ? readString((cue as Record<string, unknown>).text) : "")
      .filter(Boolean)
      .join(" ");
  }
  if (item.type === "composition") {
    return `composition ${readString(item.compositionId)}`.trim();
  }
  if (item.type === "derived-overlay") {
    return `derived ${readString(item.derivedAssetId)}`.trim();
  }
  return readString(item.label) || readString(item.text) || "";
}

function renderCsv(rows: HandoffRow[]): string {
  const header = [
    "trackId",
    "itemId",
    "type",
    "startFrame",
    "endFrame",
    "startTimecode",
    "endTimecode",
    "durationFrames",
    "assetId",
    "source",
    "notes",
  ];
  return `${[
    header,
    ...rows.map((row) => [
      row.trackId,
      row.itemId,
      row.type,
      String(row.startFrame),
      String(row.endFrame),
      row.startTimecode,
      row.endTimecode,
      String(row.durationFrames),
      row.assetId,
      row.source,
      row.notes,
    ]),
  ].map((record) => record.map(csvCell).join(",")).join("\n")}\n`;
}

function frameToTimecode(frame: number, fps: number): string {
  const roundedFrame = Math.max(0, Math.round(frame));
  const roundedFps = Math.max(1, Math.round(fps));
  const totalSeconds = Math.floor(roundedFrame / roundedFps);
  const frames = roundedFrame % roundedFps;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}:${pad2(frames)}`;
}

function inferTimelineHandoffFormat(outputPath: string): TimelineHandoffFormat {
  if (extname(outputPath).toLowerCase() === ".csv") return "csv";
  throw new Error("Timeline handoff format must be passed with --format csv or inferred from .csv output path");
}

function defaultManifestPath(outputPath: string): string {
  const ext = extname(outputPath);
  const base = basename(outputPath, ext);
  const suffix = base.endsWith(".timeline") ? ".handoff.json" : ".timeline.handoff.json";
  return join(dirname(outputPath), `${base}${suffix}`);
}

function countBy(values: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values.sort()) {
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
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
