import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "./models.js";

describe("Veo 3.1 model cards", () => {
  it("only offers Agent Platform-supported output durations", () => {
    for (const id of [
      "veo-3.1",
      "veo-3.1-startend",
      "veo-3.1-fast",
      "veo-3.1-fast-startend",
    ]) {
      const model = MODEL_CARDS.find((candidate) => candidate.id === id);
      const duration = model?.parameters.find((parameter) => parameter.id === "duration");

      expect(duration?.type, id).toBe("select");
      expect(duration?.options?.map((option) => option.value), id).toEqual([4, 6, 8]);
      expect(duration?.defaultValue, id).toBe(4);
      expect(model?.defaultParams.duration, id).toBe(4);
    }
  });
});
