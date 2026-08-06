import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models";

describe("Kling 3 model card", () => {
  it("publishes every fal-supported duration from 3 through 15 seconds", () => {
    const model = MODEL_CARDS.find((candidate) => candidate.id === "kling-3");
    const duration = model?.parameters.find((parameter) => parameter.id === "duration");

    expect(duration?.options?.map((option) => option.value)).toEqual(
      Array.from({ length: 13 }, (_, index) => String(index + 3)),
    );
    expect(duration?.defaultValue).toBe("5");
    expect(model?.defaultParams.duration).toBe("5");
  });
});
