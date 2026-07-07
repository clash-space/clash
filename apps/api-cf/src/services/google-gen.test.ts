import { afterEach, describe, expect, it, vi } from "vitest";

import { generateGoogleAudio, isGoogleAudioModel, isGoogleImageModel, isGoogleTextModel } from "./google-gen";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("Google audio generation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes supported Google Gemini TTS model cards", () => {
    expect(isGoogleAudioModel("gemini-3.1-flash-tts")).toBe(true);
    expect(isGoogleAudioModel("gemini-2.5-flash-tts")).toBe(false);
    expect(isGoogleAudioModel("gemini-2.5-pro-tts")).toBe(true);
    expect(isGoogleAudioModel("minimax-tts")).toBe(false);
  });

  it("calls Gemini TTS and wraps the PCM response as a WAV file", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      data: base64(new Uint8Array([1, 2, 3, 4])),
                    },
                  },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateGoogleAudio("test-key", {
      prompt: "Say cheerfully: Have a wonderful day!",
      modelName: "gemini-3.1-flash-tts",
      modelParams: { voice_name: "Puck" },
      baseUrl: "https://example.test/v1beta",
    });

    expect(result.model).toBe("gemini-3.1-flash-tts-preview");
    expect(result.mediaType).toBe("audio/wav");
    expect(new TextDecoder().decode(result.data.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(result.data.slice(8, 12))).toBe("WAVE");
    expect(result.data.length).toBe(48);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/v1beta/models/gemini-3.1-flash-tts-preview:generateContent");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "x-goog-api-key": "test-key",
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      contents: [{ parts: [{ text: "Say cheerfully: Have a wonderful day!" }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: "Puck" },
          },
        },
      },
    });
  });
});

describe("Google text generation", () => {
  it("recognizes current Google Agent Platform SOTA text model cards", () => {
    expect(isGoogleTextModel("gemini-3.5-flash")).toBe(true);
    expect(isGoogleTextModel("gemini-3.1-pro")).toBe(true);
    expect(isGoogleTextModel("gemini-3-flash")).toBe(true);
    expect(isGoogleTextModel("gemini-3.1-flash-lite")).toBe(true);
    expect(isGoogleTextModel("gemini-3.1-flash-lite-preview")).toBe(false);
  });
});

describe("Google image generation", () => {
  it("recognizes current Google Agent Platform SOTA image model cards", () => {
    expect(isGoogleImageModel("nano-banana-2")).toBe(true);
    expect(isGoogleImageModel("gemini-3.1-flash-image")).toBe(true);
    expect(isGoogleImageModel("nano-banana-2-lite")).toBe(true);
    expect(isGoogleImageModel("gemini-3.1-flash-lite-image")).toBe(true);
    expect(isGoogleImageModel("nano-banana-pro")).toBe(true);
    expect(isGoogleImageModel("gemini-pro-image")).toBe(false);
  });
});
