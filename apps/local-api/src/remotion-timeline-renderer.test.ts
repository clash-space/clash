import { access, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { createRemotionTimelineRenderer } from "./remotion-timeline-renderer.js";

const TIMELINE = {
  tracks: [],
  compositionWidth: 720,
  compositionHeight: 1280,
  fps: 24,
  durationInFrames: 96,
};

describe("daemon Remotion Timeline renderer", () => {
  it("renders H.264 from the shared product composition and returns media metadata", async () => {
    const selectComposition = vi.fn(async () => ({ id: "VideoComposition" }));
    const renderMedia = vi.fn(async (options: Record<string, unknown>) => {
      await writeFile(String(options.outputLocation), Buffer.from("real-render-bytes"));
    });
    let renderDirectory = "";
    const renderer = createRemotionTimelineRenderer({
      resolveServeUrl: async () => "/opt/clash/remotion-bundle",
      loadRenderer: async () => ({ selectComposition, renderMedia }),
      onRenderDirectory: (path) => { renderDirectory = path; },
    });

    const result = await renderer.render({
      projectId: "project-1",
      taskId: "timeline-render-1",
      timelineDsl: TIMELINE,
    });

    expect(Buffer.from(result.bytes).toString()).toBe("real-render-bytes");
    expect(result).toMatchObject({
      contentType: "video/mp4",
      width: 720,
      height: 1280,
      durationMs: 4000,
    });
    expect(selectComposition).toHaveBeenCalledWith(expect.objectContaining({
      serveUrl: "/opt/clash/remotion-bundle",
      id: "VideoComposition",
      inputProps: TIMELINE,
    }));
    expect(renderMedia).toHaveBeenCalledWith(expect.objectContaining({
      codec: "h264",
      serveUrl: "/opt/clash/remotion-bundle",
      inputProps: TIMELINE,
    }));
    await expect(access(renderDirectory)).rejects.toThrow();
  });

  it("serializes renders inside one daemon and keeps the queue usable after a failure", async () => {
    let active = 0;
    let maximumActive = 0;
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let attempts = 0;
    const renderer = createRemotionTimelineRenderer({
      resolveServeUrl: async () => "/opt/clash/remotion-bundle",
      loadRenderer: async () => ({
        selectComposition: async () => ({ id: "VideoComposition" }),
        renderMedia: async (options: Record<string, unknown>) => {
          attempts += 1;
          active += 1;
          maximumActive = Math.max(maximumActive, active);
          try {
            if (attempts === 1) {
              await firstGate;
              throw new Error("chromium crashed");
            }
            await writeFile(String(options.outputLocation), Buffer.from("second-render"));
          } finally {
            active -= 1;
          }
        },
      }),
    });

    const first = renderer.render({
      projectId: "project-1",
      taskId: "first",
      timelineDsl: TIMELINE,
    });
    const second = renderer.render({
      projectId: "project-1",
      taskId: "second",
      timelineDsl: TIMELINE,
    });
    await vi.waitFor(() => expect(active).toBe(1));
    releaseFirst();

    await expect(first).rejects.toThrow(/Timeline render first failed: chromium crashed/);
    await expect(second).resolves.toMatchObject({ contentType: "video/mp4" });
    expect(maximumActive).toBe(1);
  });
});
