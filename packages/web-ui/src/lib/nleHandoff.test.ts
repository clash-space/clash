import { describe, expect, it } from "vitest";
import type { Asset, Track } from "@clash/remotion-core";
import { hydrateTimelineTracksForNle } from "./nleHandoff";

describe("web NLE handoff", () => {
  it("hydrates reference-only Timeline clips from the live editor asset set", () => {
    const tracks: Track[] = [
      {
        id: "visual",
        name: "Visual",
        items: [
          {
            id: "clip",
            type: "video",
            src: "",
            sourceNodeId: "node-1",
            assetId: "asset-1",
            from: 0,
            durationInFrames: 30,
          },
        ],
      },
    ];
    const assets: Asset[] = [
      {
        id: "node-1",
        sourceNodeId: "node-1",
        projectAssetId: "asset-1",
        name: "Clip",
        type: "video",
        src: "https://media.example/clip.mov",
        createdAt: 1,
      },
    ];

    expect(
      hydrateTimelineTracksForNle(tracks, assets)[0].items[0],
    ).toMatchObject({
      id: "clip",
      src: "https://media.example/clip.mov",
    });
  });

  it("hydrates persisted media items whose src property was stripped entirely", () => {
    const tracks: Track[] = [
      {
        id: "visual",
        name: "Visual",
        items: [
          {
            id: "still",
            type: "image",
            sourceNodeId: "timeline-asset:asset-1",
            assetId: "asset-1",
            from: 0,
            durationInFrames: 30,
          } as Track["items"][number],
        ],
      },
    ];
    const assets: Asset[] = [
      {
        id: "timeline-asset:asset-1",
        sourceNodeId: "timeline-asset:asset-1",
        projectAssetId: "asset-1",
        name: "Still",
        type: "image",
        src: "http://127.0.0.1:49321/assets/still.png",
        createdAt: 1,
      },
    ];

    expect(
      hydrateTimelineTracksForNle(tracks, assets)[0].items[0],
    ).toMatchObject({
      id: "still",
      src: "http://127.0.0.1:49321/assets/still.png",
    });
  });

  it("replaces a stale persisted src with the live asset projection", () => {
    const tracks: Track[] = [
      {
        id: "visual",
        name: "Visual",
        items: [
          {
            id: "clip",
            type: "video",
            src: "https://stale.example/expired.mov",
            sourceNodeId: "node-1",
            assetId: "asset-1",
            from: 0,
            durationInFrames: 30,
          },
        ],
      },
    ];
    const assets: Asset[] = [
      {
        id: "node-1",
        sourceNodeId: "node-1",
        projectAssetId: "asset-1",
        name: "Clip",
        type: "video",
        src: "https://media.example/live.mov",
        createdAt: 1,
      },
    ];

    expect(
      hydrateTimelineTracksForNle(tracks, assets)[0].items[0],
    ).toMatchObject({
      id: "clip",
      src: "https://media.example/live.mov",
    });
  });
});
