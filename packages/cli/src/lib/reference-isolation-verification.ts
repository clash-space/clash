import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { timelineDslFromYaml } from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ReferenceIsolationVerificationOptions = {
  cwd: string;
  timelinePath: string;
  assetsPath?: string;
  outPath?: string;
};

export type ReferenceIsolationVerificationCheck = {
  id:
    | "assets.raw-reference-quarantine-known"
    | "timeline.valid"
    | "timeline.no-unlicensed-raw-reference-assets"
    | "timeline.no-unlicensed-raw-reference-paths";
  label: string;
  required: true;
  status: "pass" | "fail";
  expected: string;
  actual: string;
};

export type ReferenceIsolationRawAsset = {
  assetId: string;
  path?: string;
  sourceUrl?: string;
  finalExportAllowed: boolean;
  redistributionAllowed: boolean;
  derivativeAllowed: boolean;
  downloadedPaths: string[];
};

export type ReferenceIsolationTimelineItem = {
  trackId: string;
  itemId: string;
  assetId?: string;
  src?: string;
};

export type ReferenceIsolationOffender = ReferenceIsolationTimelineItem & {
  sourceUrl?: string;
  reason:
    | "timeline item uses quarantined raw reference without final export rights"
    | "timeline item uses raw reference path without final export rights";
};

export type ReferenceIsolationVerificationReport = {
  schemaVersion: 1;
  kind: "clash.reference.isolation-verification";
  status: "pass" | "blocked";
  sourceTimelinePath: string;
  assetsPath: string;
  rawReferenceAssets: ReferenceIsolationRawAsset[];
  timelineItems: ReferenceIsolationTimelineItem[];
  offenders: ReferenceIsolationOffender[];
  checks: ReferenceIsolationVerificationCheck[];
  blockedReasons: string[];
};

export type ReferenceIsolationVerificationResult = {
  status: "pass" | "blocked";
  reportPath: string;
  rawReferenceAssets: number;
  timelineItems: number;
  offenders: number;
  blockedReasons: string[];
};

type AssetManifest = {
  assets: Array<Record<string, unknown> & {
    id?: unknown;
    path?: unknown;
    metadata?: unknown;
  }>;
};

export async function verifyReferenceIsolation(
  options: ReferenceIsolationVerificationOptions,
): Promise<ReferenceIsolationVerificationResult> {
  const cwd = resolve(options.cwd);
  const timelinePath = resolveProjectPath(cwd, options.timelinePath, "timeline");
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "assets manifest");
  const rawAssets = collectRawReferenceAssets(await readAssetManifest(assetsPath));
  const parsed = timelineDslFromYaml(await readFile(timelinePath, "utf8"));
  const timelineItems = parsed.ok ? collectTimelineItems(parsed.dsl as any) : [];
  const offenders = collectOffenders({ rawAssets, timelineItems });
  const checks = buildChecks({
    parsedOk: parsed.ok,
    parseError: parsed.ok ? undefined : parsed.error,
    rawAssets,
    timelineItems,
    offenders,
  });
  const blockedReasons = checks
    .filter((check) => check.status === "fail")
    .map((check) => `${check.id}: ${check.actual}`);
  const reportPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("qa", "reference", `${basenameWithoutYaml(timelinePath)}.reference-isolation.json`),
      "reference isolation report",
    ),
    writeVerb: "Reference isolation report",
  });
  const report: ReferenceIsolationVerificationReport = {
    schemaVersion: 1,
    kind: "clash.reference.isolation-verification",
    status: blockedReasons.length === 0 ? "pass" : "blocked",
    sourceTimelinePath: toProjectPath(cwd, timelinePath),
    assetsPath: toProjectPath(cwd, assetsPath),
    rawReferenceAssets: rawAssets,
    timelineItems,
    offenders,
    checks,
    blockedReasons,
  };
  await writeJson(reportPath, report);
  return {
    status: report.status,
    reportPath,
    rawReferenceAssets: report.rawReferenceAssets.length,
    timelineItems: report.timelineItems.length,
    offenders: report.offenders.length,
    blockedReasons: report.blockedReasons,
  };
}

function collectRawReferenceAssets(manifest: AssetManifest): ReferenceIsolationRawAsset[] {
  const assets: ReferenceIsolationRawAsset[] = [];
  for (const asset of manifest.assets) {
    if (typeof asset.id !== "string" || !asset.id.trim()) continue;
    const metadata = readRecord(readRecord(asset.metadata)["reference.download"]);
    const assetPath = typeof asset.path === "string" ? normalizeProjectPath(asset.path) : undefined;
    const downloadedFiles = readArray(metadata.downloadedFiles);
    const downloadedPaths = downloadedFiles
      .map((file) => readRecord(file).path)
      .filter((path): path is string => typeof path === "string")
      .map(normalizeProjectPath);
    const isQuarantined = metadata.rawReferenceQuarantine === true || isRawReferencePath(assetPath);
    if (!isQuarantined) continue;
    const sourceLedger = readRecord(metadata.sourceLedger);
    assets.push({
      assetId: asset.id,
      ...(assetPath === undefined ? {} : { path: assetPath }),
      ...(typeof metadata.sourceUrl === "string" ? { sourceUrl: metadata.sourceUrl } : {}),
      finalExportAllowed: metadata.finalExportAllowed === true,
      redistributionAllowed: sourceLedger.redistributionAllowed === true,
      derivativeAllowed: sourceLedger.derivativeAllowed === true,
      downloadedPaths,
    });
  }
  return assets;
}

