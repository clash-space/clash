import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AssetMetadataFillActionSchema,
  type AudioBeatMetadata,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type MvBeatSyncVerificationOptions = {
  cwd: string;
  actionPath: string;
  projectionPath?: string;
  outPath?: string;
};

export type MvBeatSyncVerificationCheck = {
  id:
    | "audio.beat-analysis-present"
    | "beat.downbeats-present"
    | "sections.present"
    | "sections.cut-density-present"
    | "sections.review-confidence-present"
    | "projection.cas-fresh-pull"
    | "projection.sections-covered"
    | "projection.cut-density-propagated";
  label: string;
  required: true;
  status: "pass" | "fail";
  expected: string;
  actual: string;
};

export type MvBeatSyncVerificationReport = {
  schemaVersion: 1;
  kind: "clash.mv.beat-sync-verification";
  status: "pass" | "blocked";
  targetAssetId: string;
  sourceActionPath: string;
  projectionPath?: string;
  timelineProjectionPath?: string;
  bpm: number;
  fps: number;
  beats: number;
  downbeats: number;
  sections: number;
  cutAssignments: number;
  sectionCoverage: Array<{
    sectionId: string;
    covered: boolean;
    cutDensity?: "hold" | "medium" | "fast";
    projectedCutDensity?: unknown;
  }>;
  checks: MvBeatSyncVerificationCheck[];
  blockedReasons: string[];
};

export type MvBeatSyncVerificationResult = {
  status: "pass" | "blocked";
  targetAssetId: string;
  reportPath: string;
  beats: number;
  downbeats: number;
  sections: number;
  cutAssignments: number;
  blockedReasons: string[];
};

type BeatCutProjectionManifest = {
  kind?: unknown;
  targetAssetId?: unknown;
  sourceActionPath?: unknown;
  cutAssignments?: unknown;
  timelineItems?: unknown;
  casApply?: unknown;
};

type CutAssignment = {
  sectionId?: unknown;
  cutDensity?: unknown;
  recommendedCutEveryFrames?: unknown;
};

