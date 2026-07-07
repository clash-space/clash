import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { once } from "node:events";
import {
  MgCompositionSpecSchema,
  evaluateMgLayerAtFrame,
  type MgCompositionLayer,
  type MgCompositionSpec,
} from "@clash/shared-types";

export type ExportMgVideoAssetOptions = {
  cwd: string;
  specPath: string;
  assetId: string;
  outPath?: string;
  assetsPath?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
};

export type ExportMgVideoAssetResult = {
  assetId: string;
  assetManifestPath: string;
  exportManifestPath: string;
  outputPath: string;
  format: "webm" | "mp4";
  probe: VideoProbeResult;
};

type VideoProbeResult = {
  codecName: string;
  width: number;
  height: number;
  pixelFormat?: string;
  durationSeconds?: number;
  alphaMode?: string;
};

type AlphaPlaneSample = {
  frame: number;
  width: number;
  height: number;
  pixels: number;
  transparentPixels: number;
  visiblePixels: number;
  minAlpha: number;
  maxAlpha: number;
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

type RgbaColor = {
  r: number;
  g: number;
  b: number;
  a: number;
};

export async function exportMgVideoAsset(
  options: ExportMgVideoAssetOptions,
): Promise<ExportMgVideoAssetResult> {
  const cwd = resolve(options.cwd);
  const specPath = resolveProjectPath(cwd, options.specPath, "spec");
  const spec = MgCompositionSpecSchema.parse(JSON.parse(await readFile(specPath, "utf8")));
  const outputPath = resolveProjectPath(
    cwd,
    options.outPath ?? join("assets", "overlays", `${spec.id}.webm`),
    "output",
  );
  const format = inferVideoFormat(outputPath);
  const assetsPath = resolveProjectPath(cwd, options.assetsPath ?? join("assets", "manifest.json"), "asset manifest");
  const ffmpegPath = options.ffmpegPath ?? process.env.CLASH_FFMPEG_PATH ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  const ffprobePath = options.ffprobePath ?? process.env.CLASH_FFPROBE_PATH ?? process.env.FFPROBE_PATH ?? "ffprobe";

  await mkdir(dirname(outputPath), { recursive: true });
  await encodeMgVideo({ spec, outputPath, format, ffmpegPath });
  const probe = await probeVideo({ outputPath, ffprobePath });
  assertProbeMatchesSpec(spec, probe);
  const alphaSample = shouldSampleAlpha(format, spec.background)
    ? await sampleDecodedAlphaPlane({
        outputPath,
        ffmpegPath,
        width: spec.width,
        height: spec.height,
      })
    : undefined;

  const exportManifestPath = `${outputPath}.manifest.json`;
  const alphaValidation = buildAlphaValidation({
    format,
    background: spec.background,
    probe,
    sample: alphaSample,
  });
  const exportManifest = {
    kind: "clash.mg.video-export",
    compositionId: spec.id,
    sourceSpecPath: toProjectPath(cwd, specPath),
    outputPath: toProjectPath(cwd, outputPath),
    format,
    fps: spec.fps,
    durationInFrames: spec.durationInFrames,
    durationSeconds: spec.durationInFrames / spec.fps,
    dimensions: { width: spec.width, height: spec.height },
    renderer: {
      kind: "first-party-rgba-rasterizer",
      externalRuntime: false,
      ffmpeg: basename(ffmpegPath),
    },
    alpha: alphaValidation,
    probe,
    limitations: [
      "text is rendered with a deterministic first-party bitmap font",
      "rotation is rejected until the rasterizer supports it",
    ],
  };
  await writeJson(exportManifestPath, exportManifest);

  const assetManifest = await readAssetManifest(assetsPath);
  const assetEntry: ProductionAssetManifestAsset = {
    id: options.assetId,
    type: "overlay-video",
    path: toProjectPath(cwd, outputPath),
    metadata: {
      "mg.video-export": exportManifest,
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
    outputPath,
    format,
    probe,
  };
}

async function encodeMgVideo(options: {
  spec: MgCompositionSpec;
  outputPath: string;
  format: "webm" | "mp4";
  ffmpegPath: string;
}): Promise<void> {
  const { spec, outputPath, format, ffmpegPath } = options;
  const args = [
    "-y",
    "-v",
    "error",
    "-f",
    "rawvideo",
    "-pixel_format",
    "rgba",
    "-video_size",
    `${spec.width}x${spec.height}`,
    "-framerate",
    String(spec.fps),
    "-i",
    "pipe:0",
    "-an",
  ];
  if (format === "webm") {
    args.push("-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", outputPath);
  } else {
    args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", outputPath);
  }

  const proc = spawn(ffmpegPath, args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  proc.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const closePromise = new Promise<number | null>((resolveClose, rejectClose) => {
    proc.on("error", (error) => rejectClose(new Error(`ffmpeg spawn failed: ${error.message}`)));
    proc.on("close", (code) => resolveClose(code));
  });

  try {
    for (let frame = 0; frame < spec.durationInFrames; frame += 1) {
      const buffer = renderMgFrameRgba(spec, frame);
      if (!proc.stdin.write(buffer)) {
        await once(proc.stdin, "drain");
      }
    }
    proc.stdin.end();
  } catch (error) {
    proc.stdin.destroy();
    proc.kill("SIGTERM");
    throw error;
  }

  const code = await closePromise;
  if (code !== 0) {
    throw new Error(`ffmpeg exited ${code}: ${stderr.slice(-800)}`);
  }
}

function renderMgFrameRgba(spec: MgCompositionSpec, frame: number): Buffer {
  const buffer = Buffer.alloc(spec.width * spec.height * 4);
  if (spec.background !== "transparent") {
    fillRect(buffer, spec.width, spec.height, 0, 0, spec.width, spec.height, parseCssColor(spec.background));
  }

  for (const layer of spec.layers.slice().sort((a, b) => a.zIndex - b.zIndex)) {
    if (frame < layer.from || frame >= layer.from + layer.durationInFrames) continue;
    const style = evaluateMgLayerAtFrame(layer, frame);
    if (style.rotation !== 0) {
      throw new Error(`MG video export does not support rotation yet (layer ${layer.id})`);
    }
    if (layer.type === "shape") {
      drawShapeLayer(buffer, spec.width, spec.height, layer, style);
    } else {
      drawTextLayer(buffer, spec.width, spec.height, layer, style);
    }
  }
  return buffer;
}

function drawShapeLayer(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  layer: Extract<MgCompositionLayer, { type: "shape" }>,
  style: ReturnType<typeof evaluateMgLayerAtFrame>,
): void {
  const color = withOpacity(parseCssColor(layer.fill), style.opacity);
  const width = Math.max(1, Math.round((layer.width ?? layer.height ?? 1) * style.scale));
  const height = Math.max(1, Math.round((layer.height ?? layer.width ?? 1) * style.scale));
  const x = Math.round(style.x);
  const y = Math.round(style.y);
  const radius = Math.max(0, Math.round(layer.radius * style.scale));

  if (layer.shape === "circle") {
    const rx = width / 2;
    const ry = height / 2;
    for (let py = 0; py < height; py += 1) {
      for (let px = 0; px < width; px += 1) {
        const nx = (px + 0.5 - rx) / rx;
        const ny = (py + 0.5 - ry) / ry;
        if (nx * nx + ny * ny <= 1) blendPixel(buffer, canvasWidth, canvasHeight, x + px, y + py, color);
      }
    }
    return;
  }

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      if (layer.shape === "rounded-rect" && !insideRoundedRect(px, py, width, height, radius)) continue;
      blendPixel(buffer, canvasWidth, canvasHeight, x + px, y + py, color);
    }
  }
}

function drawTextLayer(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  layer: Extract<MgCompositionLayer, { type: "text" }>,
  style: ReturnType<typeof evaluateMgLayerAtFrame>,
): void {
  const color = withOpacity(parseCssColor(layer.color), style.opacity);
  const scale = Math.max(1, Math.round((layer.fontSize * style.scale) / 7));
  const lineHeight = Math.round(8 * scale);
  const lines = layer.text.split(/\r?\n/);
  const x = Math.round(style.x);
  let y = Math.round(style.y);

  for (const line of lines) {
    const width = measureBitmapText(line, scale, layer.letterSpacing);
    const alignedX = layer.align === "center" ? x - Math.round(width / 2) : layer.align === "right" ? x - width : x;
    drawBitmapText(buffer, canvasWidth, canvasHeight, line, alignedX, y, scale, layer.letterSpacing, color);
    y += lineHeight;
  }
}

function drawBitmapText(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  text: string,
  x: number,
  y: number,
  scale: number,
  letterSpacing: number,
  color: RgbaColor,
): void {
  let cursor = x;
  for (const rawChar of text) {
    const char = rawChar.toUpperCase();
    const glyph = FONT_5X7[char] ?? FONT_5X7["?"];
    for (let gy = 0; gy < glyph.length; gy += 1) {
      for (let gx = 0; gx < glyph[gy].length; gx += 1) {
        if (glyph[gy][gx] !== "1") continue;
        fillRect(buffer, canvasWidth, canvasHeight, cursor + gx * scale, y + gy * scale, scale, scale, color);
      }
    }
    cursor += Math.round(6 * scale + letterSpacing);
  }
}

function measureBitmapText(text: string, scale: number, letterSpacing: number): number {
  if (text.length === 0) return 0;
  return Math.max(0, Math.round(text.length * 6 * scale + (text.length - 1) * letterSpacing - scale));
}

function insideRoundedRect(x: number, y: number, width: number, height: number, radius: number): boolean {
  if (radius <= 0) return true;
  const clampedRadius = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2));
  const left = x < clampedRadius;
  const right = x >= width - clampedRadius;
  const top = y < clampedRadius;
  const bottom = y >= height - clampedRadius;
  if (!(left || right) || !(top || bottom)) return true;
  const cx = left ? clampedRadius : width - clampedRadius - 1;
  const cy = top ? clampedRadius : height - clampedRadius - 1;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= clampedRadius * clampedRadius;
}