function collectTimelineItems(dsl: { tracks?: unknown }): ReferenceIsolationTimelineItem[] {
  const tracks = readArray(dsl.tracks);
  const items: ReferenceIsolationTimelineItem[] = [];
  for (const track of tracks) {
    const trackRecord = readRecord(track);
    const trackId = typeof trackRecord.id === "string" ? trackRecord.id : "track";
    for (const item of readArray(trackRecord.items)) {
      const itemRecord = readRecord(item);
      const itemId = typeof itemRecord.id === "string" ? itemRecord.id : `item-${items.length + 1}`;
      const assetId = typeof itemRecord.assetId === "string" ? itemRecord.assetId : undefined;
      const src = typeof itemRecord.src === "string" ? normalizeProjectPath(itemRecord.src) : undefined;
      items.push({
        trackId,
        itemId,
        ...(assetId === undefined ? {} : { assetId }),
        ...(src === undefined ? {} : { src }),
      });
    }
  }
  return items;
}

function collectOffenders(options: {
  rawAssets: ReferenceIsolationRawAsset[];
  timelineItems: ReferenceIsolationTimelineItem[];
}): ReferenceIsolationOffender[] {
  const rawByAsset = new Map(options.rawAssets.map((asset) => [asset.assetId, asset]));
  const rawByPath = new Map<string, ReferenceIsolationRawAsset>();
  for (const asset of options.rawAssets) {
    if (asset.path) rawByPath.set(asset.path, asset);
    for (const path of asset.downloadedPaths) rawByPath.set(path, asset);
  }
  const offenders: ReferenceIsolationOffender[] = [];
  for (const item of options.timelineItems) {
    const asset = item.assetId ? rawByAsset.get(item.assetId) : undefined;
    if (asset && !hasFinalExportRights(asset)) {
      offenders.push({
        ...item,
        ...(asset.sourceUrl === undefined ? {} : { sourceUrl: asset.sourceUrl }),
        reason: "timeline item uses quarantined raw reference without final export rights",
      });
      continue;
    }
    const pathAsset = item.src ? rawByPath.get(item.src) : undefined;
    if (pathAsset && !hasFinalExportRights(pathAsset)) {
      offenders.push({
        ...item,
        ...(pathAsset.sourceUrl === undefined ? {} : { sourceUrl: pathAsset.sourceUrl }),
        reason: "timeline item uses raw reference path without final export rights",
      });
      continue;
    }
    if (item.src && isRawReferencePath(item.src)) {
      offenders.push({
        ...item,
        reason: "timeline item uses raw reference path without final export rights",
      });
    }
  }
  return offenders;
}

function buildChecks(options: {
  parsedOk: boolean;
  parseError?: string;
  rawAssets: ReferenceIsolationRawAsset[];
  timelineItems: ReferenceIsolationTimelineItem[];
  offenders: ReferenceIsolationOffender[];
}): ReferenceIsolationVerificationCheck[] {
  const assetOffenders = options.offenders.filter((offender) => offender.reason.includes("quarantined raw reference"));
  const pathOffenders = options.offenders.filter((offender) => offender.reason.includes("raw reference path"));
  return [
    check({
      id: "assets.raw-reference-quarantine-known",
      label: "Raw reference assets are represented as quarantined assets",
      pass: true,
      expected: "raw references are identifiable from asset metadata or references/raw paths",
      actual: `${options.rawAssets.length} raw reference asset(s) known`,
    }),
    check({
      id: "timeline.valid",
      label: "Timeline projection validates before reference isolation checks",
      pass: options.parsedOk,
      expected: "timeline YAML parses as Clash timeline DSL",
      actual: options.parsedOk ? `${options.timelineItems.length} timeline item(s)` : options.parseError ?? "timeline parse failed",
    }),
    check({
      id: "timeline.no-unlicensed-raw-reference-assets",
      label: "Timeline does not use quarantined raw reference assets without rights",
      pass: options.parsedOk && assetOffenders.length === 0,
      expected: "no timeline item assetId points at an unlicensed raw reference asset",
      actual: assetOffenders.length === 0
        ? "no unlicensed raw reference asset ids"
        : assetOffenders.map((offender) => `${offender.itemId}:${offender.assetId}`).join(", "),
    }),
    check({
      id: "timeline.no-unlicensed-raw-reference-paths",
      label: "Timeline does not use raw reference paths without rights",
      pass: options.parsedOk && pathOffenders.length === 0,
      expected: "no timeline item src points at references/raw without final export rights",
      actual: pathOffenders.length === 0
        ? "no unlicensed raw reference paths"
        : pathOffenders.map((offender) => `${offender.itemId}:${offender.src}`).join(", "),
    }),
  ];
}

function hasFinalExportRights(asset: ReferenceIsolationRawAsset): boolean {
  return asset.finalExportAllowed && asset.redistributionAllowed && asset.derivativeAllowed;
}

function check(
  options: Omit<ReferenceIsolationVerificationCheck, "required" | "status"> & { pass: boolean },
): ReferenceIsolationVerificationCheck {
  return {
    id: options.id,
    label: options.label,
    required: true,
    status: options.pass ? "pass" : "fail",
    expected: options.expected,
    actual: options.actual,
  };
}

async function readAssetManifest(path: string): Promise<AssetManifest> {
  const parsed = JSON.parse(await readFile(path, "utf8")) as { assets?: unknown };
  return {
    assets: Array.isArray(parsed.assets)
      ? parsed.assets.filter((asset): asset is AssetManifest["assets"][number] => Boolean(asset) && typeof asset === "object")
      : [],
  };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRawReferencePath(path: string | undefined): boolean {
  return path?.startsWith("references/raw/") === true || path?.startsWith("reference/raw/") === true;
}

function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function basenameWithoutYaml(path: string): string {
  return path
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.ya?ml$/i, "") ?? "timeline";
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
