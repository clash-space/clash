import { afterEach, describe, expect, it, vi } from "vitest";

import { generateMiniMaxAudio } from "./minimax-audio";

describe("MiniMax audio service", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the official T2A endpoint and decodes hex audio", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { audio: "000102ff", status: 2 },
          extra_info: { audio_format: "mp3" },
          base_resp: { status_code: 0, status_msg: "success" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateMiniMaxAudio("mini-key", {
      prompt: "你好，Clash",
      modelName: "minimax-tts",
      modelParams: { voice_id: "female-warm", speed: 1.2, pitch: 1 },
      baseUrl: "https://api.minimax.io",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.minimax.io/v1/t2a_v2",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer mini-key",
          "Content-Type": "application/json",
        }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({
      model: "speech-02-hd",
      text: "你好，Clash",
      voice_setting: {
        voice_id: "female-warm",
        speed: 1.2,
        pitch: 1,
      },
      audio_setting: {
        format: "mp3",
      },
    });
    expect(result.data).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(result.mediaType).toBe("audio/mpeg");
    expect(result.model).toBe("speech-02-hd");
  });
});
