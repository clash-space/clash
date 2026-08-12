import { describe, expect, it } from "vitest";

import {
  createHiloProviderCases,
  HILO_H3_REPLAY_FIXTURE_PATH,
  HILO_SEEDANCE_REPLAY_FIXTURE_PATH,
  prepareHiloProviderTestPlugin,
} from "./hilo-provider-e2e-cases.js";
import { runProviderReplayTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

describe("Hilo Hub provider replay", () => {
  const account = {
    id: "hilo-hub-replay",
    providerId: "hilo-hub",
    upstreamId: "hilo-hub",
    credentials: { accessToken: "offline-replay-placeholder" },
  };

  it("grades H3 image+MP3 references through the Project backend", async () => {
    const cases = await createHiloProviderCases();
    const result = await runProviderReplayTestHarness({
      fixturePath: HILO_H3_REPLAY_FIXTURE_PATH,
      account,
      cases: cases.filter(({ id }) => id === "hilo-minimax-h3-image-mp3"),
      preparePlugins: prepareHiloProviderTestPlugin,
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "hilo-minimax-h3-image-mp3", kind: "video" },
    ]);

    const events = await readJsonlProviderTestRecording(
      HILO_H3_REPLAY_FIXTURE_PATH,
    );
    const requests = events.filter((event) => event.type === "request");
    const uploads = requests.filter((event) =>
      event.request.url.includes("/api/v1/files/upload")
    );
    expect(uploads).toHaveLength(2);
    expect(
      uploads
        .map((event) => record(event.request.body).file_prefix)
        .sort(),
    ).toEqual(["audio", "image"]);
    for (const upload of uploads.filter((event) =>
      record(event.request.body).file_prefix === "audio"
    )) {
      expect(record(upload.request.body).file_data)
        .toEqual(expect.stringMatching(/^data:audio\/mp3;base64,/));
    }

    const h3Submit = requests.find((event) =>
      event.request.url.includes("/api/v1/video/minimax-v3/generate")
    );
    expect(record(h3Submit?.request.body)).toMatchObject({
      model: "MiniMax-H3",
      reference_images: [expect.stringMatching(/^https:\/\//)],
      reference_audios: [expect.stringMatching(/\.mp3(?:\?|$)/)],
    });
  }, 180_000);

  it("grades Seedance image+MP3 references through the Project backend", async () => {
    const cases = await createHiloProviderCases();
    const result = await runProviderReplayTestHarness({
      fixturePath: HILO_SEEDANCE_REPLAY_FIXTURE_PATH,
      account,
      cases: cases.filter(
        ({ id }) => id === "hilo-seedance-2-audio-reference",
      ),
      preparePlugins: prepareHiloProviderTestPlugin,
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "hilo-seedance-2-audio-reference", kind: "video" },
    ]);

    const events = await readJsonlProviderTestRecording(
      HILO_SEEDANCE_REPLAY_FIXTURE_PATH,
    );
    const requests = events.filter((event) => event.type === "request");
    const uploads = requests.filter((event) =>
      event.request.url.includes("/api/v1/files/upload")
    );
    expect(uploads).toHaveLength(2);
    expect(
      uploads
        .map((event) => record(event.request.body).file_prefix)
        .sort(),
    ).toEqual(["audio", "image"]);
    const audioUpload = uploads.find((event) =>
      record(event.request.body).file_prefix === "audio"
    );
    expect(record(audioUpload?.request.body).file_data)
      .toEqual(expect.stringMatching(/^data:audio\/mp3;base64,/));

    const seedanceSubmit = requests.find((event) =>
      event.request.url.includes("/api/v1/video/seedance/generate")
    );
    expect(record(seedanceSubmit?.request.body)).toMatchObject({
      model: "seedance2.0",
      reference_images: [expect.stringMatching(/^https:\/\//)],
      reference_audios: [expect.stringMatching(/\.mp3(?:\?|$)/)],
    });
  }, 180_000);
});
