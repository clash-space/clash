import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  AdDeliverySpecProjectionSchema,
  type AdVisualQaCheck,
} from "@clash/shared-types";

export type AnalyzeAdVisualPixelsOptions = {
  cwd: string;
  targetAssetId: string;
  deliverySpecPath: string;
  variantId: string;
  renderedPath: string;
  packshotFramePath: string;
  packshotColor: string;
  endCardFramePath: string;
  finalFramePath: string;
  outPath?: string;
  packshotMinCoverage?: number;
  colorTolerance?: number;
  finalFrameMaxMeanDiff?: number;
};

export type AnalyzeAdVisualPixelsResult = {
  analyzed: true;
  targetAssetId: string;
  variantId: string;
  evidencePath: string;
  checks: number;
  pixelSamples: number;
};

type Rgb = { r: number; g: number; b: number };

type PpmImage = {
  width: number;
  height: number;
  pixels: Rgb[];
};

type PixelSample = {
  id: string;
  path: string;
  width: number;
  height: number;
  averageRgb: string;
  matchedPixels?: number;
  matchRatio?: number;
  meanAbsoluteDiff?: number;
};

type AdVisualPixelEvidence = {
  schemaVersion: 1;
  kind: "clash.ad.visual-pixel-evidence";
  targetAssetId: string;
  variantId: string;
  renderedPath: string;
  analysisBackend: {
    id: "clash-local-ad-pixel-analyzer";
    inputFormat: "ppm";
    capabilities: Array<"packshot-color-sample" | "end-card-sample" | "final-frame-diff">;
  };
  checks: AdVisualQaCheck[];
  pixelSamples: PixelSample[];
};

