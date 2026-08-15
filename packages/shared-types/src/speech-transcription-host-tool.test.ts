import { describe, expect, it } from "vitest";

import * as executablePlugin from "./executable-plugin.js";
import * as publicTypes from "./index.js";

const audioReference = {
  slot: "source",
  index: 0,
  asset: {
    assetId: "audio-1",
    uri: "clash-asset://audio-1",
    kind: "audio",
    mediaType: "audio/wav",
  },
} as const;

describe("speech transcription Host tool contract", () => {
  it("carries only a frozen audio or video reference plus model, language, and poll state", () => {
    const schema = (executablePlugin as Record<string, unknown>)
      .ExecutableSpeechTranscriptionOperationSchema as
      | {
          safeParse(value: unknown): { success: boolean };
        }
      | undefined;

    expect(schema).toBeDefined();
    if (!schema) return;

    expect(
      schema.safeParse({
        kind: "speech.transcribe",
        reference: audioReference,
        modelId: "iic/SenseVoiceSmall",
        language: "zh",
        poll: { upstreamTaskId: "asr-1" },
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        kind: "speech.transcribe",
        reference: {
          ...audioReference,
          asset: { ...audioReference.asset, kind: "video" },
        },
        modelId: "chirp_3",
      }).success,
    ).toBe(true);

    for (const invalid of [
      {
        kind: "speech.transcribe",
        reference: {
          ...audioReference,
          asset: { ...audioReference.asset, kind: "image" },
        },
        modelId: "iic/SenseVoiceSmall",
      },
      {
        kind: "speech.transcribe",
        reference: audioReference,
        modelId: "iic/SenseVoiceSmall",
        path: "/private/project/source.wav",
      },
      {
        kind: "speech.transcribe",
        reference: audioReference,
        modelId: "iic/SenseVoiceSmall",
        url: "https://assets.example.test/source.wav",
      },
      {
        kind: "speech.transcribe",
        reference: audioReference,
        modelId: "iic/SenseVoiceSmall",
        credentials: { apiKey: "must-not-cross" },
      },
    ]) {
      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("accepts a completed result only when it contains a valid timed transcript", () => {
    const schema = (executablePlugin as Record<string, unknown>)
      .ExecutableSpeechTranscriptionResultSchema as
      | {
          safeParse(value: unknown): { success: boolean };
        }
      | undefined;

    expect(schema).toBeDefined();
    if (!schema) return;

    const transcript = {
      schemaVersion: 1,
      kind: "clash.asr.timed-transcript",
      timebase: "milliseconds",
      alignment: "word",
      text: "hello world",
      backendId: "funasr",
      modelId: "iic/SenseVoiceSmall",
      language: "en",
      durationMs: 840,
      words: [
        { id: "word-1", text: "hello", startMs: 80, endMs: 360 },
        { id: "word-2", text: "world", startMs: 420, endMs: 840 },
      ],
      segments: [
        {
          id: "segment-1",
          text: "hello world",
          startMs: 80,
          endMs: 840,
          wordIds: ["word-1", "word-2"],
        },
      ],
    };

    expect(schema.safeParse({ status: "completed", transcript }).success).toBe(
      true,
    );
    expect(
      schema.safeParse({
        status: "completed",
        transcript: {
          ...transcript,
          durationMs: 1,
          words: [{ id: "word-1", text: "hello world", startMs: 0, endMs: 0 }],
          segments: [],
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ status: "completed", transcript: "hello world" })
        .success,
    ).toBe(false);
  });

  it("requires opaque poll state when speech work is accepted asynchronously", () => {
    const schema = (executablePlugin as Record<string, unknown>)
      .ExecutableSpeechTranscriptionResultSchema as {
      safeParse(value: unknown): { success: boolean };
    };

    expect(
      schema.safeParse({
        status: "accepted",
        poll: { upstreamTaskId: "asr-1", region: "us-central1" },
        retryAfterMs: 1_500,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ status: "accepted" }).success).toBe(false);
  });

  it("requires an explicit speech transcription Host tool contribution", () => {
    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "clash.asr",
      version: "1.0.0",
      name: "Clash ASR",
      runtime: {
        kind: "local",
        transport: "stdio",
        entrypoint: "dist/stdio.mjs",
      },
      contributes: {
        functions: [
          {
            id: "transcribe",
            kind: "action",
            operations: ["submit", "poll"],
          },
        ],
        hostTools: ["speech.transcribe"],
      },
    };
    const request = {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: {
        kind: "speech.transcribe",
        reference: audioReference,
        modelId: "iic/SenseVoiceSmall",
      },
    };

    expect(() =>
      executablePlugin.ExecutablePluginManifestSchema.parse(manifest),
    ).not.toThrow();
    expect(
      executablePlugin.executablePluginDependencyError(manifest, request),
    ).toBeNull();
    expect(
      executablePlugin.executablePluginDependencyError(
        {
          ...manifest,
          contributes: { ...manifest.contributes, hostTools: [] },
        },
        request,
      ),
    ).toMatch(/speech transcription/i);
  });

  it("exports the speech Host tool schemas from the shared public contract", () => {
    expect(publicTypes.ExecutableSpeechTranscriptionReferenceSchema).toBe(
      executablePlugin.ExecutableSpeechTranscriptionReferenceSchema,
    );
    expect(publicTypes.ExecutableSpeechTranscriptionOperationSchema).toBe(
      executablePlugin.ExecutableSpeechTranscriptionOperationSchema,
    );
    expect(publicTypes.ExecutableSpeechTranscriptionResultSchema).toBe(
      executablePlugin.ExecutableSpeechTranscriptionResultSchema,
    );
  });
});
