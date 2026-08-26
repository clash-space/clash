import { describe, expect, it } from "vitest";

import { capability, validateRefs } from "./model-capabilities.js";
import { MODEL_CARDS } from "./models.js";

// move-ai-s2 is a future built-in Card that takes exactly one input video
// (motion capture source) and produces a rigged, animated GLB model output.
// It does not accept a prompt: the model derives its output purely from the
// reference video. Video is the required *input* modality; the Card's kind
// (output modality) must be "model" because the produced Asset is a
// motion GLB, not a video.
function getMoveAiCard() {
  const model = MODEL_CARDS.find((candidate) => candidate.id === "move-ai-s2");
  if (!model) throw new Error("Missing model card: move-ai-s2");
  return model;
}

describe("move-ai-s2 model card", () => {
  it("exists as a built-in model kind model (output motion GLB)", () => {
    const model = getMoveAiCard();
    expect(model.kind).toBe("model");
  });

  it("requires no prompt", () => {
    const model = getMoveAiCard();
    expect(model.input.requiresPrompt).toBe(false);
  });

  it("accepts exactly one video reference and rejects zero or two", () => {
    const model = getMoveAiCard();

    expect(
      validateRefs(model, { video: 1 }, { enforceMinimums: true }),
    ).toBeNull();

    expect(
      validateRefs(model, { video: 0 }, { enforceMinimums: true }),
    ).not.toBeNull();

    expect(
      validateRefs(model, { video: 2 }, { enforceMinimums: true }),
    ).not.toBeNull();
  });

  it("only accepts video as a prompt modality", () => {
    const model = getMoveAiCard();
    expect(model.input.promptModalities).toEqual(["video"]);
  });

  it("has no provider implementations", () => {
    const model = getMoveAiCard();
    expect(model.providerImplementations ?? []).toEqual([]);
  });

  it("resolves capability outputKind to model", () => {
    const model = getMoveAiCard();
    expect(capability(model).outputKind).toBe("model");
  });

  it("accepts exactly the documented video upload formats", () => {
    const model = getMoveAiCard();
    const constraints = model.input.inputMode.videos?.constraints;
    expect(constraints?.mimeTypes).toEqual([
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
    ]);
    expect(constraints?.fileExtensions).toEqual(["mp4", "mov", "avi"]);
  });

  it("has trackFingers and floorPlane parameters defaulting to true, and trackBall with no default", () => {
    const model = getMoveAiCard();
    const byId = (id: string) =>
      model.parameters.find((param) => param.id === id);

    expect(byId("trackFingers")?.defaultValue).toBe(true);
    expect(byId("floorPlane")?.defaultValue).toBe(true);
    expect(byId("trackBall")).toBeDefined();
    expect(byId("trackBall")?.defaultValue).toBeUndefined();
  });

  it("defaultParams only sets trackFingers and floorPlane to true", () => {
    const model = getMoveAiCard();
    expect(model.defaultParams).toEqual({
      trackFingers: true,
      floorPlane: true,
    });
  });
});