function fillRect(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  color: RgbaColor,
): void {
  const startX = Math.max(0, Math.floor(x));
  const startY = Math.max(0, Math.floor(y));
  const endX = Math.min(canvasWidth, Math.ceil(x + width));
  const endY = Math.min(canvasHeight, Math.ceil(y + height));
  for (let py = startY; py < endY; py += 1) {
    for (let px = startX; px < endX; px += 1) {
      blendPixel(buffer, canvasWidth, canvasHeight, px, py, color);
    }
  }
}

function blendPixel(
  buffer: Buffer,
  canvasWidth: number,
  canvasHeight: number,
  x: number,
  y: number,
  source: RgbaColor,
): void {
  if (x < 0 || y < 0 || x >= canvasWidth || y >= canvasHeight || source.a <= 0) return;
  const index = (y * canvasWidth + x) * 4;
  const srcA = source.a / 255;
  const dstA = buffer[index + 3] / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) {
    buffer[index] = 0;
    buffer[index + 1] = 0;
    buffer[index + 2] = 0;
    buffer[index + 3] = 0;
    return;
  }
  buffer[index] = Math.round((source.r * srcA + buffer[index] * dstA * (1 - srcA)) / outA);
  buffer[index + 1] = Math.round((source.g * srcA + buffer[index + 1] * dstA * (1 - srcA)) / outA);
  buffer[index + 2] = Math.round((source.b * srcA + buffer[index + 2] * dstA * (1 - srcA)) / outA);
  buffer[index + 3] = Math.round(outA * 255);
}

