import { afterEach, describe, expect, it, vi } from "vitest";

import { generateElevenLabsAudio } from "./elevenlabs-audio";

describe("ElevenLabs audio service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the official text-to-speech endpoint and returns audio bytes", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateElevenLabsAudio("eleven-key", {
      prompt: "The first move matters.",
      modelName: "elevenlabs-tts",
      modelParams: {
        voice_id: "JBFqnCBsd6RMkjVDRZzb",
        model_id: "eleven_multilingual_v2",
        stability: 0.4,
        similarity_boost: 0.8,
      },
      baseUrl: "https://api.elevenlabs.io",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "xi-api-key": "eleven-key",
          "Content-Type": "application/json",
        }),
        body: JSON.stringify({
          text: "The first move matters.",
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.8,
          },
        }),
      }),
    );
    expect(result.data).toEqual(bytes);
    expect(result.mediaType).toBe("audio/mpeg");
    expect(result.model).toBe("eleven_multilingual_v2");
  });
});
