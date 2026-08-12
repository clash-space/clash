import { describe, expect, it } from "vitest";

import { listModelUpstreamRoutes } from "./model-routing.js";
import { MODEL_CARDS } from "./models.js";

describe("Seed Audio 1.0 model card", () => {
  it("publishes the verified reference and audio-control contract", () => {
    const card = MODEL_CARDS.find((candidate) => candidate.id === "seed-audio-1");
    if (!card) throw new Error("Missing Seed Audio 1.0 model card.");

    expect(card.input).toMatchObject({
      requiresPrompt: true,
      referenceBinding: {
        type: "positional-tokens",
        modalityScopedIndexes: true,
        tokens: { audio: "@音频{n}" },
      },
      inputMode: {
        images: {
          max: 1,
          constraints: {
            mimeTypes: ["image/jpeg", "image/png", "image/webp"],
            fileExtensions: ["jpg", "jpeg", "png", "webp"],
            maxBytes: 10 * 1024 * 1024,
          },
        },
        audios: {
          max: 3,
          constraints: {
            mimeTypes: [
              "audio/wav",
              "audio/x-wav",
              "audio/mpeg",
              "audio/mp3",
              "audio/pcm",
              "audio/ogg",
              "audio/opus",
            ],
            fileExtensions: ["wav", "mp3", "pcm", "ogg", "opus"],
            maxBytes: 10 * 1024 * 1024,
            maxDurationMs: 30_000,
          },
        },
        maxTotalReferences: 3,
      },
    });
    expect(card.constraints).toContainEqual({
      type: "max-length",
      field: "prompt",
      max: 3000,
      message: "Seed Audio prompts support at most 3000 characters.",
    });
    expect(card.parameters.map((parameter) => parameter.id)).toEqual([
      "voice_id",
      "speed",
      "volume",
      "pitch",
      "sample_rate",
      "format",
    ]);
    expect(
      card.parameters
        .find((parameter) => parameter.id === "sample_rate")
        ?.options?.map((option) => option.value),
    ).toEqual([8000, 16000, 24000, 32000, 44100, 48000]);
    expect(
      card.parameters
        .find((parameter) => parameter.id === "format")
        ?.options?.map((option) => option.value),
    ).toEqual(["wav", "mp3", "pcm", "ogg_opus"]);
  });

  it("routes the card through its own bundled Volcengine Speech provider", () => {
    expect(
      listModelUpstreamRoutes({
        modelCode: "seed-audio-1",
        kind: "audio",
        configuredProviders: [
          {
            providerId: "volcengine-speech",
            upstreamId: "volcengine-speech",
            enabled: true,
            configuredCredentials: ["apiKey"],
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        providerId: "volcengine-speech",
        upstreamId: "volcengine-speech",
        upstreamModel: "seed-audio-1.0",
        apiShape: "volcengine-speech",
        requiredCredentials: ["apiKey"],
        executorPluginId: "clash.volcengine",
        executorExportId: "volcengine-speech-execute",
      }),
    ]);
  });
});
