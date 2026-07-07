import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { timelineDslToYaml } from "@clash/shared-types";
import { timelineProjectionCasApply } from "./timeline-projection";

type CompositionRoutePlan = {
  schemaVersion: 1;
  kind: "clash.render.composition-route";
  compositionId: string;
  compositionKind: string;
  status: "planned" | "blocked";
  selectedRuntime: "html" | "remotion" | "ffmpeg" | "manim" | null;
  fallbackUsed: false;
  routeCommand: string | null;
  requirements: string[];
  availableRuntimes: string[];
  inputPath?: string;
  outputPath?: string;
  validationPlan: string[];
  decisionLog: string[];
  blockedReasons: string[];
  rejectedFallbacks: Array<{ runtime: string; reason: string }>;
  createdAt: string;
};

type ProductionAssetManifestAsset = {
  id: string;
  type?: string;
  path?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type ProductionAssetManifest = {
  assets: ProductionAssetManifestAsset[];
  [key: string]: unknown;
};

export type ProjectCompositionTimelineOptions = {
  cwd: string;
  routePath: string;
  renderedAssetId: string;
  renderedSrc?: string;
  assetsPath?: string;
  from: number;
  durationInFrames: number;
};

export type ProjectCompositionTimelineResult = {
  projected: true;
  compositionId: string;
  runtime: "remotion";
  timelineProjectionPath: string;
  timelineLockPath: string;
  manifestPath: string;
};

export async function projectCompositionTimeline(
  options: ProjectCompositionTimelineOptions,
): Promise<ProjectCompositionTimelineResult> {
  const cwd = resolve(options.cwd);
  const routePath = resolveProjectPath(cwd, options.routePath, "composition route plan");
  const route = parseCompositionRoutePlan(await readFile(routePath, "utf8"), routePath);
  assertProjectableRoute(route);

  if (!Number.isInteger(options.from) || options.from < 0) {
    throw new Error("--from must be a non-negative integer frame");
  }
  if (!Number.isInteger(options.durationInFrames) || options.durationInFrames <= 0) {
    throw new Error("--duration must be a positive integer frame count");
  }

  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");
  const manifest = parseAssetManifest(await readFile(assetsPath, "utf8"), assetsPath);
  const renderedAsset = requireAsset(manifest, options.renderedAssetId, assetsPath);
  const sourcePath = normalizeProjectRelativePath(cwd, route.inputPath, "composition source path");
  const renderedAssetPath = normalizeProjectRelativePath(
    cwd,
    options.renderedSrc ?? route.outputPath,
    "rendered asset path",
  );
  const registeredAssetPath = normalizeProjectRelativePath(
    cwd,
    renderedAsset.path,
    `rendered asset ${options.renderedAssetId} path`,
  );

  if (registeredAssetPath !== renderedAssetPath) {
    throw new Error(
      `Rendered asset ${options.renderedAssetId} path ${registeredAssetPath} does not match route output ${renderedAssetPath}`,
    );
  }

  const item = {
    id: `composition-${safeSlug(route.compositionId)}`,
    type: "composition" as const,
    from: options.from,
    durationInFrames: options.durationInFrames,
    compositionKind: route.compositionKind,
    runtime: "remotion" as const,
    compositionId: route.compositionId,
    sourcePath,
    renderedAssetPath,
    assetId: options.renderedAssetId,
  };

  const timelineProjectionPath = join(
    cwd,
    "projections",
    "timelines",
    `${safeSlug(route.compositionId)}.composition.timeline.yaml`,
  );
  const { casApply, lockPath: timelineLockPath } = timelineProjectionCasApply({
    cwd,
    filePath: timelineProjectionPath,
  });
  const manifestPath = join(
    dirname(timelineProjectionPath),
    `${basename(timelineProjectionPath, ".yaml")}-manifest.json`,
  );

  await writeText(timelineProjectionPath, timelineDslToYaml({
    compositionWidth: 1080,
    compositionHeight: 1920,
    fps: 30,
    durationInFrames: options.from + options.durationInFrames,
    tracks: [
      {
        id: "compositions",
        name: "Rendered Compositions",
        role: "overlay",
        items: [item],
      },
    ],
  } as any));
  await writeJson(manifestPath, {
    schemaVersion: 1,
    kind: "clash.composition.timeline-projection",
    routePlanPath: toProjectPath(cwd, routePath),
    compositionId: route.compositionId,
    compositionKind: route.compositionKind,
    runtime: "remotion",
    sourcePath,
    renderedAssetId: options.renderedAssetId,
    renderedAssetPath,
    routeCommand: route.routeCommand,
    validationPlan: route.validationPlan,
    timelineItems: [item],
    validation: {
      routeStatus: route.status,
      fallbackUsed: route.fallbackUsed,
      renderedAssetRegistered: true,
      renderedAssetMatchesRoute: true,
      localProjectPaths: true,
      timelineItemType: "composition",
    },
    casApply,
  });

  return {
    projected: true,
    compositionId: route.compositionId,
    runtime: "remotion",
    timelineProjectionPath,
    timelineLockPath,
    manifestPath,
  };
}

function assertProjectableRoute(route: CompositionRoutePlan): void {
  if (route.status !== "planned") {
    throw new Error(`Composition route ${route.compositionId} is ${route.status}; cannot project it into timeline`);
  }
  if (route.fallbackUsed !== false) {
    throw new Error("Composition route fallbackUsed must be false before timeline projection");
  }
  if (route.selectedRuntime !== "remotion") {
    throw new Error(
      `project-composition-timeline only accepts rendered Remotion routes; got ${route.selectedRuntime ?? "none"}`,
    );
  }
  if (!route.routeCommand) {
    throw new Error("Composition route must record the render command used before timeline projection");
  }
}

function parseCompositionRoutePlan(raw: string, path: string): CompositionRoutePlan {
  const parsed = JSON.parse(raw) as Partial<CompositionRoutePlan>;
  if (
    parsed.schemaVersion !== 1 ||
    parsed.kind !== "clash.render.composition-route" ||
    typeof parsed.compositionId !== "string" ||
    typeof parsed.compositionKind !== "string" ||
    (parsed.status !== "planned" && parsed.status !== "blocked") ||
    parsed.fallbackUsed !== false ||
    !Array.isArray(parsed.requirements) ||
    !Array.isArray(parsed.availableRuntimes) ||
    !Array.isArray(parsed.validationPlan) ||
    !Array.isArray(parsed.decisionLog) ||
    !Array.isArray(parsed.blockedReasons) ||
    !Array.isArray(parsed.rejectedFallbacks) ||
    typeof parsed.createdAt !== "string"
  ) {
    throw new Error(`Invalid composition route plan at ${path}`);
  }
  return parsed as CompositionRoutePlan;
}

function requireAsset(
  manifest: ProductionAssetManifest,
  assetId: string,
  assetsPath: string,
): ProductionAssetManifestAsset {
  if (!assetId || typeof assetId !== "string") {
    throw new Error("--rendered-asset is required");
  }
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

function normalizeProjectRelativePath(cwd: string, rawPath: unknown, label: string): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error(`${label} is required`);
  }
  const resolved = resolveProjectPath(cwd, rawPath, label);
  return relative(cwd, resolved).split(sep).join("/");
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
  return slug || "composition";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
