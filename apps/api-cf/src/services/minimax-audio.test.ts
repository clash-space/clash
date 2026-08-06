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

  it("calls Music 3 with lyrics controls and decodes the generated song", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: { audio: "494433", status: 2 },
        extra_info: { music_duration: 184000 },
        base_resp: { status_code: 0, status_msg: "success" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await generateMiniMaxAudio("mini-key", {
      prompt: "Dream pop, nocturnal, warm analog synths",
      modelName: "music-3.0",
      modelParams: {
        lyrics: "[Verse]\nNeon rain on the window",
        lyrics_optimizer: false,
        is_instrumental: false,
        aigc_watermark: true,
        format: "mp3",
      },
      baseUrl: "https://api.minimax.io/",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.minimax.io/v1/music_generation",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer mini-key" }),
      }),
    );
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      model: "music-3.0",
      prompt: "Dream pop, nocturnal, warm analog synths",
      lyrics: "[Verse]\nNeon rain on the window",
      stream: false,
      output_format: "hex",
      lyrics_optimizer: false,
      is_instrumental: false,
      aigc_watermark: true,
      audio_setting: {
        sample_rate: 44100,
        bitrate: 256000,
        format: "mp3",
      },
    });
    expect(result).toMatchObject({
      data: new Uint8Array([73, 68, 51]),
      mediaType: "audio/mpeg",
      model: "music-3.0",
    });
  });

  it("allows lyrics-only vocal music and keeps the official optimizer default off", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      data: { audio: "494433", status: 2 },
      base_resp: { status_code: 0, status_msg: "success" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateMiniMaxAudio("mini-key", {
      prompt: "",
      modelName: "music-3.0",
      modelParams: { lyrics: "[Verse]\nOnly the words remain" },
    });

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      prompt: "",
      lyrics: "[Verse]\nOnly the words remain",
      lyrics_optimizer: false,
      is_instrumental: false,
      aigc_watermark: false,
    });
  });

  it("allows the official empty-lyrics optimizer shape without inventing a prompt requirement", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      data: { audio: "494433", status: 2 },
      base_resp: { status_code: 0, status_msg: "success" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await generateMiniMaxAudio("mini-key", {
      prompt: "",
      modelName: "music-3.0",
      modelParams: { lyrics: "", lyrics_optimizer: true, is_instrumental: false },
    });

    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      prompt: "",
      lyrics: "",
      lyrics_optimizer: true,
      is_instrumental: false,
    });
  });
});
