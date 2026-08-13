import { describe, expect, it } from "vitest";

import type { ProviderReplayTestCase } from "./provider-replay-test-harness.js";
import * as volcengineCases from "./volcengine-provider-e2e-cases.js";

type CaseFactory = () => Promise<ProviderReplayTestCase[]>;

function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(bytes);
  return {
    width: view.readUInt32BE(16),
    height: view.readUInt32BE(20),
  };
}

describe("Volcengine provider E2E cases", () => {
  it("covers every published Seedance 2.0 and 2.5 input mode", async () => {
    const createModelArkCases = (
      volcengineCases as typeof volcengineCases & {
        createVolcengineModelArkCases?: CaseFactory;
      }
    ).createVolcengineModelArkCases;

    expect(createModelArkCases).toBeTypeOf("function");
    if (!createModelArkCases) return;

    const cases = await createModelArkCases();
    expect(cases.map(({ id }) => id)).toEqual([
      "volcengine-seedance-2-text",
      "volcengine-seedance-2-reference",
      "volcengine-seedance-2-startend",
      "volcengine-seedance-2-extend",
      "volcengine-seedance-2.5-text",
      "volcengine-seedance-2.5-reference",
      "volcengine-seedance-2.5-edit",
      "volcengine-seedance-2.5-startend",
      "volcengine-seedance-2.5-extend",
    ]);

    const imageReferences = cases.flatMap(({ refs = [] }) =>
      refs.filter(({ kind }) => kind === "image"),
    );
    expect(imageReferences.length).toBeGreaterThan(0);
    for (const reference of imageReferences) {
      expect(pngDimensions(reference.bytes)).toEqual({ width: 300, height: 300 });
    }

    const videoReferences = cases.flatMap(({ refs = [] }) =>
      refs.filter(({ kind }) => kind === "video"),
    );
    expect(videoReferences.map(({ mediaType }) => mediaType)).toEqual([
      "video/mp4",
      "video/mp4",
      "video/mp4",
    ]);
  });
});
