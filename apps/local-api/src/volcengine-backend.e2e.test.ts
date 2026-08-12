import { describe, expect, it } from "vitest";

import { runProviderReplayTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";
import {
  createVolcengineSeedAudioCases,
  VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
} from "./volcengine-provider-e2e-cases.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

describe("Volcengine provider replay", () => {
  it("grades every Seed Audio input mode through the Project backend", async () => {
    const cases = await createVolcengineSeedAudioCases();
    const result = await runProviderReplayTestHarness({
      fixturePath: VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
      account: {
        id: "volcengine-replay",
        providerId: "volcengine-speech",
        upstreamId: "volcengine-speech",
        credentials: { apiKey: "offline-replay-placeholder" },
      },
      cases,
      bundledPluginIds: ["clash.volcengine"],
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind })).sort((a, b) =>
      a.id.localeCompare(b.id)
    )).toEqual(
      cases.map(({ id }) => ({ id, kind: "audio" })).sort((a, b) =>
        a.id.localeCompare(b.id)
      ),
    );

    const events = await readJsonlProviderTestRecording(
      VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
    );
    const bodies = events.flatMap((event): Record<string, unknown>[] => {
      if (
        event.type !== "request"
        || !event.request.url.endsWith("/api/v3/tts/create")
        || !isRecord(event.request.body)
      ) return [];
      return [event.request.body];
    });
    expect(bodies).toHaveLength(3);
    expect(bodies.some((body) => !("references" in body))).toBe(true);
    expect(bodies.some((body) =>
      Array.isArray(body.references)
      && body.references.some((reference) =>
        isRecord(reference) && typeof reference.image_data === "string"
      )
    )).toBe(true);
    expect(bodies.some((body) =>
      Array.isArray(body.references)
      && body.references.some((reference) =>
        isRecord(reference) && typeof reference.audio_data === "string"
      )
    )).toBe(true);
  }, 180_000);
});
