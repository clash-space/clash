import { describe, expect, it } from "vitest";

import {
  createMiniMaxProviderCases,
  MINIMAX_MIXED_REPLAY_FIXTURE_PATH,
  MINIMAX_REPLAY_FIXTURE_PATH,
  MINIMAX_STARTEND_REPLAY_FIXTURE_PATH,
} from "./minimax-provider-e2e-cases.js";
import { runProviderReplayTestHarness } from "./provider-replay-test-harness.js";
import { readJsonlProviderTestRecording } from "./provider-test-recorder.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function replayAccount(id: string) {
  return {
    id,
    providerId: "minimax",
    upstreamId: "minimax",
    credentials: {
      apiKey: "offline-replay-placeholder",
      service: "international",
    },
  };
}

describe("MiniMax provider replay", () => {
  it("grades M3, TTS, Music, and base H3 through the Project backend", async () => {
    const cases = await createMiniMaxProviderCases();
    const separatelyRecordedIds = new Set([
      "minimax-h3-mixed-references",
      "minimax-h3-mixed-image-audio",
      "minimax-h3-startend",
    ]);
    const baseCases = cases.filter(({ id }) => !separatelyRecordedIds.has(id));
    const result = await runProviderReplayTestHarness({
      fixturePath: MINIMAX_REPLAY_FIXTURE_PATH,
      account: replayAccount("minimax-replay"),
      cases: baseCases,
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "minimax-m3", kind: "text" },
      { id: "minimax-tts", kind: "audio" },
      { id: "minimax-music-3", kind: "audio" },
      { id: "minimax-h3", kind: "video" },
    ]);
  }, 180_000);

  it("grades start/end H3 through the Project backend and current upload protocol", async () => {
    const cases = await createMiniMaxProviderCases();
    const startEndCases = cases.filter(({ id }) => id === "minimax-h3-startend");
    const result = await runProviderReplayTestHarness({
      fixturePath: MINIMAX_STARTEND_REPLAY_FIXTURE_PATH,
      account: replayAccount("minimax-startend-replay"),
      cases: startEndCases,
    });

    expect(result.cases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "minimax-h3-startend", kind: "video" },
    ]);
  }, 180_000);

  it("preserves H3 mixed image and audio reference order through the Project backend and MiniMax plugin", async () => {
    const cases = await createMiniMaxProviderCases();
    const mixedIds = new Set([
      "minimax-h3-mixed-references",
      "minimax-h3-mixed-image-audio",
    ]);
    const mixedCases = cases.filter(({ id }) => mixedIds.has(id));
    const mixedResult = await runProviderReplayTestHarness({
      fixturePath: MINIMAX_MIXED_REPLAY_FIXTURE_PATH,
      account: replayAccount("minimax-mixed-replay"),
      cases: mixedCases,
    });

    expect(mixedResult.cases.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: "minimax-h3-mixed-references", kind: "video" },
      { id: "minimax-h3-mixed-image-audio", kind: "video" },
    ]);

    const events = await readJsonlProviderTestRecording(
      MINIMAX_MIXED_REPLAY_FIXTURE_PATH,
    );
    const submissions: unknown[][] = events.flatMap((event): unknown[][] => {
      if (
        event.type !== "request" ||
        !event.request.url.includes("/v2/video_generation") ||
        !isRecord(event.request.body)
      ) {
        return [];
      }
      if (!("content" in event.request.body)) return [];
      const content = event.request.body.content;
      return Array.isArray(content) ? [content as unknown[]] : [];
    });
    const project = (needle: string) => {
      const content = submissions.find((parts) =>
        parts.some((part) =>
          isRecord(part) &&
          typeof part.text === "string" && part.text.includes(needle)
        )
      );
      return content?.map((part) => {
        if (!isRecord(part)) return part;
        return part.type === "text"
          ? { type: part.type, text: part.text }
          : { type: part.type, role: part.role };
      });
    };

    expect(project("scene opens")).toEqual([
      {
        type: "text",
        text:
          "Keep Crimson Subject centered while the scene opens, then move into Blue Environment as the camera pushes forward.",
      },
      { type: "image_url", role: "reference_image" },
      { type: "image_url", role: "reference_image" },
    ]);
    expect(project("synchronize the motion")).toEqual([
      {
        type: "text",
        text:
          "Keep Crimson Subject centered, then synchronize the motion to Reference Beat before holding the final pose.",
      },
      { type: "image_url", role: "reference_image" },
      { type: "audio_url", role: "reference_audio" },
    ]);
    const mixedAudioContent = submissions.find((parts) =>
      parts.some((part) =>
        isRecord(part) && typeof part.text === "string" &&
        part.text.includes("synchronize the motion")
      )
    );
    const recordedAudio = mixedAudioContent?.find((part) =>
      isRecord(part) && part.role === "reference_audio"
    );
    const recordedAudioUrl =
      isRecord(recordedAudio) && isRecord(recordedAudio.audio_url)
        ? recordedAudio.audio_url.url
        : undefined;
    expect(recordedAudioUrl).toEqual(
      expect.stringMatching(/^mm_file:\/\/\d+$/),
    );

    const audioUpload = events.find((event) => {
      if (
        event.type !== "request"
        || !event.request.url.endsWith("/v1/files/upload")
        || !isRecord(event.request.body)
      ) return false;
      const parts = event.request.body.$multipart;
      return Array.isArray(parts) && parts.some((part) =>
        isRecord(part)
        && isRecord(part.file)
        && part.file.type === "audio/mpeg"
        && typeof part.file.name === "string"
        && part.file.name.endsWith(".mp3")
      );
    });
    expect(audioUpload?.type).toBe("request");
    const audioUploadResponse = events.find((event) =>
      event.type === "response" && event.requestId === audioUpload?.requestId
    );
    const uploadedFile =
      audioUploadResponse?.type === "response"
      && isRecord(audioUploadResponse.response.body)
      && isRecord(audioUploadResponse.response.body.file)
        ? audioUploadResponse.response.body.file
        : undefined;
    expect(recordedAudioUrl).toBe(`mm_file://${String(uploadedFile?.file_id)}`);
  }, 180_000);
});
