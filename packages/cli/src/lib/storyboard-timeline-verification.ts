import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AssetMetadataFillActionSchema } from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type StoryboardTimelineVerificationOptions = {
  cwd: string;
  actionPath: string;
  manifestPath: string;
  minConsistency?: number;
  outPath?: string;
};

export type StoryboardTimelineVerificationCheck = {
  id:
    | "action.storyboard-metadata-present"
    | "manifest.cas-fresh-pull"
    | "manifest.panels-covered"
    | "manifest.timeline-items-covered"
    | "panels.consistency-threshold"
    | "panels.assets-local";
  label: string;
  required: true;
  status: "pass" | "fail";
  expected: string;
  actual: string;
};

export type StoryboardTimelinePanelCoverage = {
  panelId: string;
  assetId: string;
  coveredByPanelManifest: boolean;
  coveredByTimelineItem: boolean;
  timelineItemId?: string;
  consistencyScore?: number;
};

export type StoryboardTimelineVerificationReport = {
  schemaVersion: 1;
  kind: "clash.storyboard.timeline-verification";
  status: "pass" | "blocked";
  storyboardAssetId: string;
  sourceActionPath: string;
  manifestPath: string;
  timelineProjectionPath?: string;
  minConsistency: number;
  panels: number;
  timelineItems: number;
  lowConsistencyPanels: Array<{ panelId: string; score: number }>;
  panelCoverage: StoryboardTimelinePanelCoverage[];
  checks: StoryboardTimelineVerificationCheck[];
  blockedReasons: string[];
};

export type StoryboardTimelineVerificationResult = {
  status: "pass" | "blocked";
  storyboardAssetId: string;
  reportPath: string;
  panels: number;
  timelineItems: number;
  lowConsistencyPanels: number;
  blockedReasons: string[];
};

type StoryboardTimelineManifest = {
  kind?: unknown;
  storyboardAssetId?: unknown;
  panels?: unknown;
  timelineItems?: unknown;
  casApply?: unknown;
};

type ManifestPanel = {
  panelId?: unknown;
  assetId?: unknown;
  path?: unknown;
  consistencyScore?: unknown;
};

type ManifestTimelineItem = {
  id?: unknown;
  assetId?: unknown;
  src?: unknown;
  storyboardPanelId?: unknown;
  consistencyScore?: unknown;
};

