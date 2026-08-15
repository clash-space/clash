import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MODEL_CARDS } from "@clash/shared-types";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LocalAudioConfigStore } from "./audio-config.js";
import { createLocalSpeechTranscriptionService } from "./local-speech-transcription.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function transcript(modelId: string) {
  return {
    schemaVersion: 1 as const,
    kind: "clash.asr.timed-transcript" as const,
    timebase: "milliseconds" as const,
    alignment: "word" as const,
    text: "hello world",
    backendId: "funasr",
    modelId,
    language: "en",
    durationMs: 920,
    words: [
      { id: "word-1", text: "hello", startMs: 80, endMs: 410 },
      { id: "word-2", text: "world", startMs: 500, endMs: 920 },
    ],
    segments: [
      {
        id: "segment-1",
        text: "hello world",
        startMs: 80,
        endMs: 920,
        wordIds: ["word-1", "word-2"],
      },
    ],
  };
}

describe("Local speech transcription Host capability", () => {
  it("maps a canonical ASR card to its runtime model and preserves real word timing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "clash-asr-generator-"));
    directories.push(directory);
    const sourcePath = join(directory, "source.wav");
    await writeFile(sourcePath, Buffer.from("RIFF-real-audio"));
    const card = MODEL_CARDS.find(
      (candidate) => candidate.id === "sensevoice-small-asr",
    );
    expect(card).toBeDefined();
    const runtimeModel = card?.defaultParams.asr_model;
    expect(typeof runtimeModel).toBe("string");
    if (typeof runtimeModel !== "string") return;

    const transcribe = vi.fn<LocalAudioConfigStore["transcribe"]>(
      async ({ model }) => transcript(model ?? "missing"),
    );
    const service = createLocalSpeechTranscriptionService({
      audioConfig: { transcribe },
      openAsset: async () => ({
        kind: "audio",
        path: sourcePath,
        contentType: "audio/wav",
      }),
    });

    await expect(
      service({
        projectId: "project-1",
        invocationId: "invocation-1",
        taskId: "run-1",
        reference: {
          slot: "source",
          index: 0,
          asset: {
            assetId: "audio-1",
            uri: "clash-asset://audio-1",
            kind: "audio",
            mediaType: "audio/wav",
          },
        },
        modelId: "sensevoice-small-asr",
        language: "en",
      }),
    ).resolves.toEqual({
      status: "completed",
      transcript: transcript("sensevoice-small-asr"),
    });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(transcribe).toHaveBeenCalledWith({
      file: expect.objectContaining({ name: "source.wav", type: "audio/wav" }),
      language: "en",
      model: runtimeModel,
    });
  });

  it("fails closed for an undeclared ASR model, a non-media source, or foreign poll state", async () => {
    const transcribe = vi.fn<LocalAudioConfigStore["transcribe"]>();
    const openAsset = vi.fn(async () => ({
      kind: "image" as const,
      path: "/private/source.png",
      contentType: "image/png",
    }));
    const service = createLocalSpeechTranscriptionService({
      audioConfig: { transcribe },
      openAsset,
    });
    const request = {
      projectId: "project-1",
      invocationId: "invocation-1",
      taskId: "run-1",
      reference: {
        slot: "source" as const,
        index: 0,
        asset: {
          assetId: "audio-1",
          uri: "clash-asset://audio-1",
          kind: "audio" as const,
          mediaType: "audio/wav",
        },
      },
      modelId: "not-a-declared-asr-card",
    };

    await expect(service(request)).rejects.toThrow(
      "not a declared local ASR model",
    );
    await expect(
      service({
        ...request,
        modelId: "sensevoice-small-asr",
      }),
    ).rejects.toThrow("is not an audio or video Asset");
    await expect(
      service({
        ...request,
        modelId: "sensevoice-small-asr",
        poll: { token: "foreign" },
      }),
    ).rejects.toThrow("does not issue poll state");
    expect(transcribe).not.toHaveBeenCalled();
  });
});
