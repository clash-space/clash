import { describe, expect, it } from "vitest";
import { MODEL_CARDS, validateModelCardConfiguration } from "@clash/shared-types";

import { cardDurationFallback, durationFromData } from "./local-processor";

/**
 * A duration nobody asked for must be one the Card offers.
 *
 * When an action-badge carries no duration, the generation still has to name one. Two
 * hardcoded constants stood in for it — 4 seconds for video, 5 for audio — and any model
 * whose menu omits that number failed its own validator before reaching the provider:
 *
 *   seedance-2-fast-startend  candidates [auto, 4, 6, 8, 10, 15]
 *   injected                  5
 *   result                    "Duration must be one of the configured candidates."
 *
 * The Card already states the answer, so the fallback has to read it rather than repeat a
 * number that happens to suit most models.
 */
describe("duration fallback comes from the Card", () => {
  const videoCards = MODEL_CARDS.filter(card => card.kind === "video");

  it("offers a duration every video model accepts", () => {
    const offenders = videoCards
      .map(card => ({ id: card.id, duration: cardDurationFallback(card) }))
      .filter(({ id, duration }) => {
        const card = MODEL_CARDS.find(candidate => candidate.id === id)!;
        if (duration === undefined) return false;
        return validateModelCardConfiguration(card, {
          prompt: "a lit workshop",
          modelParams: { duration },
        }) !== null;
      });
    expect(offenders, "every fallback must satisfy its own Card").toEqual([]);
  });

  it("prefers the Card's declared default over any house number", () => {
    const startEnd = MODEL_CARDS.find(card => card.id === "seedance-2-fast-startend")!;
    expect(cardDurationFallback(startEnd)).toBe(startEnd.defaultParams.duration);
  });

  it("returns nothing for a model that takes no duration", () => {
    const speech = MODEL_CARDS.find(card => card.id === "minimax-speech-2.8-hd")!;
    expect(cardDurationFallback(speech)).toBeUndefined();
  });

  it("wires the Card into the value the generation actually receives", () => {
    // Testing the helper alone passes even if the caller keeps its old constant, which is
    // how the hardcoded 5 survived: the fallback has to be observed where it is consumed.
    const startEnd = MODEL_CARDS.find(card => card.id === "seedance-2-fast-startend")!;
    expect(durationFromData({}, startEnd)).toBe(startEnd.defaultParams.duration);
    expect(durationFromData({}, startEnd)).not.toBe(5);
  });

  it("still honours a duration the badge asked for", () => {
    const startEnd = MODEL_CARDS.find(card => card.id === "seedance-2-fast-startend")!;
    expect(durationFromData({ duration: 8 }, startEnd)).toBe(8);
  });
});
