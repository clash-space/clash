import { describe, expect, it } from "vitest";

import { positionalReferencePrompt } from "./positional-reference-prompt";

describe("positionalReferencePrompt", () => {
  it("uses the selected provider dialect and modality-scoped reference indexes", () => {
    expect(positionalReferencePrompt({
      prompt: "fallback",
      promptParts: [
        { type: "text", text: "Use " },
        { type: "asset_ref", r2Key: "image-b", modality: "image" },
        { type: "text", text: " with " },
        { type: "asset_ref", r2Key: "audio-a", modality: "audio" },
      ],
      referenceImageR2Keys: ["image-a", "image-b"],
      referenceAudioR2Keys: ["audio-a"],
      selectedRoute: {
        modelCode: "seedance-2-ref",
        kind: "video",
        providerId: "fal",
        upstreamId: "fal",
        upstreamModel: "bytedance/seedance-2.0/reference-to-video",
        apiShape: "fal",
        priority: 20,
        referenceBinding: {
          type: "positional-tokens",
          modalityScopedIndexes: true,
          tokens: { image: "@Image{n}", video: "@Video{n}", audio: "@Audio{n}" },
        },
      },
    } as never)).toBe("Use @Image2 with @Audio1@Image1");
  });

  it("appends global references that were not embedded in the text after the authored inline sequence", () => {
    expect(positionalReferencePrompt({
      prompt: "fallback",
      promptParts: [
        { type: "text", text: "Use " },
        { type: "asset_ref", r2Key: "image-b", modality: "image" },
      ],
      referenceImageR2Keys: ["image-a", "image-b"],
      referenceVideoR2Keys: ["video-a"],
      referenceAudioR2Keys: ["audio-a"],
      selectedRoute: {
        modelCode: "seedance-2.5-ref",
        kind: "video",
        providerId: "volcengine",
        upstreamId: "volcengine",
        upstreamModel: "doubao-seedance-2-5",
        apiShape: "modelark",
        priority: 9,
        referenceBinding: {
          type: "positional-tokens",
          modalityScopedIndexes: true,
          tokens: { image: "[Image {n}]", video: "[Video {n}]", audio: "[Audio {n}]" },
        },
      },
    } as never)).toBe("Use [Image 2][Image 1][Video 1][Audio 1]");
  });
});
