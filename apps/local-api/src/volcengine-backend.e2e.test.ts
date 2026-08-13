import { describe, expect, it } from "vitest";

import { runProviderReplayTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";
import {
  createVolcengineModelArkCases,
  createVolcengineSeedAudioCases,
  VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH,
  VOLCENGINE_SEED_AUDIO_REPLAY_FIXTURE_PATH,
} from "./volcengine-provider-e2e-cases.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

describe("Volcengine provider replay", () => {
  it("grades every Seedance 2.0 and 2.5 input mode through the Project backend", async () => {
    const cases = await createVolcengineModelArkCases();
    const result = await runProviderReplayTestHarness({
      fixturePath: VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH,
      account: {
        id: "volcengine-modelark-replay",
        providerId: "volcengine",
        upstreamId: "volcengine",
        credentials: { apiKey: "offline-replay-placeholder" },
      },
      cases,
      bundledPluginIds: ["clash.volcengine"],
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual(
      cases.map(({ id }) => ({ id, kind: "video" })),
    );

    const events = await readJsonlProviderTestRecording(
      VOLCENGINE_MODELARK_REPLAY_FIXTURE_PATH,
    );
    const submissions = events.flatMap((event): Record<string, unknown>[] => {
      if (
        event.type !== "request"
        || !event.request.url.endsWith("/contents/generations/tasks")
        || !isRecord(event.request.body)
      ) return [];
      return [event.request.body];
    });
    expect(submissions).toHaveLength(cases.length);
    expect(new Set(submissions.map(({ model }) => model))).toEqual(
      new Set([
        "doubao-seedance-2-0-260128",
        "doubao-seedance-2-5-260628",
      ]),
    );
    expect(
      new Set(
        submissions.flatMap(({ omni_reference_task_type }) =>
          typeof omni_reference_task_type === "string"
            ? [omni_reference_task_type]
            : [],
        ),
      ),
    ).toEqual(new Set(["reference", "edit", "extend"]));
    expect(
      submissions.some(({ content }) =>
        Array.isArray(content)
        && content.some((part) => isRecord(part) && part.role === "first_frame")
        && content.some((part) => isRecord(part) && part.role === "last_frame")
      ),
    ).toBe(true);
    expect(
      submissions.filter(({ model }) => model === "doubao-seedance-2-5-260628")
        .every(({ output_format }) => output_format === "mp4"),
    ).toBe(true);
  }, 180_000);

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
