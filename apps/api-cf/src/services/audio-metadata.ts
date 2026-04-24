/**
 * Audio metadata extraction — duration + 128-peak waveform for audio assets.
 *
 * Unlike thumbnail.ts and image-metadata.ts, there is only one backend:
 *
 *   Dev / Prod:  POST to render-server's /probe-audio endpoint, which spawns
 *                ffmpeg-static to decode mono 8kHz PCM and downsample peaks.
 *
 * There is no Cloudflare edge equivalent for audio metadata (Media
 * Transformations is video/image only), so render-server is also the prod
 * Container path. Callers must have `RENDER_SERVER_URL` configured.
 *
 * Consumers (POST /api/v1/assets probe, agents/generation.ts audio pipeline)
 * should persist `durationMs` + `waveform` on the D1 assets row in one trip.
 */
import type { Env } from "../config";
import { signAssetPath } from "./asset-signing";

export interface AudioMetadataResult {
  durationMs: number;
  waveform: number[];
}

/**
 * Resolve an audio asset's duration (ms) and a 128-sample normalized peak
 * waveform. Always dispatches to render-server — no edge fallback exists.
 */
export async function extractAudioMetadata(
  env: Env,
  audioR2Key: string,
): Promise<AudioMetadataResult> {
  if (!env.RENDER_SERVER_URL) {
    throw new Error(
      "audio probing requires RENDER_SERVER_URL; no Cloudflare edge equivalent for audio metadata",
    );
  }
  const mediaBase = env.MEDIA_GATEWAY_URL;
  if (!mediaBase) {
    throw new Error(
      "MEDIA_GATEWAY_URL must be set so render-server can fetch the signed audio URL",
    );
  }
  const signedPath = await signAssetPath(env, audioR2Key);
  const sourceUrl = `${mediaBase.replace(/\/$/, "")}${signedPath}`;

  const resp = await fetch(`${env.RENDER_SERVER_URL.replace(/\/$/, "")}/probe-audio`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceUrl }),
  });
  if (!resp.ok) {
    const preview = await resp
      .text()
      .then((t) => t.slice(0, 500))
      .catch(() => "<unreadable>");
    throw new Error(
      `render-server /probe-audio failed (${resp.status} ${resp.statusText}) for ${audioR2Key}: ${preview}`,
    );
  }
  const { durationMs, waveform } = (await resp.json()) as {
    durationMs?: number;
    waveform?: number[];
  };
  if (
    typeof durationMs !== "number" ||
    !Array.isArray(waveform) ||
    waveform.length === 0
  ) {
    throw new Error(`render-server returned incomplete audio metadata for ${audioR2Key}`);
  }
  return { durationMs, waveform };
}
