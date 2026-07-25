import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribe } = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    subscribe,
  },
}));

import { generateFalVideo } from "./fal-video";

describe("fal video service model contracts", () => {
  beforeEach(() => {
    subscribe.mockReset();
    subscribe.mockResolvedValue({
      requestId: "video-request-1",
      data: { video: { url: "https://fal.media/result.mp4", duration: 5 } },
    });
  });

  it("executes the selected Seedance 2 route", async () => {
    await generateFalVideo("fal-key", {
      prompt: "a cinematic product reveal",
      videoModel: "seedance-2-text",
      modelEndpoint: "bytedance/seedance-2.0/text-to-video",
    });
    expect(subscribe).toHaveBeenCalledWith(
      "bytedance/seedance-2.0/text-to-video",
      expect.any(Object),
    );
  });

  it("does not turn an unknown video model into Sora", async () => {
    await expect(generateFalVideo("fal-key", {
      prompt: "must not become Sora",
      videoModel: "unknown-video-model",
      modelEndpoint: "fal-ai/unknown-video-model",
    })).rejects.toThrow("Unsupported fal video model");
    expect(subscribe).not.toHaveBeenCalled();
  });
});