export async function verifyMvBeatSync(
  options: MvBeatSyncVerificationOptions,
): Promise<MvBeatSyncVerificationResult> {
  const cwd = resolve(options.cwd);
  const actionPath = resolveProjectPath(cwd, options.actionPath, "MV beat action");
  const action = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(actionPath, "utf8")));
  if (action.metadata.kind !== "audio.beat-analysis") {
    throw new Error(`Expected audio.beat-analysis action, got ${action.metadata.kind}`);
  }
  const metadata = action.metadata;
  const projection = options.projectionPath
    ? await readProjectionManifest(cwd, options.projectionPath)
    : undefined;
  const stats = collectStats(metadata, projection?.manifest);
  const checks = buildChecks({
    targetAssetId: action.targetAssetId,
    metadata,
    projection: projection?.manifest,
    stats,
  });
  const blockedReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.actual}`);
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("qa", "mv", `${safeSlug(action.targetAssetId)}.beat-sync-verification.json`),
      "MV beat sync verification report",
    ),
    writeVerb: "MV beat sync verification report",
  });
  const report: MvBeatSyncVerificationReport = {
    schemaVersion: 1,
    kind: "clash.mv.beat-sync-verification",
    status: blockedReasons.length === 0 ? "pass" : "blocked",
    targetAssetId: action.targetAssetId,
    sourceActionPath: toProjectPath(cwd, actionPath),
    ...(projection ? { projectionPath: toProjectPath(cwd, projection.path) } : {}),
    ...(stats.timelineProjectionPath ? { timelineProjectionPath: stats.timelineProjectionPath } : {}),
    bpm: metadata.bpm,
    fps: metadata.fps,
    beats: metadata.beats.length,
    downbeats: stats.downbeats,
    sections: metadata.sections.length,
    cutAssignments: stats.cutAssignments.length,
    sectionCoverage: stats.sectionCoverage,
    checks,
    blockedReasons,
  };
  await writeJson(reportPath, report);
  return {
    status: report.status,
    targetAssetId: report.targetAssetId,
    reportPath,
    beats: report.beats,
    downbeats: report.downbeats,
    sections: report.sections,
    cutAssignments: report.cutAssignments,
    blockedReasons: report.blockedReasons,
  };
}

function collectStats(
  metadata: AudioBeatMetadata,
  projection: BeatCutProjectionManifest | undefined,
): {
  downbeats: number;
  cutAssignments: CutAssignment[];
  timelineProjectionPath?: string;
  sectionCoverage: MvBeatSyncVerificationReport["sectionCoverage"];
} {
  const cutAssignments = readArray(projection?.cutAssignments) as CutAssignment[];
  const assignmentBySection = new Map<string, CutAssignment>();
  for (const assignment of cutAssignments) {
    if (assignment && typeof assignment === "object" && typeof assignment.sectionId === "string") {
      assignmentBySection.set(assignment.sectionId, assignment);
    }
  }
  const casApply = readRecord(projection?.casApply);
  const timelineProjectionPath = typeof casApply.filePath === "string" ? casApply.filePath : undefined;
  return {
    downbeats: metadata.beats.filter((beat) => beat.downbeat === true).length,
    cutAssignments,
    timelineProjectionPath,
    sectionCoverage: metadata.sections.map((section) => {
      const assignment = assignmentBySection.get(section.id);
      return {
        sectionId: section.id,
        covered: assignment !== undefined,
        ...(section.cutDensity === undefined ? {} : { cutDensity: section.cutDensity }),
        ...(assignment === undefined ? {} : { projectedCutDensity: assignment.cutDensity }),
      };
    }),
  };
}

function buildChecks(options: {
  targetAssetId: string;
  metadata: AudioBeatMetadata;
  projection: BeatCutProjectionManifest | undefined;
  stats: ReturnType<typeof collectStats>;
}): MvBeatSyncVerificationCheck[] {
  const { targetAssetId, metadata, projection, stats } = options;
  const missingCutDensity = metadata.sections.filter((section) => section.cutDensity === undefined);
  const missingReviewConfidence = metadata.sections.filter(
    (section) => section.semanticConfidence === undefined || section.reviewRequired === undefined,
  );
  const uncoveredSections = stats.sectionCoverage.filter((section) => !section.covered);
  const mismatchedDensity = stats.sectionCoverage.filter(
    (section) => section.covered && section.cutDensity !== undefined && section.projectedCutDensity !== section.cutDensity,
  );
  const casApply = readRecord(projection?.casApply);
  const hasFreshPullCas =
    projection !== undefined &&
    projection.kind === "clash.mv.beat-cut.timeline-projection" &&
    projection.targetAssetId === targetAssetId &&
    casApply.target === "timeline" &&
    casApply.mutation === "projection-only" &&
    casApply.applyCommand === "clash timeline apply" &&
    casApply.lockPath === "timelines/main.timeline.lock.json" &&
    casApply.lockSource === "fresh-canvas-pull" &&
    casApply.nodeIdPlaceholder === "<video-editor-node-id>" &&
    casApply.pullCommand === "clash timeline pull" &&
    Array.isArray(casApply.requiredRuntimeArgs) &&
    casApply.requiredRuntimeArgs.includes("--node <video-editor-node-id>");

  return [
    check({
      id: "audio.beat-analysis-present",
      label: "Audio beat metadata action is present",
      pass: true,
      expected: "AssetMetadataFillAction metadata.kind is audio.beat-analysis",
      actual: "audio.beat-analysis action parsed",
    }),
    check({
      id: "beat.downbeats-present",
      label: "Beat grid includes downbeat anchors",
      pass: stats.downbeats > 0,
      expected: "at least one beat has downbeat: true",
      actual: `${stats.downbeats} downbeat(s) across ${metadata.beats.length} beat(s)`,
    }),
    check({
      id: "sections.present",
      label: "Beat sections are present",
      pass: metadata.sections.length > 0,
      expected: "at least one beat section",
      actual: `${metadata.sections.length} section(s)`,
    }),
    check({
      id: "sections.cut-density-present",
      label: "Beat sections include cut-density hints",
      pass: metadata.sections.length > 0 && missingCutDensity.length === 0,
      expected: "every section has cutDensity",
      actual: missingCutDensity.length === 0
        ? "all sections have cutDensity"
        : `missing cutDensity on ${missingCutDensity.map((section) => section.id).join(", ")}`,
    }),
    check({
      id: "sections.review-confidence-present",
      label: "Beat sections include review confidence metadata",
      pass: metadata.sections.length > 0 && missingReviewConfidence.length === 0,
      expected: "every section has semanticConfidence and reviewRequired",
      actual: missingReviewConfidence.length === 0
        ? "all sections have semantic confidence and review flags"
        : `missing review confidence on ${missingReviewConfidence.map((section) => section.id).join(", ")}`,
    }),
    check({
      id: "projection.cas-fresh-pull",
      label: "MV timeline projection declares fresh-pull CAS apply",
      pass: hasFreshPullCas,
      expected: "projection manifest has fresh-canvas-pull CAS with explicit --node arg",
      actual: hasFreshPullCas ? "fresh-pull CAS present" : "fresh-pull CAS missing or target mismatch",
    }),
    check({
      id: "projection.sections-covered",
      label: "MV projection covers all beat sections",
      pass: projection !== undefined && metadata.sections.length > 0 && uncoveredSections.length === 0,
      expected: "every beat section id appears in cutAssignments",
      actual: uncoveredSections.length === 0
        ? `${metadata.sections.length} section(s) covered`
        : `uncovered section(s): ${uncoveredSections.map((section) => section.sectionId).join(", ")}`,
    }),
    check({
      id: "projection.cut-density-propagated",
      label: "MV projection propagates section cut density",
      pass: projection !== undefined && metadata.sections.length > 0 && mismatchedDensity.length === 0,
      expected: "cutAssignments preserve each section cutDensity",
      actual: mismatchedDensity.length === 0
        ? "cutDensity propagated to assignments"
        : `cutDensity mismatch on ${mismatchedDensity.map((section) => section.sectionId).join(", ")}`,
    }),
  ];
}

async function readProjectionManifest(
  cwd: string,
  projectionPath: string,
): Promise<{ path: string; manifest: BeatCutProjectionManifest }> {
  const path = resolveProjectPath(cwd, projectionPath, "MV beat projection manifest");
  return {
    path,
    manifest: JSON.parse(await readFile(path, "utf8")) as BeatCutProjectionManifest,
  };
}

function check(
  options: Omit<MvBeatSyncVerificationCheck, "required" | "status"> & { pass: boolean },
): MvBeatSyncVerificationCheck {
  return {
    id: options.id,
    label: options.label,
    required: true,
    status: options.pass ? "pass" : "fail",
    expected: options.expected,
    actual: options.actual,
  };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "mv";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
