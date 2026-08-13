import { describe, expect, it } from "vitest";

import type { ProviderReplayTestCase } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";
import * as volcengineCases from "./volcengine-provider-e2e-cases.js";

type CaseFactory = () => Promise<ProviderReplayTestCase[]>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

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
      expect(pngDimensions(reference.bytes)).toEqual({
        width: 300,
        height: 300,
      });
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

  it("selects only successful cases actually present in the committed ModelArk replay", async () => {
    const events = await readJsonlProviderTestRecording(
      volcengineCases.VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH,
    );
    const responseStatus = new Map(
      events.flatMap((event) =>
        event.type === "response"
          ? [[event.requestId, event.response.status] as const]
          : [],
      ),
    );
    const recordedModelIds = events.flatMap((event): string[] => {
      if (
        event.type !== "request" ||
        event.request.method !== "POST" ||
        !event.request.url.endsWith("/contents/generations/tasks") ||
        (responseStatus.get(event.requestId) ?? 500) >= 300
      ) {
        return [];
      }
      const separator = event.stub.id.lastIndexOf("::");
      return separator < 0 ? [] : [event.stub.id.slice(separator + 2)];
    });

    const cases = await volcengineCases.createVolcengineModelArkReplayCases();

    expect(cases.map(({ modelId }) => modelId)).toEqual(recordedModelIds);
    expect(
      cases.some(({ refs = [] }) =>
        refs.some((reference) => reference.kind === "video"),
      ),
    ).toBe(false);
  });

  it("builds Seed Audio replay cases from the three recorded text-only requests", async () => {
    const events = await readJsonlProviderTestRecording(
      volcengineCases.VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
    );
    const requests = events.flatMap((event): Record<string, unknown>[] => {
      if (
        event.type !== "request" ||
        event.request.method !== "POST" ||
        !event.request.url.endsWith("/api/v3/tts/create") ||
        !isRecord(event.request.body)
      ) {
        return [];
      }
      return [event.request.body];
    });

    const cases = await volcengineCases.createVolcengineSeedAudioReplayCases();

    expect(cases.map(({ prompt }) => prompt)).toEqual(
      requests.map(({ text_prompt }) => text_prompt),
    );
    expect(cases.map(({ params }) => params)).toEqual(
      requests.map(({ audio_config }) => audio_config),
    );
    expect(cases.every(({ refs = [] }) => refs.length === 0)).toBe(true);
  });
});
