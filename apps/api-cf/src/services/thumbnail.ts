/**
 * Video thumbnail extraction — one backend, two transports.
 *
 * The render-server container (apps/render-server) owns the ffmpeg work.
 * This module just formats the request + parses the response. Two transports
 * for reaching it:
 *
 *   RENDER_SERVER_URL  — http URL; used when a render-server is already
 *                        running as a standalone process (local `make dev`
 *                        without Docker, or an externally-hosted instance).
 *   RENDER_CONTAINER   — Cloudflare Container DO binding; used in prod and
 *                        in local dev when `enable_containers = true`. The
 *                        Container boots the same Docker image from the
 *                        render-server package on first fetch.
 *
 * URL takes precedence when both are set — useful for pointing at an
 * already-running render-server even in a wrangler config that also has
 * the Container binding declared.
 */
import { getContainer } from "@cloudflare/containers";
import type { Env } from "../config";
import { signAssetPath } from "./asset-signing";

export interface ExtractFrameOptions {
  /** Seconds into the video. Default 1. */
  timeSec?: number;
  /** Output format. Default jpg. */
  format?: "jpg" | "png" | "webp";
  /** Optional max width in pixels; aspect preserved. */
  width?: number;
}

/**
 * Return shape for video thumbnail extraction.
 *
 * The frame bytes are the primary product; `sourceWidth / sourceHeight /
 * durationMs` come for free from ffmpeg's stderr (already opened the
 * container to pull a frame) and let callers persist all metadata in one
 * trip — no second probe call.
 */
export interface ExtractFrameResult {
  bytes: ArrayBuffer;
  contentType: string;
  sourceWidth?: number;
  sourceHeight?: number;
  durationMs?: number;
}

/**
 * POST to the render-server `/thumbnail` endpoint regardless of transport.
 * Centralizes dispatcher so we never have two slightly-different request
 * shapes going out for URL vs Container.
 */
export async function renderServerFetch(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  if (env.RENDER_SERVER_URL) {
    const base = env.RENDER_SERVER_URL.replace(/\/$/, "");
    return fetch(`${base}${path}`, init);
  }
  if (env.RENDER_CONTAINER) {
    // Singleton instance — thumbnail jobs are stateless and short, so a
    // single container handles all of them. If throughput becomes an issue,
    // swap in `getRandom(binding, N)` for a small pool.
    const stub = getContainer(env.RENDER_CONTAINER, "render");
    return stub.fetch(`http://container${path}`, init);
  }
  throw new Error(
    "No render backend: set RENDER_SERVER_URL or bind RENDER_CONTAINER.",
  );
}

/**
 * Extract a single frame from a video stored in R2, plus the source video's
 * dimensions and duration.
 *
 * The caller passes an R2 key; we sign a `/assets/<key>` URL (so the
 * container — dev or prod — fetches the video over ordinary HTTP with
 * signature auth) and hand that URL to the render-server. The container's
 * ffmpeg opens the container and extracts the frame at `timeSec`.
 */
export async function extractVideoThumbnail(
  env: Env,
  videoR2Key: string,
  opts: ExtractFrameOptions = {},
): Promise<ExtractFrameResult> {
  const mediaBase = env.MEDIA_GATEWAY_URL;
  if (!mediaBase) {
    throw new Error(
      "MEDIA_GATEWAY_URL must be set so render-server can fetch the signed video URL",
    );
  }
  const signedPath = await signAssetPath(env, videoR2Key);
  const sourceUrl = `${mediaBase.replace(/\/$/, "")}${signedPath}`;

  const resp = await renderServerFetch(env, "/thumbnail", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceUrl,
      timeSec: opts.timeSec ?? 1,
      format: opts.format ?? "jpg",
      width: opts.width,
    }),
  });
  if (!resp.ok) {
    const preview = await resp
      .text()
      .then((t) => t.slice(0, 500))
      .catch(() => "<unreadable>");
    throw new Error(
      `render-server /thumbnail failed (${resp.status} ${resp.statusText}) for ${videoR2Key}: ${preview}`,
    );
  }
  const bytes = await resp.arrayBuffer();
  // render-server echoes metadata in response headers (see apps/render-server/src/index.ts).
  const w = resp.headers.get("X-Source-Width");
  const h = resp.headers.get("X-Source-Height");
  const d = resp.headers.get("X-Duration-Ms");
  return {
    bytes,
    contentType: resp.headers.get("Content-Type") ?? "image/jpeg",
    sourceWidth: w ? Number(w) : undefined,
    sourceHeight: h ? Number(h) : undefined,
    durationMs: d ? Number(d) : undefined,
  };
}