function parseCssColor(value: string): RgbaColor {
  const trimmed = value.trim();
  if (trimmed === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const short = trimmed.match(/^#([0-9a-f]{3})$/i);
  if (short) {
    return {
      r: Number.parseInt(short[1][0] + short[1][0], 16),
      g: Number.parseInt(short[1][1] + short[1][1], 16),
      b: Number.parseInt(short[1][2] + short[1][2], 16),
      a: 255,
    };
  }
  const long = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (long) {
    return {
      r: Number.parseInt(long[1].slice(0, 2), 16),
      g: Number.parseInt(long[1].slice(2, 4), 16),
      b: Number.parseInt(long[1].slice(4, 6), 16),
      a: 255,
    };
  }
  throw new Error(`Unsupported color ${value}; use #RGB, #RRGGBB, or transparent`);
}

function withOpacity(color: RgbaColor, opacity: number): RgbaColor {
  return { ...color, a: Math.round(color.a * Math.max(0, Math.min(1, opacity))) };
}

async function probeVideo(options: { outputPath: string; ffprobePath: string }): Promise<VideoProbeResult> {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "stream=codec_name,width,height,pix_fmt,duration:stream_tags=alpha_mode:format=duration",
    "-of",
    "json",
    options.outputPath,
  ];
  const proc = spawn(options.ffprobePath, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  proc.stdout?.on("data", (chunk) => {
    stdout += String(chunk);
  });
  proc.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolveClose, rejectClose) => {
    proc.on("error", (error) => rejectClose(new Error(`ffprobe spawn failed: ${error.message}`)));
    proc.on("close", (closeCode) => resolveClose(closeCode));
  });
  if (code !== 0) {
    throw new Error(`ffprobe exited ${code}: ${stderr.slice(-800)}`);
  }
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      codec_name?: string;
      width?: number;
      height?: number;
      pix_fmt?: string;
      duration?: string;
      tags?: { alpha_mode?: string };
    }>;
    format?: { duration?: string };
  };
  const stream = parsed.streams?.[0];
  if (!stream?.codec_name || typeof stream.width !== "number" || typeof stream.height !== "number") {
    throw new Error(`ffprobe did not return a video stream for ${options.outputPath}`);
  }
  const durationSeconds = Number(stream.duration ?? parsed.format?.duration);
  return {
    codecName: stream.codec_name,
    width: stream.width,
    height: stream.height,
    pixelFormat: stream.pix_fmt,
    durationSeconds: Number.isFinite(durationSeconds) ? durationSeconds : undefined,
    alphaMode: stream.tags?.alpha_mode,
  };
}

