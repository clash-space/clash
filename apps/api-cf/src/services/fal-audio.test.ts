import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribe } = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    subscribe,
  },
}));

import { generateFalAudio } from "./fal-audio";

describe("fal audio service model contracts", () => {
  beforeEach(() => {
    subscribe.mockReset();
    subscribe.mockResolvedValue({
      requestId: "music-request-1",
      data: {
        audio: {
          url: "https://fal.media/music.mp3",
          content_type: "audio/mpeg",
        },
      },
    });
  });

  it("projects MiniMax Music 3 parameters to fal without direct-only watermark fields", async () => {
    const result = await generateFalAudio("fal-key", {
      prompt: "cinematic synthwave with a rising chorus",
      modelEndpoint: "fal-ai/minimax-music/v3",
      modelParams: {
        lyrics: "[Verse]\nNeon over water",
        lyrics_optimizer: true,
        is_instrumental: false,
        sample_rate: 44100,
        bitrate: 256000,
        format: "mp3",
        aigc_watermark: true,
      },
    });

    expect(subscribe).toHaveBeenCalledWith("fal-ai/minimax-music/v3", expect.objectContaining({
      input: {
        prompt: "cinematic synthwave with a rising chorus",
        lyrics: "[Verse]\nNeon over water",
        lyrics_optimizer: true,
        is_instrumental: false,
        audio_setting: {
          sample_rate: 44100,
          bitrate: 256000,
          format: "mp3",
        },
      },
    }));
    expect(result).toEqual({
      url: "https://fal.media/music.mp3",
      contentType: "audio/mpeg",
      requestId: "music-request-1",
      model: "fal-ai/minimax-music/v3",
    });
  });
});
