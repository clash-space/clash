import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models";

describe("Kling 3 model card", () => {
  it("publishes every fal-supported duration from 3 through 15 seconds", () => {
    const model = MODEL_CARDS.find((candidate) => candidate.id === "kling-3");
    const duration = model?.parameters.find((parameter) => parameter.id === "duration");

    // Seconds are numbers in every card, so `value === 5` means the same thing
    // everywhere. fal wants them as strings, and `kling.ts` already applies that
    // spelling when it builds the request.
    expect(duration?.options?.map((option) => option.value)).toEqual(
      Array.from({ length: 13 }, (_, index) => index + 3),
    );
    expect(duration?.defaultValue).toBe(5);
    expect(model?.defaultParams.duration).toBe(5);
  });
});
