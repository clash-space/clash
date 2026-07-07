import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { AdDeliverySpecProjectionSchema } from "@clash/shared-types";

export type ExtractAdVisualFramesOptions = {
  cwd: string;
  targetAssetId: string;
  deliverySpecPath: string;
  variantId: string;
  renderedPath: string;
  packshotFrame: number;
  endCardFrame: number;
  finalFrame: number;
  outDir?: string;
  manifestPath?: string;
  ffmpegPath?: string;
};

export type ExtractAdVisualFramesResult = {
  extracted: true;
  targetAssetId: string;
  variantId: string;
  manifestPath: string;
  samples: number;
};

type FrameSample = {
  id: "packshot-frame" | "end-card-frame" | "final-frame";
  role: "packshot" | "end-card" | "final-frame";
  frame: number;
  path: string;
  format: "ppm";
};

type AdVisualFrameExtractionManifest = {
  schemaVersion: 1;
  kind: "clash.ad.visual-frame-extraction";
  targetAssetId: string;
  variantId: string;
  renderedPath: string;
  extractor: {
    id: "ffmpeg";
    command: "ffmpeg";
  };
  samples: FrameSample[];
  decisionLog: string[];
};

export async function extractAdVisualFrames(
  options: ExtractAdVisualFramesOptions,
): Promise<ExtractAdVisualFramesResult> {
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
  const renderedFullPath = resolveProjectPath(cwd, renderedPath, "rendered media");
  const outDir = normalizeProjectRelativePath(
    options.outDir ?? join("analysis", "visual", "frames", safeSlug(variant.id)),
    "output directory",
  );
  const samples: FrameSample[] = [
    {
      id: "packshot-frame",
      role: "packshot",
      frame: assertNonNegativeInteger(options.packshotFrame, "packshot frame"),
      path: joinProjectPath(outDir, "packshot.ppm"),
      format: "ppm",
    },
    {
      id: "end-card-frame",
      role: "end-card",
      frame: assertNonNegativeInteger(options.endCardFrame, "end-card frame"),
      path: joinProjectPath(outDir, "end-card.ppm"),
      format: "ppm",
    },
    {
      id: "final-frame",
      role: "final-frame",
      frame: assertNonNegativeInteger(options.finalFrame, "final frame"),
      path: joinProjectPath(outDir, "final.ppm"),
      format: "ppm",
    },
  ];
  const ffmpeg = options.ffmpegPath ?? process.env.CLASH_FFMPEG_PATH ?? process.env.FFMPEG_PATH ?? "ffmpeg";
  for (const sample of samples) {
    await extractFrame({
      cwd,
      ffmpeg,
      renderedFullPath,
      frame: sample.frame,
      outputFullPath: resolveProjectPath(cwd, sample.path, `${sample.id} output`),
    });
  }

  const manifestRelativePath = normalizeProjectRelativePath(
    options.manifestPath ?? join("analysis", "visual", `${safeSlug(variant.id)}.frame-extraction.json`),
    "frame extraction manifest",
  );
  const manifestPath = resolveProjectPath(cwd, manifestRelativePath, "frame extraction manifest");
  const manifest: AdVisualFrameExtractionManifest = {
    schemaVersion: 1,
    kind: "clash.ad.visual-frame-extraction",
    targetAssetId,
    variantId: variant.id,
    renderedPath,
    extractor: {
      id: "ffmpeg",
      command: "ffmpeg",
    },
    samples,
    decisionLog: [
      `extracted ${samples.length} visual frame sample(s) from ${renderedPath}`,
      "wrote PPM samples for downstream clash-local-ad-pixel-analyzer",
    ],
  };
  await writeJson(manifestPath, manifest);
  return {
    extracted: true,
    targetAssetId,
    variantId: variant.id,
    manifestPath,
    samples: samples.length,
  };
}

async function extractFrame(options: {
  cwd: string;
  ffmpeg: string;
  renderedFullPath: string;
  frame: number;
  outputFullPath: string;
}): Promise<void> {
  await mkdir(dirname(options.outputFullPath), { recursive: true });
  const filter = `select=eq(n\\,${options.frame}),format=rgb24`;
  const args = [
    "-y",
    "-i",
    options.renderedFullPath,
    "-vf",
    filter,
    "-frames:v",
    "1",
    "-f",
    "image2",
    options.outputFullPath,
  ];
  await runFfmpeg(options.ffmpeg, args);
  if (!existsSync(options.outputFullPath)) {
    throw new Error(`ffmpeg did not create frame sample ${options.outputFullPath}`);
  }
}

async function runFfmpeg(ffmpeg: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => reject(new Error(`ffmpeg frame extraction spawn failed: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`ffmpeg frame extraction failed with exit code ${code}: ${stderr.trim().slice(-800)}`));
    });
  });
}

function assertNonNegativeInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
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

function joinProjectPath(...parts: string[]): string {
  return parts.flatMap((part) => part.split(/[\\/]+/).filter(Boolean)).join("/");
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
  return slug || "ad-visual-frames";
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
