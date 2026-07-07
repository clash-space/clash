import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  MgCompositionSpecSchema,
  evaluateMgLayerAtFrame,
  type MgCompositionLayer,
  type MgCompositionSpec,
} from "@clash/shared-types";

export type ExportMgSnapshotAssetOptions = {
  cwd: string;
  specPath: string;
  assetId: string;
  outDir?: string;
  frames?: number[];
  assetsPath?: string;
};

export type ExportMgSnapshotAssetResult = {
  assetId: string;
  assetManifestPath: string;
  exportManifestPath: string;
  framePaths: string[];
};

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

export async function exportMgSnapshotAsset(
  options: ExportMgSnapshotAssetOptions,
): Promise<ExportMgSnapshotAssetResult> {
  const cwd = resolve(options.cwd);
  const specPath = resolveProjectPath(cwd, options.specPath, "spec");
  const spec = MgCompositionSpecSchema.parse(JSON.parse(await readFile(specPath, "utf8")));
  const frames = normalizeFrames(options.frames ?? [0], spec);
  const outDir = resolveProjectPath(
    cwd,
    options.outDir ?? join("assets", "overlays", spec.id),
    "output directory",
  );
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");

  const framePaths: string[] = [];
  for (const frame of frames) {
    const framePath = join(outDir, `frame-${String(frame).padStart(4, "0")}.svg`);
    await writeText(framePath, renderMgFrameSvg(spec, frame));
    framePaths.push(framePath);
  }

  const exportManifestPath = join(outDir, "manifest.json");
  const exportManifest = {
    kind: "clash.mg.snapshot-export",
    compositionId: spec.id,
    sourceSpecPath: toProjectPath(cwd, specPath),
    fps: spec.fps,
    durationInFrames: spec.durationInFrames,
    dimensions: { width: spec.width, height: spec.height },
    frameCount: framePaths.length,
    frames: framePaths.map((path, index) => ({
      frame: frames[index],
      path: toProjectPath(cwd, path),
      width: spec.width,
      height: spec.height,
      format: "svg",
    })),
  };
  await writeJson(exportManifestPath, exportManifest);

  const assetManifest = await readAssetManifest(assetsPath);
  const assetEntry: ProductionAssetManifestAsset = {
    id: options.assetId,
    type: "overlay-snapshot-sequence",
    path: toProjectPath(cwd, exportManifestPath),
    metadata: {
      "mg.snapshot-export": exportManifest,
    },
  };
  const existingIndex = assetManifest.assets.findIndex((asset) => asset.id === options.assetId);
  if (existingIndex >= 0) {
    assetManifest.assets[existingIndex] = {
      ...assetManifest.assets[existingIndex],
      ...assetEntry,
      metadata: {
        ...(assetManifest.assets[existingIndex].metadata ?? {}),
        ...assetEntry.metadata,
      },
    };
  } else {
    assetManifest.assets.push(assetEntry);
  }
  await writeJson(assetsPath, assetManifest);

  return {
    assetId: options.assetId,
    assetManifestPath: assetsPath,
    exportManifestPath,
    framePaths,
  };
}

function renderMgFrameSvg(spec: MgCompositionSpec, frame: number): string {
  const layers = spec.layers
    .slice()
    .sort((a, b) => a.zIndex - b.zIndex)
    .filter((layer) => frame >= layer.from && frame < layer.from + layer.durationInFrames)
    .map((layer) => renderLayerSvg(layer, frame))
    .join("\n  ");

  const background = spec.background === "transparent"
    ? ""
    : `\n  <rect width="100%" height="100%" fill="${escapeXml(spec.background)}" />`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}" data-composition-id="${escapeXml(spec.id)}" data-frame="${frame}">
  <metadata>${escapeXml(JSON.stringify({ generator: "clash-mg-snapshot-export", frame, fps: spec.fps }))}</metadata>${background}
  ${layers}
</svg>
`;
}

function renderLayerSvg(layer: MgCompositionLayer, frame: number): string {
  const style = evaluateMgLayerAtFrame(layer, frame);
  const transform = `translate(${style.x} ${style.y}) scale(${style.scale}) rotate(${style.rotation})`;
  const opacity = Math.max(0, Math.min(1, style.opacity));
  if (layer.type === "shape") {
    if (layer.shape === "circle") {
      const width = layer.width ?? layer.height ?? 1;
      const height = layer.height ?? layer.width ?? 1;
      return `<g data-layer-id="${escapeXml(layer.id)}" opacity="${opacity}" transform="${transform}"><ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${escapeXml(layer.fill)}"${strokeAttrs(layer)} /></g>`;
    }
    const width = layer.width ?? 1;
    const height = layer.height ?? 1;
    const radius = layer.shape === "rounded-rect" ? layer.radius : 0;
    return `<g data-layer-id="${escapeXml(layer.id)}" opacity="${opacity}" transform="${transform}"><rect width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="${escapeXml(layer.fill)}"${strokeAttrs(layer)} /></g>`;
  }

  const fontWeight = String(layer.fontWeight);
  const lines = layer.text.split(/\r?\n/);
  const text = lines
    .map((line, index) => {
      const y = layer.fontSize * (index + 1);
      return `<tspan x="0" y="${y}">${escapeXml(line)}</tspan>`;
    })
    .join("");
  return `<g data-layer-id="${escapeXml(layer.id)}" opacity="${opacity}" transform="${transform}"><text font-family="${escapeXml(layer.fontFamily)}" font-size="${layer.fontSize}" font-weight="${escapeXml(fontWeight)}" fill="${escapeXml(layer.color)}" letter-spacing="${layer.letterSpacing}" text-anchor="${svgTextAnchor(layer.align)}">${text}</text></g>`;
}

function strokeAttrs(layer: Extract<MgCompositionLayer, { type: "shape" }>): string {
  if (!layer.stroke) return "";
  const width = layer.strokeWidth ?? 1;
  return ` stroke="${escapeXml(layer.stroke)}" stroke-width="${width}"`;
}

function svgTextAnchor(align: "left" | "center" | "right"): string {
  if (align === "center") return "middle";
  if (align === "right") return "end";
  return "start";
}

function normalizeFrames(frames: number[], spec: MgCompositionSpec): number[] {
  const unique = Array.from(new Set(frames));
  if (unique.length === 0) throw new Error("At least one frame is required");
  for (const frame of unique) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= spec.durationInFrames) {
      throw new Error(`Frame ${frame} is outside composition duration 0-${spec.durationInFrames - 1}`);
    }
  }
  return unique.sort((a, b) => a - b);
}

async function readAssetManifest(path: string): Promise<ProductionAssetManifest> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const maybeNodeError = error as NodeJS.ErrnoException;
    if (maybeNodeError.code !== "ENOENT") throw error;
    return { assets: [] };
  }
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

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function toProjectPath(cwd: string, absolutePath: string): string {
  return relative(cwd, absolutePath).split(sep).join("/");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}
