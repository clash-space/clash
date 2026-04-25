/**
 * Video time-range clipping — counterpart to thumbnail.ts but for the
 * video-clipper edit pipeline. Same render-server transport story:
 *   RENDER_SERVER_URL  for local / external render-server processes
 *   RENDER_CONTAINER   for prod / wrangler-with-Containers
 *
 * The actual ffmpeg trim lives in apps/render-server/src/clip.ts.
 */

import type { Env } from "../config";
import { signAssetPath } from "./asset-signing";
import { renderServerFetch } from "./thumbnail";

export interface ClipVideoOptions {
  /** Trim start, seconds. */
  startSec: number;
  /** Trim end, seconds (must be > startSec). */
  endSec: number;
  /** Optional max output width; aspect preserved. */
  width?: number;
}

export interface ClipVideoResult {
  bytes: ArrayBuffer;
  contentType: string;
  /** Output duration in milliseconds, echoed by render-server. */
  durationMs?: number;
}

export async function clipVideo(
  env: Env,
  videoR2Key: string,
  opts: ClipVideoOptions,
): Promise<ClipVideoResult> {
  const mediaBase = env.MEDIA_GATEWAY_URL;
  if (!mediaBase) {
    throw new Error(
      "MEDIA_GATEWAY_URL must be set so render-server can fetch the signed video URL",
    );
  }
  const signedPath = await signAssetPath(env, videoR2Key);
  const sourceUrl = `${mediaBase.replace(/\/$/, "")}${signedPath}`;

  const resp = await renderServerFetch(env, "/clip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceUrl,
      startSec: opts.startSec,
      endSec: opts.endSec,
      width: opts.width,
    }),
  });
  if (!resp.ok) {
    const preview = await resp
      .text()
      .then((t) => t.slice(0, 500))
      .catch(() => "<unreadable>");
    throw new Error(
      `render-server /clip failed (${resp.status} ${resp.statusText}) for ${videoR2Key}: ${preview}`,
    );
  }
  const bytes = await resp.arrayBuffer();
  const d = resp.headers.get("X-Duration-Ms");
  return {
    bytes,
    contentType: resp.headers.get("Content-Type") ?? "video/mp4",
    durationMs: d ? Number(d) : undefined,
  };
}
