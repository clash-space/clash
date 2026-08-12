import { listProviderModelSupport } from "@clash/shared-types";
import { describe, expect, it } from "vitest";

import { createMiniMaxProviderCases } from "./minimax-provider-e2e-cases.js";

describe("MiniMax provider backend case coverage", () => {
  it("executes at least one backend case for every MiniMax model card", async () => {
    const catalogModelIds = listProviderModelSupport()
      .filter(
        (support) =>
          support.providerId === "minimax"
          && (support.upstreamId === undefined || support.upstreamId === "minimax"),
      )
      .flatMap((support) => support.models.map((model) => model.id));
    const cases = await createMiniMaxProviderCases();
    const caseModelIds = new Set(cases.map((candidate) => candidate.modelId));

    expect([...caseModelIds].sort()).toEqual([...new Set(catalogModelIds)].sort());
    for (const modelId of catalogModelIds) {
      expect(
        cases.some((candidate) => candidate.modelId === modelId),
        `${modelId} has no executable backend case`,
      ).toBe(true);
    }
  });
});
