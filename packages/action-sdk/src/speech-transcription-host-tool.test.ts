import { describe, expect, it } from "vitest";

import { createExecutorContext } from "./define-plugin.js";

const reference = {
  slot: "source",
  index: 0,
  asset: {
    assetId: "audio-1",
    uri: "clash-asset://audio-1",
    kind: "audio" as const,
    mediaType: "audio/wav",
  },
};

const transcript = {
  schemaVersion: 1 as const,
  kind: "clash.asr.timed-transcript" as const,
  timebase: "milliseconds" as const,
  alignment: "word" as const,
  text: "hello",
  backendId: "funasr",
  modelId: "iic/SenseVoiceSmall",
  language: "en",
  durationMs: 480,
  words: [{ id: "word-1", text: "hello", startMs: 40, endMs: 480 }],
  segments: [
    {
      id: "segment-1",
      text: "hello",
      startMs: 40,
      endMs: 480,
      wordIds: ["word-1"],
    },
  ],
};

describe("speech transcription SDK Host tool", () => {
  it("maps the typed SDK request onto the credential-free Broker operation", async () => {
    let received: unknown;
    const context = createExecutorContext({}, async (operation) => {
      received = operation;
      return { status: "completed", transcript };
    });
    const speechTranscribe = (
      context.hostTools as unknown as Record<string, unknown>
    ).speechTranscribe as
      ((request: Record<string, unknown>) => Promise<unknown>) | undefined;

    expect(speechTranscribe).toBeTypeOf("function");
    if (!speechTranscribe) return;

    await expect(
      speechTranscribe({
        reference,
        modelId: "iic/SenseVoiceSmall",
        language: "en",
        poll: { upstreamTaskId: "asr-1" },
      }),
    ).resolves.toEqual({ status: "completed", transcript });
    expect(received).toEqual({
      kind: "speech.transcribe",
      reference,
      modelId: "iic/SenseVoiceSmall",
      language: "en",
      poll: { upstreamTaskId: "asr-1" },
    });
  });

  it("rejects a Host response that is not a valid timed transcript", async () => {
    const context = createExecutorContext({}, async () => ({
      status: "completed",
      transcript: {
        ...transcript,
        durationMs: 1,
        words: [{ id: "word-1", text: "hello", startMs: 0, endMs: 0 }],
        segments: [],
      },
    }));

    await expect(
      context.hostTools.speechTranscribe({
        reference,
        modelId: "iic/SenseVoiceSmall",
      }),
    ).rejects.toThrow(/invalid speech transcription result/i);
  });
});
