import { describe, expect, it } from "vitest";
import {
  buildTimelineAssetInsertion,
  hasTimelineAssetInsertReceipt,
} from "./insertAssetRequest";

describe("buildTimelineAssetInsertion", () => {
  it("turns a picker asset into a playable Timeline track at the current frame", () => {
    const result = buildTimelineAssetInsertion({
      asset: {
        id: "timeline-asset:asset-1",
        projectAssetId: "asset-1",
        sourceNodeId: "timeline-asset:asset-1",
        name: "Opening frame",
        src: "/opening.png",
        type: "image",
      },
      frame: 42,
      fps: 30,
      compositionWidth: 1920,
      compositionHeight: 1080,
      requestId: "request-1",
    });

    expect(result.asset).toMatchObject({
      id: "timeline-asset:asset-1",
      projectAssetId: "asset-1",
    });
    expect(result.track).toMatchObject({
      id: "track-request-1",
      name: "Image",
      items: [
        {
          id: "item-request-1",
          type: "image",
          assetId: "asset-1",
          sourceNodeId: "timeline-asset:asset-1",
          from: 42,
          durationInFrames: 90,
          src: "/opening.png",
          mediaFit: "contain",
          properties: {
            width: 1,
            height: 1,
          },
        },
      ],
    });
  });

  it("keeps a real landscape video proportional when inserting it into a portrait canvas", () => {
    const result = buildTimelineAssetInsertion({
      asset: {
        id: "talking-head-placement",
        projectAssetId: "asset-video",
        sourceNodeId: "talking-head-placement",
        type: "video",
        src: "/talking-head.mp4",
        duration: 32.661,
        width: 1920,
        height: 1080,
        waveform: [0.1, 0.8, 0.3],
      },
      frame: 0,
      fps: 30,
      compositionWidth: 1080,
      compositionHeight: 1920,
      requestId: "video-request",
    });
    expect(result.asset).toMatchObject({
      projectAssetId: "asset-video",
      duration: 32.661,
      width: 1920,
      height: 1080,
    });
    expect(result.track.items[0]).toMatchObject({
      type: "video",
      durationInFrames: 980,
      properties: {
        width: 1,
        height: 1,
      },
      mediaFit: "contain",
    });
    expect(result.asset).not.toHaveProperty("waveform");
    expect(result.track.items[0]).not.toHaveProperty("waveform");
  });

  it("rejects runtime and catalog media that has not been admitted to the Project", () => {
    expect(() =>
      buildTimelineAssetInsertion({
        asset: {
          id: "library:sound:click",
          type: "audio",
          src: "data:audio/wav;base64,AA==",
        },
        frame: 0,
        fps: 30,
        compositionWidth: 1920,
        compositionHeight: 1080,
        requestId: "unadmitted",
      }),
    ).toThrow(/admitted as a Project Asset/);
  });

  it("recognizes a committed request by its deterministic track receipt", () => {
    expect(
      hasTimelineAssetInsertReceipt(
        [
          { id: "track-request-1", items: [{ id: "item-request-1" }] },
          { id: "track-request-2", items: [{ id: "item-request-2" }] },
        ],
        "request-2",
      ),
    ).toBe(true);
    expect(
      hasTimelineAssetInsertReceipt(
        [{ id: "track-request-1", items: [{ id: "item-request-1" }] }],
        "request-missing",
      ),
    ).toBe(false);
    expect(
      hasTimelineAssetInsertReceipt(
        [{ id: "track-request-2", items: [{ id: "another-item" }] }],
        "request-2",
      ),
    ).toBe(false);
  });
});
