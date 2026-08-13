import { describe, expect, it } from "vitest";

import { MODEL_CARDS } from "@clash/shared-types";

import { localExecutableModelCards } from "./local-aigc.js";

describe("local model execution boundaries", () => {
  it("keeps only executable Provider plugins and the local TTS built-in", () => {
    const implementations = localExecutableModelCards(MODEL_CARDS).flatMap(
      (card) => card.providerImplementations ?? [],
    );

    expect(
      implementations.every(
        (implementation) =>
          implementation.apiShape === "local-tts" ||
          (typeof implementation.executorPluginId === "string" &&
            typeof implementation.executorExportId === "string"),
      ),
    ).toBe(true);
  });
});
