import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  timelineDslFromYaml,
  type ResolvedItem,
  type ResolvedTimelineDsl,
  type ResolvedTrack,
} from "@clash/shared-types";

export type CaptionLineageVerificationOptions = {
  cwd: string;
  timelinePath: string;
  outPath?: string;
};

export type CaptionLineageVerificationCheck = {
  id:
    | "timeline.valid-structured-caption"
    | "caption.items-present"
    | "caption.wordrefs-present"
    | "caption.source-map-present"
    | "caption.cues-covered-by-lineage";
  label: string;
  required: true;
  status: "pass" | "fail";
  expected: string;
  actual: string;
};

export type CaptionLineageVerificationReport = {
  schemaVersion: 1;
  kind: "clash.caption.lineage-verification";
  status: "pass" | "blocked";
  sourceTimelinePath: string;
  captionItems: number;
  cues: number;
  wordRefs: number;
  sourceToOutputMaps: number;
  tracks: Array<{
    trackId: string;
    itemIds: string[];
    cueIds: string[];
  }>;
  checks: CaptionLineageVerificationCheck[];
  blockedReasons: string[];
};

export type CaptionLineageVerificationResult = {
  status: "pass" | "blocked";
  reportPath: string;
  captionItems: number;
  cues: number;
  wordRefs: number;
  sourceToOutputMaps: number;
  blockedReasons: string[];
};

type CaptionStats = {
  captionItems: number;
  cues: number;
  wordRefs: number;
  sourceToOutputMaps: number;
  tracks: CaptionLineageVerificationReport["tracks"];
};

export async function verifyCaptionLineage(
  options: CaptionLineageVerificationOptions,
): Promise<CaptionLineageVerificationResult> {
  const cwd = resolve(options.cwd);
  const timelinePath = resolveProjectPath(cwd, options.timelinePath, "caption timeline");
  const reportPath = resolveProjectPath(
    cwd,
    options.outPath ?? join("qa", "captions", `${basenameWithoutTimeline(timelinePath)}.caption-lineage.json`),
    "caption lineage verification report",
  );
  const parsed = timelineDslFromYaml(await readFile(timelinePath, "utf8"));
  const stats = parsed.ok ? collectCaptionStats(parsed.dsl) : emptyStats();
  const checks = buildChecks(parsed, stats);
  const blockedReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.actual}`);
  const report: CaptionLineageVerificationReport = {
    schemaVersion: 1,
    kind: "clash.caption.lineage-verification",
    status: blockedReasons.length === 0 ? "pass" : "blocked",
    sourceTimelinePath: toProjectPath(cwd, timelinePath),
    captionItems: stats.captionItems,
    cues: stats.cues,
    wordRefs: stats.wordRefs,
    sourceToOutputMaps: stats.sourceToOutputMaps,
    tracks: stats.tracks,
    checks,
    blockedReasons,
  };
  await writeJson(reportPath, report);
  return {
    status: report.status,
    reportPath,
    captionItems: report.captionItems,
    cues: report.cues,
    wordRefs: report.wordRefs,
    sourceToOutputMaps: report.sourceToOutputMaps,
    blockedReasons: report.blockedReasons,
  };
}

function buildChecks(
  parsed: ReturnType<typeof timelineDslFromYaml>,
  stats: CaptionStats,
): CaptionLineageVerificationCheck[] {
  const validStructuredCaption = parsed.ok;
  return [
    check({
      id: "timeline.valid-structured-caption",
      label: "Timeline validates structured caption items",
      pass: validStructuredCaption,
      expected: "timeline YAML parses and subtitle tracks contain only structured caption items",
      actual: parsed.ok ? "timeline parser accepted structured caption lineage" : parsed.error,
    }),
    check({
      id: "caption.items-present",
      label: "Caption items are present",
      pass: validStructuredCaption && stats.captionItems > 0,
      expected: "at least one type: caption timeline item",
      actual: `${stats.captionItems} caption item(s)`,
    }),
    check({
      id: "caption.wordrefs-present",
      label: "Caption word references are present",
      pass: validStructuredCaption && stats.wordRefs > 0,
      expected: "caption items include source word references",
      actual: `${stats.wordRefs} word reference(s)`,
    }),
    check({
      id: "caption.source-map-present",
      label: "Caption source-to-output maps are present",
      pass: validStructuredCaption && stats.sourceToOutputMaps > 0,
      expected: "caption items include source-to-output frame maps",
      actual: `${stats.sourceToOutputMaps} source-to-output map(s)`,
    }),
    check({
      id: "caption.cues-covered-by-lineage",
      label: "Caption cues are covered by word refs and source maps",
      pass: validStructuredCaption && stats.cues > 0,
      expected: "each cue references known wordRefs and is covered by sourceToOutputMap",
      actual: validStructuredCaption ? `${stats.cues} cue(s) covered by validated lineage` : "timeline validation failed",
    }),
  ];
}

function collectCaptionStats(dsl: ResolvedTimelineDsl): CaptionStats {
  const stats = emptyStats();
  for (const track of dsl.tracks) {
    const captionItems = track.items.filter((item): item is ResolvedItem => item.type === "caption");
    if (captionItems.length === 0) continue;
    const trackStats = { trackId: track.id, itemIds: [] as string[], cueIds: [] as string[] };
    for (const item of captionItems) {
      const cues = readArray(item, "cues");
      const wordRefs = readArray(item, "wordRefs");
      const sourceToOutputMap = readArray(item, "sourceToOutputMap");
      stats.captionItems += 1;
      stats.cues += cues.length;
      stats.wordRefs += wordRefs.length;
      stats.sourceToOutputMaps += sourceToOutputMap.length;
      trackStats.itemIds.push(item.id);
      trackStats.cueIds.push(...cues.map((cue, index) => readCueId(cue, index)));
    }
    stats.tracks.push(trackStats);
  }
  return stats;
}

function readArray(item: ResolvedItem, key: "cues" | "wordRefs" | "sourceToOutputMap"): unknown[] {
  const value = item[key];
  return Array.isArray(value) ? value : [];
}

function readCueId(cue: unknown, index: number): string {
  if (cue && typeof cue === "object" && !Array.isArray(cue)) {
    const id = (cue as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return `cue-${index + 1}`;
}

function emptyStats(): CaptionStats {
  return {
    captionItems: 0,
    cues: 0,
    wordRefs: 0,
    sourceToOutputMaps: 0,
    tracks: [],
  };
}

function check(options: Omit<CaptionLineageVerificationCheck, "required" | "status"> & { pass: boolean }): CaptionLineageVerificationCheck {
  return {
    id: options.id,
    label: options.label,
    required: true,
    status: options.pass ? "pass" : "fail",
    expected: options.expected,
    actual: options.actual,
  };
}

function basenameWithoutTimeline(path: string): string {
  return path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.ya?ml$/i, "")
    .replace(/\.timeline$/i, "") ?? "caption";
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
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
