import { beforeEach, describe, expect, it, vi } from "vitest";

const { subscribe } = vi.hoisted(() => ({ subscribe: vi.fn() }));

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: vi.fn(),
    subscribe,
  },
}));

import { generateImage } from "./fal-image";

describe("fal image service model contracts", () => {
  beforeEach(() => {
    subscribe.mockReset();
    subscribe.mockResolvedValue({
      requestId: "request-1",
      data: { images: [{ url: "https://fal.media/result.png" }] },
    });
  });

  it("uses the real fal GPT Image 2 generation and edit endpoints", async () => {
    await generateImage("fal-key", {
      text: "draw a launch poster",
      modelName: "gpt-image-2",
      aspectRatio: "1:1",
      modelParams: { quality: "high", output_format: "png" },
    });
    expect(subscribe).toHaveBeenLastCalledWith(
      "openai/gpt-image-2",
      expect.objectContaining({
        input: expect.objectContaining({
          prompt: "draw a launch poster",
          quality: "high",
          output_format: "png",
        }),
      }),
    );

    await generateImage("fal-key", {
      text: "replace the background",
      modelName: "gpt-image-2",
      referenceImageUrls: ["https://input.test/source.png"],
    });
    expect(subscribe).toHaveBeenLastCalledWith(
      "openai/gpt-image-2/edit",
      expect.objectContaining({
        input: expect.objectContaining({
          image_urls: ["https://input.test/source.png"],
        }),
      }),
    );
  });

  it("merges Seedream text-to-image and edit behind one model code", async () => {
    await generateImage("fal-key", {
      text: "a studio portrait",
      modelName: "seedream-4.5",
    });
    expect(subscribe).toHaveBeenLastCalledWith(
      "fal-ai/bytedance/seedream/v4.5/text-to-image",
      expect.any(Object),
    );

    await generateImage("fal-key", {
      text: "change the jacket",
      modelName: "seedream-4.5",
      referenceImageUrls: ["https://input.test/person.png"],
    });
    expect(subscribe).toHaveBeenLastCalledWith(
      "fal-ai/bytedance/seedream/v4.5/edit",
      expect.objectContaining({
        input: expect.objectContaining({
          image_urls: ["https://input.test/person.png"],
        }),
      }),
    );
  });

  it("does not silently execute another model for unknown model codes", async () => {
    await expect(generateImage("fal-key", {
      text: "must not become Nano Banana",
      modelName: "unknown-image-model",
    })).rejects.toThrow("Unsupported fal image model");
    expect(subscribe).not.toHaveBeenCalled();
  });
});
