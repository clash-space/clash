import { describe, expect, it } from "vitest";
import { buildFallbackCanvasFromAssets } from "./projectFallbackCanvas";

describe("buildFallbackCanvasFromAssets", () => {
  it("builds completed media nodes from project asset refs", () => {
    const { nodes, edges } = buildFallbackCanvasFromAssets([
      {
        id: "asset-image",
        kind: "image",
        url: "https://media.clash.test/assets/asset-image",
        metadata: {},
        lifecycle: { state: "active" },
        status: "ready",
      },
      {
        id: "asset-video",
        kind: "video",
        url: "https://media.clash.test/assets/asset-video",
        thumbnailUrl: "https://media.clash.test/thumbnails/asset-video",
        metadata: {},
        lifecycle: { state: "active" },
        status: "ready",
      },
      {
        id: "asset-audio",
        kind: "audio",
        url: "https://media.clash.test/assets/asset-audio",
        metadata: {},
        lifecycle: { state: "active" },
        status: "ready",
      },
    ]);

    expect(edges).toEqual([]);
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toMatchObject({
      id: "asset-ref-asset-image",
      type: "image",
      data: {
        assetId: "asset-image",
        status: "completed",
      },
    });
    expect(nodes[1]).toMatchObject({
      id: "asset-ref-asset-video",
      type: "video",
      data: {
        assetId: "asset-video",
        status: "completed",
      },
    });
    expect(nodes[2]).toMatchObject({
      id: "asset-ref-asset-audio",
      type: "audio",
      data: {
        label: "Recovered Audio",
        assetId: "asset-audio",
        status: "completed",
      },
    });
    for (const node of nodes) {
      expect(node.data).not.toHaveProperty("src");
      expect(node.data).not.toHaveProperty("previewUrl");
    }
  });
});
