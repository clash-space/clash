import { describe, expect, it } from "vitest";

import { AIGC_ACTION_KINDS, AigcActionKindSchema } from "./actions.js";
import { AssetKindSchema } from "./assets.js";

describe("action kinds", () => {
  it("names the five things the product produces", () => {
    expect([...AIGC_ACTION_KINDS]).toEqual(["image", "video", "audio", "text", "model"]);
  });

  it("refuses a task-shaped value", () => {
    // `text-to-speech` and `music-generation` were the two values the deleted `task` field held.
    // Both are audio; accepting either here would reintroduce the axis this enum replaces.
    expect(AigcActionKindSchema.safeParse("text-to-speech").success).toBe(false);
    expect(AigcActionKindSchema.safeParse("music-generation").success).toBe(false);
  });

  it("shares every storable asset kind now that a model-generation action can produce one", () => {
    // `model` used to be the one AssetKind an AIGC action could never produce: a 3-D asset a user
    // could hold without any action having made it. A model-generation action (e.g. mesh or
    // auto-rig generation) closes that gap, so every AssetKind is now also a valid AigcActionKind.
    // `text` is the only member left that names an action without naming a storable Asset.
    for (const kind of AssetKindSchema.options) {
      expect(AigcActionKindSchema.safeParse(kind).success).toBe(true);
    }
    expect(AssetKindSchema.safeParse("text").success).toBe(false);
  });
});

describe("asr is not a fifth action", () => {
  it("is text, named for its technique rather than its output", async () => {
    // `ModelKindSchema` carries `image | video | audio | text | asr`. The first four say what a
    // card produces; `asr` says how it works. Five speech-to-text cards sit under it, and every one
    // of them produces text.
    //
    // Keeping it would make the rule "an action is what it produces" false at exactly one point,
    // and a rule with one exception is a rule everyone has to remember the exception to.
    const { AIGC_ACTION_KINDS } = await import("./actions.js");
    expect([...AIGC_ACTION_KINDS]).not.toContain("asr");
  });

  it("leaves nothing claiming asr as a kind", async () => {
    const { MODEL_CARDS } = await import("./models.js");
    const asr = MODEL_CARDS.filter((card) => (card.kind as string) === "asr");
    expect(asr.map((card) => card.id)).toEqual([]);
  });
});
