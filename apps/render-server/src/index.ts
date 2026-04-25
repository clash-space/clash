import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { renderTimeline } from "./render.js";
import { extractFrame } from "./thumbnail.js";
import { probeAudio } from "./audioProbe.js";
import { clipVideo } from "./clip.js";

const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

/**
 * POST /thumbnail — extract a single frame from a video.
 *
 * Body: { sourceUrl: string, timeSec?: number, format?: "jpg"|"png"|"webp", width?: number }
 * Response: image bytes with appropriate Content-Type.
 *
 * `sourceUrl` is typically a short-lived signed `/assets/<key>` URL issued by
 * api-cf; ffmpeg fetches it over HTTP. In prod the zone handles this at the
 * edge via Cloudflare Media Transformations instead — this endpoint is the
 * dev / Container path. See apps/api-cf/src/services/thumbnail.ts.
 */
app.post("/thumbnail", async (c) => {
  let body: {
    sourceUrl?: string;
    timeSec?: number;
    format?: "jpg" | "png" | "webp";
    width?: number;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  if (!body.sourceUrl || typeof body.sourceUrl !== "string") {
    return c.json({ error: "Missing sourceUrl" }, 400);
  }

  const tag = { sourceUrl: body.sourceUrl.slice(0, 80), timeSec: body.timeSec ?? 1 };
  console.log(`[render-server] Thumbnail requested:`, tag);

  try {
    const { bytes, contentType, sourceWidth, sourceHeight, durationMs } = await extractFrame({
      sourceUrl: body.sourceUrl,
      timeSec: body.timeSec,
      format: body.format,
      width: body.width,
    });
    console.log(
      `[render-server] Thumbnail done: ${bytes.byteLength} bytes, source=${sourceWidth ?? "?"}x${sourceHeight ?? "?"}, duration=${durationMs ?? "?"}ms`,
    );
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "public, max-age=60",
      // CORS passthrough so callers can read the metadata headers (api-cf does).
      "Access-Control-Expose-Headers":
        "X-Source-Width, X-Source-Height, X-Duration-Ms",
    };
    if (sourceWidth) headers["X-Source-Width"] = String(sourceWidth);
    if (sourceHeight) headers["X-Source-Height"] = String(sourceHeight);
    if (durationMs) headers["X-Duration-Ms"] = String(durationMs);
    return new Response(bytes.buffer as ArrayBuffer, { headers });
  } catch (e: any) {
    console.error(`[render-server] Thumbnail failed:`, tag, e);
    return c.json({ error: e?.message ?? String(e) }, 500);
  }
});

/**
 * POST /probe-audio — extract duration + 128-peak waveform from an audio file.
 *
 * Body: { sourceUrl: string }
 * Response: { durationMs: number, waveform: number[] }
 *
 * No edge counterpart — Cloudflare Media Transformations doesn't handle audio,
 * so api-cf's services/audio-metadata.ts always dispatches here.
 */
app.post("/probe-audio", async (c) => {
  let body: { sourceUrl?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.sourceUrl || typeof body.sourceUrl !== "string") {
    return c.json({ error: "Missing sourceUrl" }, 400);
  }

  const tag = { sourceUrl: body.sourceUrl.slice(0, 80) };
  console.log(`[render-server] Probe audio requested:`, tag);

  try {
    const { durationMs, waveform } = await probeAudio({ sourceUrl: body.sourceUrl });
    console.log(
      `[render-server] Probe audio done: duration=${durationMs}ms, peaks=${waveform.length}`,
    );
    return c.json({ durationMs, waveform });
  } catch (e: any) {
    console.error(`[render-server] Probe audio failed:`, tag, e);
    return c.json({ error: e?.message ?? String(e) }, 500);
  }
});

/**
 * POST /clip — trim a video to [startSec, endSec], re-encoded to mp4.
 *
 * Body: { sourceUrl: string, startSec: number, endSec: number, width?: number }
 * Response: video/mp4 bytes with X-Duration-Ms header.
 *
 * Used by the video-clipper edit pipeline (api-cf services/video-clip.ts).
 * Re-encoded (not stream-copy) so the trim hits exact second boundaries —
 * see clip.ts for rationale.
 */
app.post("/clip", async (c) => {
  let body: { sourceUrl?: string; startSec?: number; endSec?: number; width?: number };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  if (!body.sourceUrl || typeof body.sourceUrl !== "string") {
    return c.json({ error: "Missing sourceUrl" }, 400);
  }
  if (typeof body.startSec !== "number" || typeof body.endSec !== "number") {
    return c.json({ error: "Missing startSec / endSec" }, 400);
  }

  const tag = {
    sourceUrl: body.sourceUrl.slice(0, 80),
    startSec: body.startSec,
    endSec: body.endSec,
  };
  console.log(`[render-server] Clip requested:`, tag);

  try {
    const { bytes, contentType, durationMs } = await clipVideo({
      sourceUrl: body.sourceUrl,
      startSec: body.startSec,
      endSec: body.endSec,
      width: body.width,
    });
    console.log(`[render-server] Clip done: ${bytes.byteLength} bytes, ${durationMs}ms`);
    return new Response(bytes.buffer as ArrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(bytes.byteLength),
        "Cache-Control": "public, max-age=60",
        "X-Duration-Ms": String(durationMs),
        "Access-Control-Expose-Headers": "X-Duration-Ms",
      },
    });
  } catch (e: any) {
    console.error(`[render-server] Clip failed:`, tag, e);
    return c.json({ error: e?.message ?? String(e) }, 500);
  }
});

app.post("/render", async (c) => {
  const { timelineDsl, projectId, taskId } = await c.req.json<{
    timelineDsl: Record<string, any>;
    projectId: string;
    taskId: string;
  }>();

  if (!timelineDsl?.tracks) {
    return c.json({ error: "Missing timelineDsl.tracks" }, 400);
  }

  console.log(`[render-server] Starting render: task=${taskId} project=${projectId} tracks=${timelineDsl.tracks.length}`);

  try {
    const compositionWidth =
      typeof timelineDsl?.compositionWidth === "number" && timelineDsl.compositionWidth > 0
        ? timelineDsl.compositionWidth
        : 1920;
    const compositionHeight =
      typeof timelineDsl?.compositionHeight === "number" && timelineDsl.compositionHeight > 0
        ? timelineDsl.compositionHeight
        : 1080;
    const fps =
      typeof timelineDsl?.fps === "number" && timelineDsl.fps > 0
        ? timelineDsl.fps
        : 30;
    const durationInFrames =
      typeof timelineDsl?.durationInFrames === "number" && timelineDsl.durationInFrames > 0
        ? timelineDsl.durationInFrames
        : 300;
    const durationMs = Math.round((durationInFrames * 1000) / fps);

    const buffer = await renderTimeline(timelineDsl, taskId);
    console.log(`[render-server] Render complete: task=${taskId} size=${buffer.byteLength} bytes`);

    return new Response(buffer, {
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": buffer.byteLength.toString(),
        "X-Render-Width": String(compositionWidth),
        "X-Render-Height": String(compositionHeight),
        "X-Render-Duration-Ms": String(durationMs),
      },
    });
  } catch (e: any) {
    console.error(`[render-server] Render failed: task=${taskId}`, e);
    return c.json({ error: e.message }, 500);
  }
});

const port = parseInt(process.env.PORT || "8080", 10);
console.log(`[render-server] Listening on port ${port}`);
serve({ fetch: app.fetch, port });
