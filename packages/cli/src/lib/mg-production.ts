import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MgCompositionSpecSchema,
  buildMgOverlayManifest,
  renderMgCompositionHtml,
  timelineDslToYaml,
  type MgCompositionSpec,
  type MgOverlayManifest,
} from "@clash/shared-types";
import { timelineProjectionCasApply } from "./timeline-projection";

export type RenderMgProductionProjectionOptions = {
  cwd: string;
  specPath: string;
  outDir?: string;
  renderedAssetPath: string;
  timelineFromFrame?: number;
};

export type RenderMgProductionProjectionResult = {
  compositionId: string;
  htmlPath: string;
  manifestPath: string;
  timelineProjectionPath: string;
  timelineLockPath: string;
};

export async function renderMgProductionProjection(
  options: RenderMgProductionProjectionOptions,
): Promise<RenderMgProductionProjectionResult> {
  const cwd = resolve(options.cwd);
  const specPath = resolveProjectPath(cwd, options.specPath, "spec");
  const spec = MgCompositionSpecSchema.parse(JSON.parse(await readFile(specPath, "utf8")));
  const timelineFromFrame = normalizeTimelineFromFrame(options.timelineFromFrame);

  const outDir = resolveProjectPath(
    cwd,
    options.outDir ?? join("projections", "mg", spec.id),
    "output directory",
  );
  const htmlPath = join(outDir, "index.html");
  const manifestPath = join(outDir, "timeline-manifest.json");
  const timelineProjectionPath = join(cwd, "projections", "timelines", `${spec.id}.mg.timeline.yaml`);
  const { casApply, lockPath: timelineLockPath } = timelineProjectionCasApply({
    cwd,
    filePath: timelineProjectionPath,
  });

  const manifest = buildMgOverlayManifest(spec, {
    sourcePath: toProjectPath(cwd, htmlPath),
    renderedAssetPath: toProjectPath(
      cwd,
      resolveProjectPath(cwd, options.renderedAssetPath, "rendered asset"),
    ),
    timelineFromFrame,
    timelineProjectionPath: toProjectPath(cwd, timelineProjectionPath),
    timelineLockPath: toProjectPath(cwd, timelineLockPath),
    timelineCasApply: casApply,
  });

  await writeText(htmlPath, renderMgCompositionHtml(spec));
  await writeJson(manifestPath, manifest);
  await writeText(timelineProjectionPath, buildMgTimelineProjection(spec, manifest, timelineFromFrame));

  return {
    compositionId: spec.id,
    htmlPath,
    manifestPath,
    timelineProjectionPath,
    timelineLockPath,
  };
}

function buildMgTimelineProjection(
  spec: MgCompositionSpec,
  manifest: MgOverlayManifest,
  timelineFromFrame: number,
): string {
  return timelineDslToYaml({
    compositionWidth: spec.width,
    compositionHeight: spec.height,
    fps: spec.fps,
    durationInFrames: timelineFromFrame + spec.durationInFrames,
    tracks: [
      {
        id: "overlays",
        name: "MG Overlays",
        role: "overlay",
        items: manifest.timelineItems,
      },
    ],
  } as any);
}

function normalizeTimelineFromFrame(value: number | undefined): number {
  if (value === undefined) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("--from must be a non-negative integer frame");
  }
  return value;
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
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
