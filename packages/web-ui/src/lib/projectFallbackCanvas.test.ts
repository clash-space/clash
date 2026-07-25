import { describe, expect, it } from "vitest";
import { buildFallbackCanvasFromAssets } from "./projectFallbackCanvas";

describe("buildFallbackCanvasFromAssets", () => {
  it("builds completed media nodes from project asset refs", () => {
    const { nodes, edges } = buildFallbackCanvasFromAssets([
      {
        id: "asset-image",
        type: "image",
        url: "/assets/image.png?signed=1",
        storageKey: "projects/p/assets/image.png",
        createdAt: "2026-06-03T00:00:00.000Z",
      },
      {
        id: "asset-video",
        type: "video",
        url: "/assets/video-cover.png?signed=1",
        storageKey: "projects/p/assets/video.mp4",
        createdAt: "2026-06-03T00:01:00.000Z",
      },
      {
        id: "asset-audio",
        type: "audio",
        url: "/assets/voice.wav?signed=1",
        storageKey: "projects/p/assets/voice.wav",
        createdAt: "2026-06-03T00:02:00.000Z",
      },
    ]);

    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({
      id: "asset-ref-asset-image",
      type: "image",
      data: {
        assetId: "asset-image",
        src: "projects/p/assets/image.png",
        status: "completed",
      },
    });
    expect(nodes[1]).toMatchObject({
      id: "asset-ref-asset-video",
      type: "video",
      data: {
        assetId: "asset-video",
        src: "projects/p/assets/video.mp4",
        status: "completed",
      },
    });
    expect(nodes[2]).toMatchObject({
      id: "asset-ref-asset-audio",
      type: "audio",
      data: {
        label: "Recovered Audio",
        assetId: "asset-audio",
        src: "projects/p/assets/voice.wav",
        status: "completed",
      },
    });
  });
});
