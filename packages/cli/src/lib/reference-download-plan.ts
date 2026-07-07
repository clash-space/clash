import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ReferenceDownloadPlanStatus = "blocked" | "planned";

export type ReferenceDownloadPlan = {
  schemaVersion: 1;
  kind: "clash.reference.download-plan";
  targetAssetId: string;
  sourceUrl: string;
  status: ReferenceDownloadPlanStatus;
  downloadAllowed: boolean;
  blockedReasons: string[];
  tool: "yt-dlp";
  outputDir: string;
  rawReferenceQuarantine: true;
  finalExportAllowed: boolean;
  requiresUserExecution: true;
  downloadCommand: string[];
  sourceLedger: {
    sourceUrl: string;
    license: string;
    attribution: string;
    allowedUses: string[];
    redistributionAllowed: boolean;
    derivativeAllowed: boolean;
  };
  createdAt: string;
};

export type PlanReferenceDownloadOptions = {
  cwd: string;
  sourceUrl: string;
  targetAssetId: string;
  outPath?: string;
  outputDir?: string;
  allowDownload?: boolean;
  license?: string;
  attribution?: string;
  allowedUses?: string[];
  redistributionAllowed?: boolean;
  derivativeAllowed?: boolean;
};

export type PlanReferenceDownloadResult = {
  planned: true;
  status: ReferenceDownloadPlanStatus;
  targetAssetId: string;
  planPath: string;
  tool: "yt-dlp";
  downloadAllowed: boolean;
};

export async function planReferenceDownload(
  options: PlanReferenceDownloadOptions,
): Promise<PlanReferenceDownloadResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const sourceUrl = normalizeReferenceUrl(options.sourceUrl);
  const outputDir = resolveProjectPath(
    cwd,
    options.outputDir ?? join("references", "raw", safeSlug(targetAssetId)),
    "reference output directory",
  );
  const planPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("references", "downloads", `${safeSlug(targetAssetId)}.download-plan.json`),
      "reference download plan",
    ),
    writeVerb: "Reference download plan",
  });
  const downloadAllowed = options.allowDownload === true;
  const blockedReasons = downloadAllowed ? [] : ["download requires explicit --allow-download"];
  const redistributionAllowed = options.redistributionAllowed === true;
  const derivativeAllowed = options.derivativeAllowed === true;
  const plan: ReferenceDownloadPlan = {
    schemaVersion: 1,
    kind: "clash.reference.download-plan",
    targetAssetId,
    sourceUrl,
    status: downloadAllowed ? "planned" : "blocked",
    downloadAllowed,
    blockedReasons,
    tool: "yt-dlp",
    outputDir: toProjectPath(cwd, outputDir),
    rawReferenceQuarantine: true,
    finalExportAllowed: redistributionAllowed && derivativeAllowed,
    requiresUserExecution: true,
    downloadCommand: [
      "yt-dlp",
      "--no-playlist",
      "--restrict-filenames",
      "--write-info-json",
      "--output",
      `${toProjectPath(cwd, outputDir)}/%(id)s.%(ext)s`,
      sourceUrl,
    ],
    sourceLedger: {
      sourceUrl,
      license: options.license ?? "unknown",
      attribution: options.attribution ?? "unknown",
      allowedUses: normalizeAllowedUses(options.allowedUses),
      redistributionAllowed,
      derivativeAllowed,
    },
    createdAt: new Date().toISOString(),
  };
  await writeJson(planPath, plan);
  return {
    planned: true,
    status: plan.status,
    targetAssetId,
    planPath,
    tool: "yt-dlp",
    downloadAllowed,
  };
}

function normalizeReferenceUrl(rawUrl: string): string {
  const value = requireNonEmpty(rawUrl, "source URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("source URL must be an absolute http(s) URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("source URL must use http or https");
  }
  return url.toString();
}

function normalizeAllowedUses(allowedUses?: string[]): string[] {
  const values = (allowedUses ?? ["analysis-only"])
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set(values.length > 0 ? values : ["analysis-only"]));
}

function requireNonEmpty(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
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
  return slug || "reference";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