export async function analyzeAdVisualPixels(
  options: AnalyzeAdVisualPixelsOptions,
): Promise<AnalyzeAdVisualPixelsResult> {
  const cwd = resolve(options.cwd);
  const targetAssetId = requireNonEmpty(options.targetAssetId, "target asset id");
  const deliverySpecPath = resolveProjectPath(cwd, options.deliverySpecPath, "delivery spec");
  const deliverySpec = AdDeliverySpecProjectionSchema.parse(
    JSON.parse(await readFile(deliverySpecPath, "utf8")),
  );
  if (deliverySpec.targetAssetId !== targetAssetId) {
    throw new Error(`delivery spec target ${deliverySpec.targetAssetId} does not match ${targetAssetId}`);
  }
  const variant = deliverySpec.variants.find((item) => item.id === options.variantId);
  if (!variant) throw new Error(`delivery spec does not include variant ${options.variantId}`);

  const renderedPath = normalizeProjectRelativePath(options.renderedPath, "rendered path");
  const packshotFramePath = normalizeProjectRelativePath(options.packshotFramePath, "packshot frame");
  const endCardFramePath = normalizeProjectRelativePath(options.endCardFramePath, "end-card frame");
  const finalFramePath = normalizeProjectRelativePath(options.finalFramePath, "final frame");
  const packshotImage = await readPpm(resolveProjectPath(cwd, packshotFramePath, "packshot frame"));
  const endCardImage = await readPpm(resolveProjectPath(cwd, endCardFramePath, "end-card frame"));
  const finalFrameImage = await readPpm(resolveProjectPath(cwd, finalFramePath, "final frame"));
  assertSameDimensions(endCardImage, finalFrameImage, "end-card frame", "final frame");

  const targetColor = parseHexColor(options.packshotColor);
  const colorTolerance = clamp(options.colorTolerance ?? 18, 0, 255);
  const minCoverage = clamp(options.packshotMinCoverage ?? 0.5, 0, 1);
  const finalFrameMaxMeanDiff = clamp(options.finalFrameMaxMeanDiff ?? 2, 0, 255);
  const packshotMatch = countColorMatches(packshotImage, targetColor, colorTolerance);
  const packshotRatio = packshotMatch / packshotImage.pixels.length;
  const roundedPackshotRatio = round(packshotRatio);
  const finalDiff = round(meanAbsoluteRgbDiff(endCardImage, finalFrameImage));

  const checks: AdVisualQaCheck[] = [
    {
      id: "packshot-visible",
      check: "packshot-visible",
      status: packshotRatio >= minCoverage ? "pass" : "fail",
      required: true,
      expected: `${percent(minCoverage)} pixels match ${options.packshotColor.toLowerCase()} within tolerance ${colorTolerance}`,
      actual: `${percent(packshotRatio)} pixels matched ${options.packshotColor.toLowerCase()} within tolerance ${colorTolerance}`,
      confidence: roundedPackshotRatio,
      frame: Math.floor((deliverySpec.packshot.startFrame + deliverySpec.packshot.endFrame) / 2),
      evidencePath: packshotFramePath,
    },
    {
      id: "end-card-visible",
      check: "end-card-visible",
      status: "pass",
      required: true,
      expected: "end-card sample frame is readable",
      actual: `end-card frame ${endCardImage.width}x${endCardImage.height} average ${averageRgbHex(endCardImage)}`,
      confidence: 1,
      frame: Math.max(0, Math.round(variant.durationSeconds * deliverySpec.fps) - deliverySpec.endCard.durationFrames),
      evidencePath: endCardFramePath,
    },
    {
      id: "final-frame-hold",
      check: "final-frame-hold",
      status: finalDiff <= finalFrameMaxMeanDiff ? "pass" : "fail",
      required: true,
      expected: `final frame mean absolute RGB diff <= ${finalFrameMaxMeanDiff}`,
      actual: `mean absolute RGB diff ${finalDiff}`,
      confidence: round(Math.max(0, 1 - finalDiff / 255)),
      frame: Math.max(0, Math.round(variant.durationSeconds * deliverySpec.fps) - 1),
      evidencePath: finalFramePath,
    },
  ];

  const evidence: AdVisualPixelEvidence = {
    schemaVersion: 1,
    kind: "clash.ad.visual-pixel-evidence",
    targetAssetId,
    variantId: variant.id,
    renderedPath,
    analysisBackend: {
      id: "clash-local-ad-pixel-analyzer",
      inputFormat: "ppm",
      capabilities: ["packshot-color-sample", "end-card-sample", "final-frame-diff"],
    },
    checks,
    pixelSamples: [
      {
        id: "packshot-frame",
        path: packshotFramePath,
        width: packshotImage.width,
        height: packshotImage.height,
        averageRgb: averageRgbHex(packshotImage),
        matchedPixels: packshotMatch,
        matchRatio: roundedPackshotRatio,
      },
      {
        id: "end-card-frame",
        path: endCardFramePath,
        width: endCardImage.width,
        height: endCardImage.height,
        averageRgb: averageRgbHex(endCardImage),
      },
      {
        id: "final-frame",
        path: finalFramePath,
        width: finalFrameImage.width,
        height: finalFrameImage.height,
        averageRgb: averageRgbHex(finalFrameImage),
        meanAbsoluteDiff: finalDiff,
      },
    ],
  };
  const evidencePath = resolveProjectPath(
    cwd,
    options.outPath ?? join("analysis", "visual", `${safeSlug(variant.id)}.pixel-evidence.json`),
    "ad visual pixel evidence",
  );
  await writeJson(evidencePath, evidence);
  return {
    analyzed: true,
    targetAssetId,
    variantId: variant.id,
    evidencePath,
    checks: checks.length,
    pixelSamples: evidence.pixelSamples.length,
  };
}

async function readPpm(path: string): Promise<PpmImage> {
  const buffer = await readFile(path);
  let cursor = 0;
  const magic = readPpmToken(buffer, cursor);
  cursor = magic.nextOffset;
  if (magic.value !== "P3" && magic.value !== "P6") {
    throw new Error(`${path} must be a P3 or P6 PPM image`);
  }
  const widthToken = readPpmToken(buffer, cursor);
  cursor = widthToken.nextOffset;
  const heightToken = readPpmToken(buffer, cursor);
  cursor = heightToken.nextOffset;
  const maxToken = readPpmToken(buffer, cursor);
  cursor = maxToken.nextOffset;
  const width = parsePositiveInteger(widthToken.value, `${path} width`);
  const height = parsePositiveInteger(heightToken.value, `${path} height`);
  const max = parsePositiveInteger(maxToken.value, `${path} max color`);
  if (max !== 255) throw new Error(`${path} must use max color 255`);
  cursor = skipPpmWhitespaceAndComments(buffer, cursor);
  const pixelCount = width * height;
  const pixels: Rgb[] = [];
  if (magic.value === "P3") {
    const values = stripPpmComments(buffer.toString("utf8", cursor)).trim().split(/\s+/).filter(Boolean);
    if (values.length < pixelCount * 3) {
      throw new Error(`${path} does not contain enough PPM pixel values`);
    }
    for (let index = 0; index < pixelCount; index++) {
      pixels.push({
        r: parseColorChannel(values[index * 3], path),
        g: parseColorChannel(values[index * 3 + 1], path),
        b: parseColorChannel(values[index * 3 + 2], path),
      });
    }
  } else {
    const expectedBytes = pixelCount * 3;
    if (buffer.length - cursor < expectedBytes) {
      throw new Error(`${path} does not contain enough P6 pixel data`);
    }
    for (let index = 0; index < pixelCount; index++) {
      const offset = cursor + index * 3;
      pixels.push({ r: buffer[offset], g: buffer[offset + 1], b: buffer[offset + 2] });
    }
  }
  return { width, height, pixels };
}

