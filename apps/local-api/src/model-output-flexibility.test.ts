import { describe, expect, it } from "vitest";
import { modelOutputFlexibility } from "./local-processor.js";

describe("modelOutputFlexibility", () => {
  it.each([
    ["meshy-6", 0],
    ["meshy-7", 0],
    ["tripo-h3.1", 0],
    ["meshy-auto-rig", 1],
    ["tripo-auto-rig", 1],
    ["move-ai-s2", 1],
  ])("maps model %s to %s for kind 'model'", (modelId, expected) => {
    expect(modelOutputFlexibility("model", modelId)).toBe(expected);
  });

  it("returns undefined for an unrecognized model id", () => {
    expect(modelOutputFlexibility("model", "unknown-model")).toBeUndefined();
  });

  it("returns undefined when modelId is not a recognizable value", () => {
    expect(modelOutputFlexibility("model", undefined)).toBeUndefined();
    expect(modelOutputFlexibility("model", 42)).toBeUndefined();
  });

  it("returns undefined for a non-'model' kind even with a recognized model id", () => {
    expect(modelOutputFlexibility("image", "meshy-6")).toBeUndefined();
    expect(modelOutputFlexibility("video", "meshy-auto-rig")).toBeUndefined();
    expect(modelOutputFlexibility("text", "tripo-h3.1")).toBeUndefined();
  });
});
