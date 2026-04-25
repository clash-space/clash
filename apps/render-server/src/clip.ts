/**
 * Time-range video trim via ffmpeg-static.
 *
 * Counterpart to thumbnail.ts but for the video-clipper edit pipeline.
 * Produces a re-encoded mp4 (not stream-copy) so the trim lands on the
 * exact start/end seconds — stream-copy with `-c copy` would snap to the
 * nearest keyframe and surprise users whose 3.0s mark is actually 2.4s on
 * disk. Re-encode is slower but the result is correct, and the editor is
 * not on a hot path.
 *
 * Output is fragmented mp4 streamed to stdout — `+empty_moov+frag_keyframe`
 * lets ffmpeg emit the file without a final seek, which is what stdout
 * requires (no random access on a pipe). `+faststart` is unhelpful for
 * fragmented mp4 since there's no big moov to relocate, but harmless.
 */

import { spawn } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

export interface ClipVideoParams {
  /** Absolute URL ffmpeg fetches the source video from (signed /assets/<key>). */
  sourceUrl: string;
  /** Trim start, seconds. */
  startSec: number;
  /** Trim end, seconds. Must be > startSec. */
  endSec: number;
  /** Optional max output width; aspect preserved via -2 height. */
  width?: number;
}

export interface ClipVideoResult {
  bytes: Uint8Array;
  contentType: string;
  /** Output duration in milliseconds (endSec - startSec, rounded). */
  durationMs: number;
}

export async function clipVideo(params: ClipVideoParams): Promise<ClipVideoResult> {
  const { sourceUrl, startSec, endSec } = params;

  if (!Number.isFinite(startSec) || startSec < 0) {
    throw new Error(`invalid startSec: ${startSec}`);
  }
  if (!Number.isFinite(endSec) || endSec <= startSec) {
    throw new Error(`invalid endSec: ${endSec} (must be > startSec=${startSec})`);
  }
  if (!ffmpegPath) {
    throw new Error("ffmpeg-static binary not found");
  }

  const duration = endSec - startSec;

  // Input-side seek (-ss before -i) is fast — ffmpeg seeks the input demuxer
  // to the nearest keyframe before decoding. Combined with `-t <duration>`
  // and re-encoding it produces frame-accurate output: ffmpeg decodes from
  // the keyframe up to startSec and only emits frames at/after that mark.
  // Pure -c copy here would round to the keyframe, which is wrong for an
  // editor that promises exact trim points.
  const args = [
    "-hide_banner",
    "-ss", String(startSec),
    "-i", sourceUrl,
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "128k",
    ...(params.width && Number.isFinite(params.width)
      ? ["-vf", `scale=${Math.floor(params.width)}:-2`]
      : []),
    // empty_moov+frag_keyframe → mp4 streamable to stdout (no final seek).
    "-movflags", "+empty_moov+frag_keyframe+faststart",
    "-f", "mp4",
    "-",
  ];

  return new Promise<ClipVideoResult>((resolve, reject) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(ffmpegPath as string, args);
    } catch (e) {
      reject(new Error(`ffmpeg spawn failed: ${(e as Error).message}`));
      return;
    }

    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout?.on("data", (c: Buffer) => chunks.push(c));
    proc.stderr?.on("data", (c: Buffer) => { stderr += c.toString(); });
    proc.on("error", (err) => reject(new Error(`ffmpeg process error: ${err.message}`)));
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `ffmpeg exited ${code} (source=${sourceUrl}, ${startSec}-${endSec}s): ${stderr.slice(-400)}`,
          ),
        );
        return;
      }
      const bytes = new Uint8Array(Buffer.concat(chunks));
      if (bytes.byteLength === 0) {
        reject(
          new Error(
            `ffmpeg produced empty output (source=${sourceUrl}, ${startSec}-${endSec}s): ${stderr.slice(-400)}`,
          ),
        );
        return;
      }
      resolve({
        bytes,
        contentType: "video/mp4",
        durationMs: Math.round(duration * 1000),
      });
    });
  });
}
