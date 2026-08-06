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

  it("projects provider-specific Seedance reference parameters without dropping seed", async () => {
    await generateFalVideo("fal-key", {
      prompt: "Use @Image1 as the product reference",
      videoModel: "seedance-2-ref",
      modelEndpoint: "bytedance/seedance-2.0/reference-to-video",
      referenceImageUrls: ["https://media.example/product.png"],
      duration: 11,
      aspectRatio: "9:16",
      modelParams: { resolution: "720p", generate_audio: true, seed: 42 },
    });

    expect(subscribe).toHaveBeenCalledWith(
      "bytedance/seedance-2.0/reference-to-video",
      expect.objectContaining({
        input: expect.objectContaining({
          duration: 11,
          resolution: "720p",
          aspect_ratio: "9:16",
          generate_audio: true,
          seed: 42,
        }),
      }),
    );
  });

  it("projects MiniMax H3 all-purpose references into fal modality arrays", async () => {
    await generateFalVideo("fal-key", {
      prompt: "Image 1 enters the scene as Video 1 plays",
      videoModel: "minimax-h3",
      modelEndpoint: "minimax/h3/reference-to-video",
      referenceImageUrls: ["https://media.example/character.png"],
      referenceVideoUrls: ["https://media.example/motion.mp4"],
      referenceAudioUrls: ["https://media.example/voice.mp3"],
      duration: 9,
      aspectRatio: "adaptive",
      modelParams: { resolution: "2K" },
    });

    expect(subscribe).toHaveBeenCalledWith(
      "minimax/h3/reference-to-video",
      expect.objectContaining({
        input: {
          prompt: "Image 1 enters the scene as Video 1 plays",
          duration: 9,
          resolution: "2K",
          aspect_ratio: "adaptive",
          reference_image_urls: ["https://media.example/character.png"],
          reference_video_urls: ["https://media.example/motion.mp4"],
          reference_audio_urls: ["https://media.example/voice.mp3"],
        },
      }),
    );
  });

  it("uses the H3 text transport only when the all-purpose card has no references", async () => {
    await generateFalVideo("fal-key", {
      prompt: "a quiet paper city wakes up",
      videoModel: "minimax-h3",
      modelEndpoint: "minimax/h3/reference-to-video",
      duration: 6,
      aspectRatio: "16:9",
      modelParams: { resolution: "768P" },
    });

    expect(subscribe).toHaveBeenCalledWith(
      "minimax/h3/text-to-video",
      expect.objectContaining({
        input: {
          prompt: "a quiet paper city wakes up",
          duration: 6,
          resolution: "768P",
          aspect_ratio: "16:9",
        },
      }),
    );
  });

  it("rejects fal H3 Auto ratio when the all-purpose Card has no references", async () => {
    await expect(generateFalVideo("fal-key", {
      prompt: "a quiet paper city wakes up",
      videoModel: "minimax-h3",
      modelEndpoint: "minimax/h3/reference-to-video",
      duration: 6,
      aspectRatio: "adaptive",
      modelParams: { resolution: "768P" },
    })).rejects.toThrow(/auto.*reference/i);
    expect(subscribe).not.toHaveBeenCalled();
  });

  it("projects H3 start/end frames without sending an aspect ratio", async () => {
    await generateFalVideo("fal-key", {
      prompt: "move from dawn to night",
      videoModel: "minimax-h3-startend",
      modelEndpoint: "minimax/h3/image-to-video",
      startFrameUrl: "https://media.example/start.png",
      endFrameUrl: "https://media.example/end.png",
      duration: 7,
      aspectRatio: "9:16",
      modelParams: { resolution: "2K" },
    });

    expect(subscribe).toHaveBeenCalledWith(
      "minimax/h3/image-to-video",
      expect.objectContaining({
        input: {
          prompt: "move from dawn to night",
          duration: 7,
          resolution: "2K",
          image_url: "https://media.example/start.png",
          end_image_url: "https://media.example/end.png",
        },
      }),
    );
  });

  it("routes FLUX 3 text generation to the fal launch endpoint", async () => {
    await generateFalVideo("fal-key", {
      prompt: "a fox runs through morning mist",
      videoModel: "flux-3-video",
      modelEndpoint: "blackforestlabs/flux-3/text-to-video",
      duration: "auto",
      aspectRatio: "auto",
      modelParams: { resolution: "1080p", generate_audio: true, safety_tolerance: 2 },
    });

    expect(subscribe).toHaveBeenCalledWith(
      "blackforestlabs/flux-3/text-to-video",
      expect.objectContaining({
        input: {
          prompt: "a fox runs through morning mist",
          duration: "auto",
          aspect_ratio: "auto",
          resolution: "1080p",
          generate_audio: true,
          safety_tolerance: 2,
        },
      }),
    );
  });

  it("projects FLUX 3 ordered images to explicit fal keyframe positions", async () => {
    await generateFalVideo("fal-key", {
      prompt: "move through the three product beats",
      videoModel: "flux-3-video-keyframes",
      modelEndpoint: "blackforestlabs/flux-3/keyframes-to-video",
      referenceImageUrls: ["https://media.example/one.png", "https://media.example/two.png", "https://media.example/three.png"],
      duration: 10,
      aspectRatio: "16:9",
      modelParams: {
        resolution: "720p",
        generate_audio: true,
        safety_tolerance: 1,
        keyframe_frame_indices: "[0,72,240]",
      },
    });

    expect(subscribe).toHaveBeenCalledWith(
      "blackforestlabs/flux-3/keyframes-to-video",
      expect.objectContaining({
        input: expect.objectContaining({
          keyframes: [
            { image_url: "https://media.example/one.png", frame_index: 0 },
            { image_url: "https://media.example/two.png", frame_index: 72 },
            { image_url: "https://media.example/three.png", frame_index: 240 },
          ],
        }),
      }),
    );
  });

  it("routes FLUX 3 video continuation to the fal extend endpoint", async () => {
    await generateFalVideo("fal-key", {
      prompt: "keep tracking as the subject turns",
      videoModel: "flux-3-video-continue",
      modelEndpoint: "blackforestlabs/flux-3/extend-video",
      referenceVideoUrls: ["https://media.example/source.mp4"],
      duration: 8,
      modelParams: { resolution: "720p", generate_audio: true, safety_tolerance: 2 },
    });

    expect(subscribe).toHaveBeenCalledWith(
      "blackforestlabs/flux-3/extend-video",
      expect.objectContaining({
        input: expect.objectContaining({
          video_url: "https://media.example/source.mp4",
        }),
      }),
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
