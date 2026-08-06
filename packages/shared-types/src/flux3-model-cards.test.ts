import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models";
import { validateRefs } from "./model-capabilities";
import { listDeclaredModelUpstreamRoutes } from "./model-routing";

describe("FLUX 3 model cards", () => {
  it("declares text, keyframe, and continuation as three independent model cards", () => {
    const text = MODEL_CARDS.find((card) => card.id === "flux-3-video");
    const keyframes = MODEL_CARDS.find((card) => card.id === "flux-3-video-keyframes");
    const continuation = MODEL_CARDS.find((card) => card.id === "flux-3-video-continue");

    expect(text?.input.inputMode).toEqual({});
    expect(keyframes?.input.inputMode.images).toMatchObject({ min: 1, max: 10 });
    expect(keyframes?.input.presentation).toEqual({ type: "keyframes", timing: "explicit", frameRate: 24 });
    expect(continuation?.input.inputMode.videos).toMatchObject({ min: 1, max: 1 });
    expect(continuation?.input.presentation).toEqual({ type: "video-continuation" });
    for (const card of [text, keyframes, continuation]) {
      expect(card).toBeDefined();
      expect(card).not.toHaveProperty("family");
      expect(card).not.toHaveProperty("workflow");
    }
    expect(text?.defaultParams).toMatchObject({
      duration: "auto",
      aspect_ratio: "auto",
      resolution: "720p",
      generate_audio: true,
      safety_tolerance: 2,
    });
  });

  it("routes every FLUX 3 model card through official BFL and fal", () => {
    const routes = listDeclaredModelUpstreamRoutes(MODEL_CARDS)
      .filter((route) => route.modelCode.startsWith("flux-3-video"));

    for (const modelCode of ["flux-3-video", "flux-3-video-keyframes", "flux-3-video-continue"]) {
      expect(routes).toEqual(expect.arrayContaining([
        expect.objectContaining({
          modelCode,
          providerId: "official",
          upstreamId: "bfl",
          apiShape: "bfl",
          upstreamModel: "flux-3-video",
        }),
        expect.objectContaining({
          modelCode,
          providerId: "fal",
          upstreamId: "fal",
          apiShape: "fal",
        }),
      ]));
    }
  });

  it("enforces the declared one-to-ten keyframe range before provider execution", () => {
    const keyframes = MODEL_CARDS.find((card) => card.id === "flux-3-video-keyframes");
    expect(keyframes).toBeDefined();
    expect(validateRefs(keyframes!, { image: 0 }, { prompt: "Connect the beats" }))
      .toMatch(/requires a reference image/i);
    expect(validateRefs(keyframes!, { image: 10 }, { prompt: "Connect the beats" })).toBeNull();
    expect(validateRefs(keyframes!, { image: 11 }, { prompt: "Connect the beats" }))
      .toMatch(/at most 10 (?:total references|reference images) \(got 11\)/i);
  });
});
