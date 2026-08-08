import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import type { LocalTimelineRenderer } from "./local-processor.js";

type RemotionRendererApi = {
  selectComposition(options: Record<string, unknown>): Promise<unknown>;
  renderMedia(options: Record<string, unknown>): Promise<unknown>;
};

export type RemotionTimelineRendererOptions = {
  resolveServeUrl(): Promise<string>;
  loadRenderer(): Promise<RemotionRendererApi>;
  /** Test/diagnostic hook. The directory is removed before render() settles. */
  onRenderDirectory?: (path: string) => void;
};

type TimelineRenderInput = {
  tracks?: unknown;
  compositionWidth?: unknown;
  compositionHeight?: unknown;
  fps?: unknown;
  durationInFrames?: unknown;
  [key: string]: unknown;
};

function positiveNumber(value: unknown, fallback: number, label: string): number {
  const candidate = value === undefined ? fallback : value;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate <= 0) {
    throw new Error(`Timeline render requires a positive ${label}`);
  }
  return candidate;
}

function renderInput(timelineDsl: Record<string, any>) {
  const timeline = timelineDsl as TimelineRenderInput;
  if (!Array.isArray(timeline.tracks)) {
    throw new Error("Timeline render requires a tracks array");
  }
  return {
    ...timelineDsl,
    tracks: timeline.tracks,
    compositionWidth: positiveNumber(timeline.compositionWidth, 1920, "composition width"),
    compositionHeight: positiveNumber(timeline.compositionHeight, 1080, "composition height"),
    fps: positiveNumber(timeline.fps, 30, "fps"),
    durationInFrames: positiveNumber(timeline.durationInFrames, 300, "duration"),
  };
}

function safeTaskSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-") || "timeline";
}

/**
 * Creates the daemon-owned renderer used by every local Timeline render.
 *
 * Renders are deliberately serialized: Chromium/Remotion can consume the
 * whole machine, while the durable product queue already provides parallelism
 * across non-render tasks. The queue survives individual render failures.
 * There is no second service or port; lifecycle follows the local daemon.
 */
export function createRemotionTimelineRenderer(
  options: RemotionTimelineRendererOptions,
): LocalTimelineRenderer {
  let queue: Promise<void> = Promise.resolve();
  let rendererPromise: Promise<RemotionRendererApi> | undefined;
  let serveUrlPromise: Promise<string> | undefined;

  const render: LocalTimelineRenderer["render"] = (request) => {
    const current = queue.then(async () => {
      const inputProps = renderInput(request.timelineDsl);
      const outputDir = await mkdtemp(join(tmpdir(), "clash-timeline-render-"));
      options.onRenderDirectory?.(outputDir);
      const outputPath = join(outputDir, `${safeTaskSegment(request.taskId)}.mp4`);
      try {
        const [serveUrl, renderer] = await Promise.all([
          serveUrlPromise ??= options.resolveServeUrl(),
          rendererPromise ??= options.loadRenderer(),
        ]);
        const composition = await renderer.selectComposition({
          serveUrl,
          id: "VideoComposition",
          inputProps,
        });
        await renderer.renderMedia({
          composition,
          serveUrl,
          codec: "h264",
          outputLocation: outputPath,
          inputProps,
        });
        return {
          bytes: await readFile(outputPath),
          contentType: "video/mp4",
          width: inputProps.compositionWidth,
          height: inputProps.compositionHeight,
          durationMs: Math.round(
            (inputProps.durationInFrames * 1000) / inputProps.fps,
          ),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Timeline render ${request.taskId} failed: ${message}`, {
          cause: error,
        });
      } finally {
        await rm(outputDir, { recursive: true, force: true });
      }
    });
    queue = current.then(() => undefined, () => undefined);
    return current;
  };

  return { render };
}
