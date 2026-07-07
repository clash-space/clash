import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { AssetMetadataFillActionSchema, timelineDslToYaml } from "@clash/shared-types";
import { timelineProjectionCasApply } from "./timeline-projection";

export type ProjectStoryboardTimelineOptions = {
  cwd: string;
  actionPath: string;
  assetsPath?: string;
  durationPerPanel: number;
};

export type ProjectStoryboardTimelineResult = {
  projected: true;
  storyboardAssetId: string;
  timelineProjectionPath: string;
  timelineLockPath: string;
  manifestPath: string;
  panels: number;
};

export async function projectStoryboardTimeline(
  options: ProjectStoryboardTimelineOptions,
): Promise<ProjectStoryboardTimelineResult> {
  const cwd = resolve(options.cwd);
  const actionPath = resolveProjectPath(cwd, options.actionPath, "action");
  const action = AssetMetadataFillActionSchema.parse(JSON.parse(await readFile(actionPath, "utf8")));
  if (action.metadata.kind !== "image.storyboard-consistency") {
    throw new Error(`Expected image.storyboard-consistency action, got ${action.metadata.kind}`);
  }
  if (!Number.isInteger(options.durationPerPanel) || options.durationPerPanel <= 0) {
    throw new Error("--duration-per-panel must be a positive integer frame count");
  }
  if (action.metadata.panels.length === 0) {
    throw new Error("Storyboard timeline projection requires at least one panel");
  }
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);

  const panels = action.metadata.panels.map((panel, index) => {
    if (!panel.path) {
      throw new Error(`storyboard panel ${panel.id} must include a local path before timeline projection`);
    }
    return {
      panelId: panel.id,
      sceneId: panel.sceneId,
      characterIds: panel.characterIds,
      assetId: panel.assetId,
      path: normalizeAssetPath(panel.path, `storyboard panel ${panel.id} path`),
      from: index * options.durationPerPanel,
      durationInFrames: options.durationPerPanel,
      ...(panel.consistencyScore === undefined ? {} : { consistencyScore: panel.consistencyScore }),
    };
  });
  assertRegisteredStoryboardAssets({
    manifest,
    storyboardAssetId: action.targetAssetId,
    panels,
    assetsPath,
  });

  const timelineProjectionPath = join(
    cwd,
    "projections",
    "timelines",
    `${safeSlug(action.targetAssetId)}.storyboard.timeline.yaml`,
  );
  const { casApply, lockPath: timelineLockPath } = timelineProjectionCasApply({
    cwd,
    filePath: timelineProjectionPath,
  });
  const manifestPath = join(
    dirname(timelineProjectionPath),
    `${basename(timelineProjectionPath, ".yaml")}-manifest.json`,
  );
  const timelineItems = panels.map((panel) => ({
    id: `storyboard-${safeSlug(panel.panelId)}`,
    type: "image",
    from: panel.from,
    durationInFrames: panel.durationInFrames,
    assetId: panel.assetId,
    src: panel.path,
    storyboardPanelId: panel.panelId,
    sceneId: panel.sceneId,
    characterIds: panel.characterIds,
    ...(panel.consistencyScore === undefined ? {} : { consistencyScore: panel.consistencyScore }),
  }));
  const durationInFrames = panels[panels.length - 1].from + panels[panels.length - 1].durationInFrames;

  await writeText(timelineProjectionPath, timelineDslToYaml({
    compositionWidth: 1080,
    compositionHeight: 1920,
    fps: 30,
    durationInFrames,
    tracks: [
      {
        id: "storyboard-panels",
        name: "Storyboard Panels",
        role: "primary-video",
        items: timelineItems,
      },
    ],
  } as any));
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.storyboard.timeline-projection",
    storyboardAssetId: action.targetAssetId,
    sourceActionPath: toProjectPath(cwd, actionPath),
    durationPerPanel: options.durationPerPanel,
    panels,
    timelineItems,
    casApply,
  });

  return {
    projected: true,
    storyboardAssetId: action.targetAssetId,
    timelineProjectionPath,
    timelineLockPath,
    manifestPath,
    panels: panels.length,
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

function assertRegisteredStoryboardAssets(options: {
  manifest: ProductionAssetManifest;
  storyboardAssetId: string;
  panels: Array<{ panelId: string; assetId: string; path: string }>;
  assetsPath: string;
}): void {
  const byId = new Map(options.manifest.assets.map((asset) => [asset.id, asset]));
  if (!byId.has(options.storyboardAssetId)) {
    throw new Error(`Storyboard asset ${options.storyboardAssetId} is not registered in ${toProjectDisplayPath(options.assetsPath)}`);
  }
  for (const panel of options.panels) {
    const asset = byId.get(panel.assetId);
    if (!asset) {
      throw new Error(`Storyboard panel asset ${panel.assetId} is not registered in ${toProjectDisplayPath(options.assetsPath)}`);
    }
    if (typeof asset.path !== "string" || !asset.path.trim()) {
      throw new Error(`Storyboard panel asset ${panel.assetId} path is required in ${toProjectDisplayPath(options.assetsPath)}`);
    }
    if (normalizeAssetPath(asset.path, `storyboard panel asset ${panel.assetId} path`) !== panel.path) {
      throw new Error(`Storyboard panel asset ${panel.assetId} path does not match storyboard metadata`);
    }
  }
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

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "storyboard";
}

function toProjectDisplayPath(path: string): string {
  const normalized = path.split(sep).join("/");
  const marker = "/assets/manifest.json";
  return normalized.endsWith(marker) ? "assets/manifest.json" : normalized;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