function buildAlphaValidation(options: {
  format: "webm" | "mp4";
  background: string;
  probe: VideoProbeResult;
  sample?: AlphaPlaneSample;
}): {
  requested: boolean;
  verified: boolean;
  mode: "vp9-alpha-mode" | "not-requested" | "unsupported-format" | "missing-alpha-mode";
  pixelSampleVerified: boolean;
  reason: string;
  sample?: AlphaPlaneSample;
} {
  const requested = options.format === "webm" && options.background === "transparent";
  if (!requested) {
    return {
      requested: false,
      verified: false,
      mode: options.format === "webm" ? "not-requested" : "unsupported-format",
      pixelSampleVerified: false,
      reason: options.format === "webm"
        ? "composition background is not transparent"
        : "MP4 export does not carry alpha in this local exporter",
    };
  }
  if (options.probe.codecName === "vp9" && options.probe.alphaMode === "1") {
    const sampleVerified = Boolean(
      options.sample &&
      options.sample.transparentPixels > 0 &&
      options.sample.visiblePixels > 0,
    );
    return {
      requested: true,
      verified: sampleVerified,
      mode: "vp9-alpha-mode",
      pixelSampleVerified: sampleVerified,
      reason: sampleVerified
        ? "ffprobe reported VP9 alpha_mode=1 and decoded alpha-plane samples contain transparent and visible pixels"
        : "ffprobe reported VP9 alpha_mode=1 but decoded alpha-plane samples did not prove transparency",
      ...(options.sample ? { sample: options.sample } : {}),
    };
  }
  return {
    requested: true,
    verified: false,
    mode: "missing-alpha-mode",
    pixelSampleVerified: false,
    reason: "transparent WebM export did not report VP9 alpha_mode=1",
  };
}

function shouldSampleAlpha(format: "webm" | "mp4", background: string): boolean {
  return format === "webm" && background === "transparent";
}

async function sampleDecodedAlphaPlane(options: {
  outputPath: string;
  ffmpegPath: string;
  width: number;
  height: number;
}): Promise<AlphaPlaneSample> {
  const args = [
    "-v",
    "error",
    "-c:v",
    "libvpx-vp9",
    "-i",
    options.outputPath,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "pipe:1",
  ];
  const proc = spawn(options.ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  let stderr = "";
  proc.stdout?.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  proc.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });
  const code = await new Promise<number | null>((resolveClose, rejectClose) => {
    proc.on("error", (error) => rejectClose(new Error(`ffmpeg alpha-plane decode failed: ${error.message}`)));
    proc.on("close", (closeCode) => resolveClose(closeCode));
  });
  if (code !== 0) {
    throw new Error(`ffmpeg alpha-plane decode exited ${code}: ${stderr.slice(-800)}`);
  }

  const frame = Buffer.concat(chunks);
  const expectedBytes = options.width * options.height * 4;
  if (frame.length < expectedBytes) {
    throw new Error(`ffmpeg alpha-plane decode returned ${frame.length} bytes, expected ${expectedBytes}`);
  }

  let transparentPixels = 0;
  let visiblePixels = 0;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let index = 3; index < expectedBytes; index += 4) {
    const alpha = frame[index];
    minAlpha = Math.min(minAlpha, alpha);
    maxAlpha = Math.max(maxAlpha, alpha);
    if (alpha <= 5) transparentPixels += 1;
    if (alpha >= 32) visiblePixels += 1;
  }

  return {
    frame: 0,
    width: options.width,
    height: options.height,
    pixels: options.width * options.height,
    transparentPixels,
    visiblePixels,
    minAlpha,
    maxAlpha,
  };
}

function assertProbeMatchesSpec(spec: MgCompositionSpec, probe: VideoProbeResult): void {
  if (probe.width !== spec.width || probe.height !== spec.height) {
    throw new Error(`Exported video dimensions ${probe.width}x${probe.height} do not match ${spec.width}x${spec.height}`);
  }
  const expectedDuration = spec.durationInFrames / spec.fps;
  if (probe.durationSeconds !== undefined && Math.abs(probe.durationSeconds - expectedDuration) > 1 / spec.fps + 0.05) {
    throw new Error(`Exported video duration ${probe.durationSeconds}s does not match expected ${expectedDuration}s`);
  }
}

function inferVideoFormat(path: string): "webm" | "mp4" {
  const extension = extname(path).toLowerCase();
  if (extension === ".webm") return "webm";
  if (extension === ".mp4") return "mp4";
  throw new Error("output path must end in .webm or .mp4");
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

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const FONT_5X7: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "?": ["11110", "00001", "00001", "00110", "00100", "00000", "00100"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
};
