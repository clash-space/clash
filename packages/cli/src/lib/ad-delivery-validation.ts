import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  AdDeliveryExportProbeSchema,
  AdDeliverySpecProjectionSchema,
  AdDeliveryVisualQaReportSchema,
  buildAdDeliveryExportValidationReceipt,
  type AdDeliveryExportProbe,
  type AdDeliveryExportValidationReceipt,
} from "@clash/shared-types";
import { resolveAgentFilePathInsideCwd } from "./projection-cas";

export type ValidateAdDeliveryExportOptions = {
  cwd: string;
  deliverySpecPath: string;
  variantId: string;
  renderedPath: string;
  probePath?: string;
  visualReportPath?: string;
  outPath?: string;
  ffprobePath?: string;
};

export type ValidateAdDeliveryExportResult = {
  validated: true;
  targetAssetId: string;
  variantId: string;
  verdict: "pass" | "fail";
  receiptPath: string;
  renderedPath: string;
  checks: number;
};

export async function validateAdDeliveryExport(
  options: ValidateAdDeliveryExportOptions,
): Promise<ValidateAdDeliveryExportResult> {
  const cwd = resolve(options.cwd);
  const deliverySpecPath = resolveProjectPath(cwd, options.deliverySpecPath, "delivery spec");
  const deliverySpec = AdDeliverySpecProjectionSchema.parse(
    JSON.parse(await readFile(deliverySpecPath, "utf8")),
  );
  const renderedProjectPath = normalizeProjectRelativePath(options.renderedPath, "rendered path");
  const renderedAbsolutePath = resolveProjectPath(cwd, renderedProjectPath, "rendered path");
  const probe = options.probePath
    ? AdDeliveryExportProbeSchema.parse(
        JSON.parse(await readFile(resolveProjectPath(cwd, options.probePath, "probe"), "utf8")),
      )
    : await probeRenderedExport({
        outputPath: renderedAbsolutePath,
        ffprobePath: options.ffprobePath ?? process.env.CLASH_FFPROBE_PATH ?? process.env.FFPROBE_PATH ?? "ffprobe",
      });
  const visualQa = options.visualReportPath
    ? AdDeliveryVisualQaReportSchema.parse(
        JSON.parse(await readFile(resolveProjectPath(cwd, options.visualReportPath, "visual report"), "utf8")),
      )
    : undefined;
  const receipt = buildAdDeliveryExportValidationReceipt({
    deliverySpec,
    variantId: options.variantId,
    renderedPath: renderedProjectPath,
    probe,
    visualQa,
  });
  const receiptPath = resolveAgentFilePathInsideCwd({
    cwd,
    filePath: resolveProjectPath(
      cwd,
      options.outPath ?? join("qa", "delivery", `${safeFileStem(options.variantId)}.validation.json`),
      "output",
    ),
    writeVerb: "Ad delivery validation receipt",
  });
  await writeJson(receiptPath, receipt);
  return {
    validated: true,
    targetAssetId: receipt.targetAssetId,
    variantId: receipt.variant.id,
    verdict: receipt.verdict,
    receiptPath,
    renderedPath: receipt.renderedPath,
    checks: receipt.checks.length,
  };
}

async function probeRenderedExport(options: {
  outputPath: string;
  ffprobePath: string;
}): Promise<AdDeliveryExportProbe> {
  const args = [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate",
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
  await new Promise<void>((resolvePromise, reject) => {
    proc.on("error", (error) => reject(new Error(`ffprobe spawn failed: ${error.message}`)));
    proc.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`ffprobe exited ${code}: ${stderr.slice(-800)}`));
    });
  });

  const parsed = JSON.parse(stdout) as {
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      width?: number;
      height?: number;
      duration?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
    format?: { duration?: string };
  };
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");
  if (!video || typeof video.width !== "number" || typeof video.height !== "number") {
    throw new Error(`ffprobe did not report a video stream for ${options.outputPath}`);
  }
  const durationSeconds = Number(parsed.format?.duration ?? video.duration ?? audio?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error(`ffprobe did not report a valid duration for ${options.outputPath}`);
  }
  const fps = parseFrameRate(video.avg_frame_rate) ?? parseFrameRate(video.r_frame_rate);
  if (!fps) {
    throw new Error(`ffprobe did not report a valid frame rate for ${options.outputPath}`);
  }
  return AdDeliveryExportProbeSchema.parse({
    width: video.width,
    height: video.height,
    fps,
    durationSeconds,
    hasVideo: true,
    hasAudio: Boolean(audio),
    ...(video.codec_name ? { videoCodec: video.codec_name } : {}),
    ...(audio?.codec_name ? { audioCodec: audio.codec_name } : {}),
  });
}

function parseFrameRate(value: string | undefined): number | undefined {
  if (!value || value === "0/0") return undefined;
  const parts = value.split("/");
  const parsed = parts.length === 2
    ? Number(parts[0]) / Number(parts[1])
    : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveProjectPath(cwd: string, path: string, label: string): string {
  const resolved = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  const rel = relative(cwd, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new Error(`${label} must stay inside the project cwd`);
  }
  return resolved;
}

function normalizeProjectRelativePath(path: string, label: string): string {
  if (isAbsolute(path)) {
    throw new Error(`${label} must be project-relative`);
  }
  const normalized = path.split(/[\\/]+/).filter(Boolean).join("/");
  if (!normalized || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`${label} must stay inside the project cwd`);
  }
  return normalized;
}

function safeFileStem(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "delivery-export";
}
