import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { timelineDslToYaml } from "@clash/shared-types";
import { timelineProjectionCasApply } from "./timeline-projection";

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

export type DerivedOverlayMediaType = "image" | "video";
export type DerivedOverlayDerivationKind = "trim" | "crop" | "caption-burn" | "transcode" | "other";

export type ProjectDerivedOverlayOptions = {
  cwd: string;
  assetsPath?: string;
  sourceAssetId: string;
  derivedAssetId: string;
  mediaType: DerivedOverlayMediaType;
  from: number;
  durationInFrames: number;
  derivationKind: DerivedOverlayDerivationKind;
  description?: string;
};

export type ProjectDerivedOverlayResult = {
  projected: true;
  sourceAssetId: string;
  derivedAssetId: string;
  timelineProjectionPath: string;
  manifestPath: string;
};

export async function projectDerivedOverlayTimeline(
  options: ProjectDerivedOverlayOptions,
): Promise<ProjectDerivedOverlayResult> {
  const cwd = resolve(options.cwd);
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);
  const sourceAsset = requireAsset(manifest, options.sourceAssetId, assetsPath);
  const derivedAsset = requireAsset(manifest, options.derivedAssetId, assetsPath);

  if (sourceAsset.id === derivedAsset.id) {
    throw new Error("derived overlay must be copy-on-write: source and derived asset ids cannot match");
  }
  if (!Number.isInteger(options.from) || options.from < 0) {
    throw new Error("--from must be a non-negative integer frame");
  }
  if (!Number.isInteger(options.durationInFrames) || options.durationInFrames <= 0) {
    throw new Error("--duration must be a positive integer frame count");
  }

  const derivedPath = normalizeAssetPath(derivedAsset.path, `derived asset ${derivedAsset.id} path`);
  const sourcePath = sourceAsset.path
    ? normalizeAssetPath(sourceAsset.path, `source asset ${sourceAsset.id} path`)
    : undefined;
  const item = {
    id: `${options.derivedAssetId}-overlay`,
    type: "derived-overlay" as const,
    from: options.from,
    durationInFrames: options.durationInFrames,
    mediaType: options.mediaType,
    src: derivedPath,
    sourceAssetId: options.sourceAssetId,
    derivedAssetId: options.derivedAssetId,
    derivation: {
      kind: options.derivationKind,
      ...(options.description ? { description: options.description } : {}),
    },
  };

  const timelineProjectionPath = join(
    cwd,
    "projections",
    "timelines",
    `${safeSlug(options.derivedAssetId)}.derived-overlay.timeline.yaml`,
  );
  const { casApply } = timelineProjectionCasApply({
    cwd,
    filePath: timelineProjectionPath,
  });
  const manifestPath = join(
    dirname(timelineProjectionPath),
    `${basename(timelineProjectionPath, ".yaml")}-manifest.json`,
  );

  const timeline = {
    compositionWidth: 1080,
    compositionHeight: 1920,
    fps: 30,
    durationInFrames: options.from + options.durationInFrames,
    tracks: [
      {
        id: "overlays",
        name: "Derived Asset Overlays",
        role: "overlay",
        items: [item],
      },
    ],
  };

  await writeText(timelineProjectionPath, timelineDslToYaml(timeline as any));
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.derived-overlay.timeline-projection",
    sourceAssetId: options.sourceAssetId,
    derivedAssetId: options.derivedAssetId,
    ...(sourcePath ? { sourceAssetPath: sourcePath } : {}),
    derivedAssetPath: derivedPath,
    mediaType: options.mediaType,
    timelineItems: [item],
    validation: {
      timelineItemType: "derived-overlay",
      copyOnWrite: true,
      localProjectPath: true,
    },
    casApply,
  });

  return {
    projected: true,
    sourceAssetId: options.sourceAssetId,
    derivedAssetId: options.derivedAssetId,
    timelineProjectionPath,
    manifestPath,
  };
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

function parseAssetManifest(raw: string, path: string): ProductionAssetManifest {
  const parsed = JSON.parse(raw) as Partial<ProductionAssetManifest>;
  if (!Array.isArray(parsed.assets)) {
    throw new Error(`Invalid asset manifest at ${path}: expected assets array`);
  }
  return { ...parsed, assets: parsed.assets } as ProductionAssetManifest;
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

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "derived-overlay";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
