import { describe, expect, it } from "vitest";

import { AIGC_ACTION_KINDS, AigcActionKindSchema } from "./actions.js";
import { AssetKindSchema } from "./assets.js";

describe("action kinds", () => {
  it("names the four things the product produces", () => {
    expect([...AIGC_ACTION_KINDS]).toEqual(["image", "video", "audio", "text"]);
  });

  it("refuses a task-shaped value", () => {
    // `text-to-speech` and `music-generation` were the two values the deleted `task` field held.
    // Both are audio; accepting either here would reintroduce the axis this enum replaces.
    expect(AigcActionKindSchema.safeParse("text-to-speech").success).toBe(false);
    expect(AigcActionKindSchema.safeParse("music-generation").success).toBe(false);
  });

  it("is not the asset kinds", () => {
    // Two enums that differ by one member each are easy to use interchangeably by accident. They
    // answer different questions: what can be stored, and what can be produced.
    expect(AigcActionKindSchema.safeParse("model").success).toBe(false);
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
