/**
 * Unified server-authoritative probe for uploaded / generated media.
 *
 * Single entry point used by:
 *   - routes/v1/assets.ts POST /api/v1/assets (user uploads)
 *   - agents/generation.ts custom action pipeline (AI outputs whose kind
 *     isn't known until the agent finishes running)
 *
 * Each kind dispatches to its own extractor (thumbnail.ts, image-metadata.ts,
 * audio-metadata.ts). The extractors each have their own dev/prod split —
 * this layer is only about "given an R2 key + kind, return the metadata we
 * want on the asset row, plus any derived artifact (video cover)". All
 * probe failures are non-fatal and return whatever we did manage to collect
 * (usually just bytes from R2.head).
 */

import type { Env } from "../config";
import type { AssetMetadata } from "./assets";
import { extractImageMetadata } from "./image-metadata";
import { extractVideoThumbnail } from "./thumbnail";
import { extractAudioMetadata } from "./audio-metadata";
import { uploadBytes } from "./r2";
import { log } from "../logger";

export interface AssetProbeResult {
  metadata: AssetMetadata;
  /** Only set for video — the first frame, uploaded to R2 as the asset cover. */
  coverR2Key?: string;
}

export interface ProbeOptions {
  /** Skip video cover extraction. Useful when the provider already returned
   *  a cover URL and the caller prefers that over our ffmpeg-pulled frame. */
  skipVideoCover?: boolean;
}

export async function probeAsset(
  env: Env,
  kind: "image" | "video" | "audio",
  srcR2Key: string,
  projectId: string,
  opts: ProbeOptions = {},
): Promise<AssetProbeResult> {
  // R2.head is the cheapest bytes source. One extra HEAD per upload is fine;
  // probes already cost at least a full fetch of the object.
  const head = await env.R2_BUCKET.head(srcR2Key);
  const bytes = head?.size;

  if (kind === "image") {
    try {
      const { width, height } = await extractImageMetadata(env, srcR2Key);
      return { metadata: { width, height, bytes } };
    } catch (e) {
      log.warn("image probe failed", { srcR2Key, error: String(e) });
      return { metadata: { bytes } };
    }
  }

  if (kind === "video") {
    try {
      const result = await extractVideoThumbnail(env, srcR2Key, {
        timeSec: 1,
        format: "jpg",
      });
      // Only upload the extracted frame as cover when the caller doesn't have
      // a better one already (providers like Kling return their own cover).
      // Skipping this avoids orphaning an R2 object the caller won't use.
      let coverR2Key: string | undefined;
      if (!opts.skipVideoCover) {
        const coverSuffix = srcR2Key.replace(/[^a-zA-Z0-9]/g, "-").slice(-32);
        coverR2Key = await uploadBytes(
          env.R2_BUCKET,
          new Uint8Array(result.bytes),
          projectId,
          `${coverSuffix}-cover`,
          "image/jpeg",
        );
      }
      return {
        metadata: {
          width: result.sourceWidth,
          height: result.sourceHeight,
          durationMs: result.durationMs,
          bytes,
        },
        coverR2Key,
      };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      log.warn("video probe failed — asset will have no cover/dimensions", {
        srcR2Key,
        projectId,
        error: err.message,
        stack: err.stack?.split("\n").slice(0, 5).join(" | "),
        hint: "check RENDER_SERVER_URL (dev) is reachable or MEDIA_GATEWAY_URL (prod) MT is configured",
      });
      return { metadata: { bytes } };
    }
  }

  if (kind === "audio") {
    try {
      const { durationMs, waveform } = await extractAudioMetadata(env, srcR2Key);
      return { metadata: { durationMs, waveform, bytes } };
    } catch (e) {
      log.warn("audio probe failed", { srcR2Key, error: String(e) });
      return { metadata: { bytes } };
    }
  }

  return { metadata: { bytes } };
}