export async function verifyStoryboardTimeline(
  options: StoryboardTimelineVerificationOptions,
): Promise<StoryboardTimelineVerificationResult> {
  const cwd = resolve(options.cwd);
  const actionPath = resolveProjectPath(cwd, options.actionPath, "storyboard action");
  const manifestPath = resolveProjectPath(cwd, options.manifestPath, "storyboard timeline manifest");
  const minConsistency = options.minConsistency ?? 0.75;
  if (!Number.isFinite(minConsistency) || minConsistency < 0 || minConsistency > 1) {
    throw new Error("min consistency must be between 0 and 1");
  }
  const action = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(actionPath, "utf8")));
  if (action.metadata.kind !== "image.storyboard-consistency") {
    throw new Error(`Expected image.storyboard-consistency action, got ${action.metadata.kind}`);
  }
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as StoryboardTimelineManifest;
  const stats = collectStats({
    actionPanels: action.metadata.panels,
    manifest,
    minConsistency,
  });
  const checks = buildChecks({
    storyboardAssetId: action.targetAssetId,
    manifest,
    stats,
  });
  const blockedReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.actual}`);
  const casApply = readRecord(manifest.casApply);
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("qa", "storyboards", `${safeSlug(action.targetAssetId)}.timeline-verification.json`),
      "storyboard timeline verification report",
    ),
    writeVerb: "Storyboard timeline verification report",
  });
  const report: StoryboardTimelineVerificationReport = {
    schemaVersion: 1,
    kind: "clash.storyboard.timeline-verification",
    status: blockedReasons.length === 0 ? "pass" : "blocked",
    storyboardAssetId: action.targetAssetId,
    sourceActionPath: toProjectPath(cwd, actionPath),
    manifestPath: toProjectPath(cwd, manifestPath),
    ...(typeof casApply.filePath === "string" ? { timelineProjectionPath: casApply.filePath } : {}),
    minConsistency,
    panels: action.metadata.panels.length,
    timelineItems: stats.timelineItems.length,
    lowConsistencyPanels: stats.lowConsistencyPanels,
    panelCoverage: stats.panelCoverage,
    checks,
    blockedReasons,
  };
  await writeJson(reportPath, report);
  return {
    status: report.status,
    storyboardAssetId: report.storyboardAssetId,
    reportPath,
    panels: report.panels,
    timelineItems: report.timelineItems,
    lowConsistencyPanels: report.lowConsistencyPanels.length,
    blockedReasons: report.blockedReasons,
  };
}

function collectStats(options: {
  actionPanels: Array<{
    id: string;
    assetId: string;
    path?: string;
    consistencyScore?: number;
  }>;
  manifest: StoryboardTimelineManifest;
  minConsistency: number;
}): {
  manifestPanels: ManifestPanel[];
  timelineItems: ManifestTimelineItem[];
  panelCoverage: StoryboardTimelinePanelCoverage[];
  lowConsistencyPanels: Array<{ panelId: string; score: number }>;
  unsafePaths: string[];
} {
  const manifestPanels = readArray(options.manifest.panels) as ManifestPanel[];
  const timelineItems = readArray(options.manifest.timelineItems) as ManifestTimelineItem[];
  const manifestPanelIds = new Set(
    manifestPanels.map((panel) => panel.panelId).filter((panelId): panelId is string => typeof panelId === "string"),
  );
  const timelineItemsByPanel = new Map<string, ManifestTimelineItem>();
  for (const item of timelineItems) {
    if (typeof item.storyboardPanelId === "string") timelineItemsByPanel.set(item.storyboardPanelId, item);
  }
  const manifestPanelsByPanel = new Map<string, ManifestPanel>();
  for (const panel of manifestPanels) {
    if (typeof panel.panelId === "string") manifestPanelsByPanel.set(panel.panelId, panel);
  }
  const panelCoverage = options.actionPanels.map((panel) => {
    const manifestPanel = manifestPanelsByPanel.get(panel.id);
    const timelineItem = timelineItemsByPanel.get(panel.id);
    const score = readScore(panel.consistencyScore) ?? readScore(manifestPanel?.consistencyScore) ?? readScore(timelineItem?.consistencyScore);
    return {
      panelId: panel.id,
      assetId: panel.assetId,
      coveredByPanelManifest: manifestPanelIds.has(panel.id),
      coveredByTimelineItem: timelineItem !== undefined,
      ...(typeof timelineItem?.id === "string" ? { timelineItemId: timelineItem.id } : {}),
      ...(score === undefined ? {} : { consistencyScore: score }),
    };
  });
  const lowConsistencyPanels = panelCoverage
    .filter((panel) => panel.consistencyScore !== undefined && panel.consistencyScore < options.minConsistency)
    .map((panel) => ({ panelId: panel.panelId, score: panel.consistencyScore ?? 0 }));
  const unsafePaths = [
    ...manifestPanels.map((panel) => panel.path),
    ...timelineItems.map((item) => item.src),
  ]
    .filter((path): path is string => typeof path === "string")
    .filter((path) => !isSafeLocalAssetPath(path));
  return {
    manifestPanels,
    timelineItems,
    panelCoverage,
    lowConsistencyPanels,
    unsafePaths,
  };
}

function buildChecks(options: {
  storyboardAssetId: string;
  manifest: StoryboardTimelineManifest;
  stats: ReturnType<typeof collectStats>;
}): StoryboardTimelineVerificationCheck[] {
  const casApply = readRecord(options.manifest.casApply);
  const hasFreshPullCas =
    options.manifest.kind === "clash.storyboard.timeline-projection" &&
    options.manifest.storyboardAssetId === options.storyboardAssetId &&
    casApply.target === "timeline" &&
    casApply.mutation === "projection-only" &&
    casApply.applyCommand === "clash timeline apply" &&
    casApply.timelineIdPlaceholder === "<timeline-id>" &&
    casApply.pullCommand === "clash timeline pull" &&
    Array.isArray(casApply.requiredRuntimeArgs) &&
    casApply.requiredRuntimeArgs.includes("--timeline <timeline-id>") &&
    Array.isArray(casApply.applyArgs) &&
    !casApply.applyArgs.includes("--lock");
  const missingManifestPanels = options.stats.panelCoverage.filter((panel) => !panel.coveredByPanelManifest);
  const missingTimelineItems = options.stats.panelCoverage.filter((panel) => !panel.coveredByTimelineItem);
  return [
    check({
      id: "action.storyboard-metadata-present",
      label: "Storyboard metadata action is present",
      pass: true,
      expected: "AssetMetadataFillAction metadata.kind is image.storyboard-consistency",
      actual: "image.storyboard-consistency action parsed",
    }),
    check({
      id: "manifest.cas-fresh-pull",
      label: "Storyboard timeline projection declares fresh-pull CAS",
      pass: hasFreshPullCas,
      expected: "projection manifest has Project Timeline pull/apply CAS with explicit --timeline arg",
      actual: hasFreshPullCas ? "fresh-pull CAS present" : "fresh-pull CAS missing or target mismatch",
    }),
    check({
      id: "manifest.panels-covered",
      label: "Storyboard manifest covers all action panels",
      pass: missingManifestPanels.length === 0,
      expected: "every action panel appears in manifest.panels",
      actual: missingManifestPanels.length === 0
        ? `${options.stats.panelCoverage.length} panel(s) covered`
        : `missing panel(s): ${missingManifestPanels.map((panel) => panel.panelId).join(", ")}`,
    }),
    check({
      id: "manifest.timeline-items-covered",
      label: "Storyboard timeline items cover all panels",
      pass: missingTimelineItems.length === 0,
      expected: "every action panel appears as a timeline item",
      actual: missingTimelineItems.length === 0
        ? `${options.stats.timelineItems.length} timeline item(s) cover panels`
        : `missing timeline item(s): ${missingTimelineItems.map((panel) => panel.panelId).join(", ")}`,
    }),
    check({
      id: "panels.consistency-threshold",
      label: "Storyboard panel consistency meets threshold",
      pass: options.stats.lowConsistencyPanels.length === 0,
      expected: "all panel consistencyScore values meet the configured threshold",
      actual: options.stats.lowConsistencyPanels.length === 0
        ? "all scored panels meet threshold"
        : `low consistency panel(s): ${options.stats.lowConsistencyPanels.map((panel) => `${panel.panelId}:${panel.score}`).join(", ")}`,
    }),
    check({
      id: "panels.assets-local",
      label: "Storyboard panel media paths are local project assets",
      pass: options.stats.unsafePaths.length === 0,
      expected: "panel paths and timeline src values are project-relative local asset paths",
      actual: options.stats.unsafePaths.length === 0
        ? "all panel media paths are local"
        : `unsafe path(s): ${options.stats.unsafePaths.join(", ")}`,
    }),
  ];
}

function check(
  options: Omit<StoryboardTimelineVerificationCheck, "required" | "status"> & { pass: boolean },
): StoryboardTimelineVerificationCheck {
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

function readScore(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isSafeLocalAssetPath(path: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return false;
  if (isAbsolute(path)) return false;
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return !parts.includes("..");
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
  return slug || "storyboard";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
