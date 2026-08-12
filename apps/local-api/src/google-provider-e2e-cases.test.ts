import { createHash } from "node:crypto";

import { listProviderModelSupport } from "@clash/shared-types";
import { describe, expect, it } from "vitest";

import {
  createGoogleOmniProviderCases,
  createGoogleProviderCases,
} from "./google-provider-e2e-cases.js";

describe("Google provider backend case coverage", () => {
  it("executes at least one backend case for every Google model card", async () => {
    const catalogModelIds = listProviderModelSupport()
      .filter(
        (support) =>
          support.providerId === "official" &&
          support.upstreamId === "google-ai-studio" &&
          support.region === "global",
      )
      .flatMap((support) => support.models.map((model) => model.id));
    const cases = [
      ...(await createGoogleProviderCases()),
      ...createGoogleOmniProviderCases(),
    ];
    const caseModelIds = new Set(cases.map((candidate) => candidate.modelId));

    expect([...caseModelIds].sort()).toEqual([...catalogModelIds].sort());
    for (const modelId of catalogModelIds) {
      expect(
        cases.some((candidate) => candidate.modelId === modelId),
        `${modelId} has no executable backend case`,
      ).toBe(true);
    }
  });

  it("grades ASR against known speech and a pinned transcript", async () => {
    const asr = (await createGoogleProviderCases()).find(
      (candidate) => candidate.id === "google-asr",
    );
    const speech = asr?.refs?.[0]?.bytes;

    expect(asr?.expect).toEqual({
      kind: "text",
      text: "你好clash，测试时间对齐",
      textMatch: "normalized",
    });
    expect(speech).toBeDefined();
    expect(createHash("sha256").update(speech!).digest("hex")).toBe(
      "1ff791b7cd0c9a3069abdaaa55063e4f2a2a44abab0698c168a7f5a32ad06f42",
    );
  });
});