function readPpmToken(buffer: Buffer, offset: number): { value: string; nextOffset: number } {
  let cursor = skipPpmWhitespaceAndComments(buffer, offset);
  const start = cursor;
  while (cursor < buffer.length && !isWhitespace(buffer[cursor])) {
    cursor++;
  }
  if (cursor === start) throw new Error("Invalid PPM header");
  return { value: buffer.toString("ascii", start, cursor), nextOffset: cursor };
}

function skipPpmWhitespaceAndComments(buffer: Buffer, offset: number): number {
  let cursor = offset;
  while (cursor < buffer.length) {
    while (cursor < buffer.length && isWhitespace(buffer[cursor])) cursor++;
    if (buffer[cursor] !== 35) break;
    while (cursor < buffer.length && buffer[cursor] !== 10) cursor++;
  }
  return cursor;
}

function stripPpmComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/#.*/, ""))
    .join("\n");
}

function isWhitespace(byte: number): boolean {
  return byte === 9 || byte === 10 || byte === 13 || byte === 32;
}

function parseColorChannel(value: string | undefined, path: string): number {
  if (value === undefined) throw new Error(`${path} missing color channel`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error(`${path} has invalid color channel ${value}`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function parseHexColor(value: string): Rgb {
  const match = value.trim().match(/^#([a-f0-9]{2})([a-f0-9]{2})([a-f0-9]{2})$/i);
  if (!match) throw new Error("packshot color must be a #rrggbb value");
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16),
  };
}

function countColorMatches(image: PpmImage, target: Rgb, tolerance: number): number {
  return image.pixels.filter((pixel) =>
    Math.abs(pixel.r - target.r) <= tolerance
    && Math.abs(pixel.g - target.g) <= tolerance
    && Math.abs(pixel.b - target.b) <= tolerance
  ).length;
}

function meanAbsoluteRgbDiff(a: PpmImage, b: PpmImage): number {
  let total = 0;
  for (let index = 0; index < a.pixels.length; index++) {
    total += Math.abs(a.pixels[index].r - b.pixels[index].r);
    total += Math.abs(a.pixels[index].g - b.pixels[index].g);
    total += Math.abs(a.pixels[index].b - b.pixels[index].b);
  }
  return total / (a.pixels.length * 3);
}

function averageRgbHex(image: PpmImage): string {
  const total = image.pixels.reduce((sum, pixel) => ({
    r: sum.r + pixel.r,
    g: sum.g + pixel.g,
    b: sum.b + pixel.b,
  }), { r: 0, g: 0, b: 0 });
  return rgbToHex({
    r: Math.round(total.r / image.pixels.length),
    g: Math.round(total.g / image.pixels.length),
    b: Math.round(total.b / image.pixels.length),
  });
}

function rgbToHex(color: Rgb): string {
  return `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function assertSameDimensions(a: PpmImage, b: PpmImage, aLabel: string, bLabel: string): void {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`${aLabel} dimensions ${a.width}x${a.height} do not match ${bLabel} ${b.width}x${b.height}`);
  }
}

function percent(value: number): string {
  return `${round(value * 100)}%`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function requireNonEmpty(value: unknown, label: string): string {
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

function normalizeProjectRelativePath(path: string, label: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
    throw new Error(`${label} must be a local project-relative path, not a URL`);
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

function isInsideOrEqual(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function safeSlug(value: string): string {
  const slug = value
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "ad-visual-pixels";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
