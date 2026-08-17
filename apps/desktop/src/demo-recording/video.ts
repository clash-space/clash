export interface ScreencastFrame {
  path: string;
  monotonicMs: number;
}

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

export interface EncodedVideoStreamProbe {
  width: number;
  height: number;
  sample_aspect_ratio: string;
}

export function parseEncodedVideoProbe(value: unknown): EncodedVideoStreamProbe {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ffprobe did not return a video stream");
  }
  const streams = (value as { streams?: unknown }).streams;
  const stream = Array.isArray(streams) ? streams[0] : undefined;
  if (!stream || typeof stream !== "object" || Array.isArray(stream)) {
    throw new Error("ffprobe did not return a video stream");
  }
  const { width, height, sample_aspect_ratio: sampleAspectRatio } = stream as {
    width?: unknown;
    height?: unknown;
    sample_aspect_ratio?: unknown;
  };
  if (
    !Number.isSafeInteger(width) ||
    Number(width) < 1 ||
    !Number.isSafeInteger(height) ||
    Number(height) < 1 ||
    typeof sampleAspectRatio !== "string" ||
    sampleAspectRatio.length === 0
  ) {
    throw new Error("ffprobe returned an incomplete video stream");
  }
  return {
    width: Number(width),
    height: Number(height),
    sample_aspect_ratio: sampleAspectRatio,
  };
}

export async function probeEncodedVideoStream(options: {
  ffprobePath: string;
  videoPath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<EncodedVideoStreamProbe> {
  if (!options.ffprobePath.trim()) {
    throw new Error("ffprobe path must not be empty");
  }
  if (!options.videoPath.trim()) {
    throw new Error("video path must not be empty");
  }
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("ffprobe timeout must be positive and finite");
  }
  if (options.signal?.aborted) throw options.signal.reason;

  const stdout = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      options.ffprobePath,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,sample_aspect_ratio",
        "-of",
        "json",
        options.videoPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errorOutput = "";
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve(output);
      else reject(error);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(options.signal?.reason ?? new Error("ffprobe aborted"));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`ffprobe timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (output.length < 64_000) output += chunk.slice(0, 64_000 - output.length);
    });
    child.stderr.on("data", (chunk: string) => {
      if (errorOutput.length < 64_000) {
        errorOutput += chunk.slice(0, 64_000 - errorOutput.length);
      }
    });
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `ffprobe failed (${signal ? `signal ${signal}` : `exit ${String(code)}`}): ${errorOutput.trim()}`,
          ),
        );
      }
    });
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("ffprobe returned invalid JSON");
  }
  return parseEncodedVideoProbe(parsed);
}

export function evaluateEncodedVideoContract(options: {
  viewport: { width: number; height: number };
  stream: EncodedVideoStreamProbe;
}): string[] {
  const { viewport, stream } = options;
  if (
    stream.width === viewport.width &&
    stream.height === viewport.height &&
    stream.sample_aspect_ratio === "1:1"
  ) {
    return [];
  }
  return [
    `recording video must be ${viewport.width}x${viewport.height} with square pixels; observed ${stream.width}x${stream.height}, SAR ${stream.sample_aspect_ratio}`,
  ];
}

function escapeConcatPath(path: string): string {
  return path.replaceAll("'", "'\\''");
}

export function buildConcatManifest(frames: readonly ScreencastFrame[], endMs: number): string {
  if (frames.length === 0) throw new Error("cannot build a video without screencast frames");
  if (!Number.isFinite(endMs)) throw new Error("video end time must be finite");

  const lines = ["ffconcat version 1.0"];
  for (const [index, frame] of frames.entries()) {
    if (!Number.isFinite(frame.monotonicMs) || frame.monotonicMs < 0) {
      throw new Error(`invalid timestamp for screencast frame ${index}`);
    }
    const nextTime = frames[index + 1]?.monotonicMs ?? endMs;
    if (!Number.isFinite(nextTime) || nextTime < frame.monotonicMs) {
      throw new Error("screencast frame timestamps must be monotonic");
    }
    const frameStart = index === 0 ? 0 : frame.monotonicMs;
    lines.push(`file '${escapeConcatPath(frame.path)}'`);
    lines.push(`duration ${((nextTime - frameStart) / 1_000).toFixed(6)}`);
  }

  lines.push(`file '${escapeConcatPath(frames.at(-1)!.path)}'`, "");
  return lines.join("\n");
}

export function selectPageTarget(
  targets: readonly CdpTarget[],
  appBaseUrl: string,
): CdpTarget {
  const expectedOrigin = new URL(appBaseUrl).origin;
  const target = targets.find((candidate) => {
    if (candidate.type !== "page" || !candidate.webSocketDebuggerUrl) return false;
    try {
      const url = new URL(candidate.url);
      return (url.protocol === "http:" || url.protocol === "https:") && url.origin === expectedOrigin;
    } catch {
      return false;
    }
  });
  if (!target) {
    throw new Error(`unable to find the Clash page target for ${expectedOrigin}`);
  }
  return target;
}

export function buildFfmpegArgs(
  concatPath: string,
  outputPath: string,
  durationMs: number,
): string[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error("video duration must be positive and finite");
  }
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-safe",
    "0",
    "-f",
    "concat",
    "-i",
    concatPath,
    "-t",
    (durationMs / 1_000).toFixed(6),
    "-vf",
    "scale=trunc(iw/2)*2:trunc(ih/2)*2:in_range=pc:out_range=tv:out_color_matrix=bt709,fps=30,format=yuv420p",
    "-c:v",
    "libx264",
    "-color_range",
    "tv",
    "-colorspace",
    "bt709",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-movflags",
    "+faststart",
    outputPath,
  ];
}

export interface EncodeScreencastOptions {
  frames: readonly ScreencastFrame[];
  endMs: number;
  outputPath: string;
  concatPath?: string;
  ffmpegPath: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function encodeScreencast(options: EncodeScreencastOptions): Promise<{
  outputPath: string;
  concatPath: string;
}> {
  const outputDirectory = dirname(options.outputPath);
  const concatPath = options.concatPath ?? join(outputDirectory, "frames.ffconcat");
  await mkdir(outputDirectory, { recursive: true });
  await mkdir(dirname(concatPath), { recursive: true });
  await writeFile(concatPath, buildConcatManifest(options.frames, options.endMs), "utf8");

  await new Promise<void>((resolve, reject) => {
    const timeoutMs = options.timeoutMs ?? 120_000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      reject(new Error("ffmpeg timeout must be positive and finite"));
      return;
    }
    if (!options.ffmpegPath.trim()) {
      reject(new Error("ffmpeg path must not be empty"));
      return;
    }
    if (options.signal?.aborted) {
      reject(options.signal.reason);
      return;
    }
    const child = spawn(
      options.ffmpegPath,
      buildFfmpegArgs(concatPath, options.outputPath, options.endMs),
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    let stderr = "";
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (error === undefined) resolve();
      else reject(error);
    };
    const abort = () => {
      child.kill("SIGKILL");
      finish(options.signal?.reason ?? new Error("ffmpeg encoding aborted"));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error(`ffmpeg timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 64_000) stderr += chunk.slice(0, 64_000 - stderr.length);
    });
    child.once("error", finish);
    child.once("exit", (code, signal) => {
      if (code === 0) finish();
      else {
        finish(
          new Error(
            `ffmpeg failed (${signal ? `signal ${signal}` : `exit ${String(code)}`}): ${stderr.trim()}`,
          ),
        );
      }
    });
  });

  return { outputPath: options.outputPath, concatPath };
}
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
