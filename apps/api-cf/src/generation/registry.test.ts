import { describe, expect, it } from "vitest";

import type { ModelUpstreamRoute } from "@clash/shared-types";

import type { GenerationParams } from "./params";
import { resolveProvider } from "./registry";

function params(
  type: GenerationParams["type"],
  modelName?: string,
  selectedRoute?: ModelUpstreamRoute,
): GenerationParams {
  return {
    taskId: "task-1",
    nodeId: "node-1",
    projectId: "project-1",
    type,
    actorType: "user",
    actorUserId: "user-1",
    modelName,
    selectedRoute,
  };
}

describe("generation provider registry", () => {
  it("routes Seedance model codes to the hosted Volcengine video provider", () => {
    expect(resolveProvider(params("video_gen", "seedance-2-ref", {
      modelCode: "seedance-2-ref",
      kind: "video",
      providerId: "volcengine",
      upstreamId: "volcengine",
      upstreamModel: "doubao-seedance-2-0-pro",
      apiShape: "modelark",
      priority: 9,
    })).name).toBe("volcengine-video");
  });

  it("routes Kling model codes to the hosted Kling video provider", () => {
    expect(resolveProvider(params("video_gen", "kling-3", {
      modelCode: "kling-3",
      kind: "video",
      providerId: "kling",
      upstreamId: "kling",
      upstreamModel: "kling-v3",
      apiShape: "kling",
      priority: 8,
    })).name).toBe("kling-video");
  });

  it("routes Google image model codes to the Google image provider", () => {
    expect(resolveProvider(params("image_gen", "nano-banana-2", {
      modelCode: "nano-banana-2",
      kind: "image",
      providerId: "official",
      upstreamId: "google-agent-platform",
      upstreamModel: "gemini-3.1-flash-image",
      apiShape: "google-agent-platform",
      priority: 10,
    })).name).toBe("google-image");
  });

  it("preserves the selected GPT Image 2 provider route", () => {
    const falRoute: ModelUpstreamRoute = {
      modelCode: "gpt-image-2",
      kind: "image",
      providerId: "fal",
      accountId: "fal-secondary",
      upstreamId: "fal",
      upstreamModel: "openai/gpt-image-2",
      apiShape: "fal",
      priority: 20,
    };
    const officialRoute: ModelUpstreamRoute = {
      modelCode: "gpt-image-2",
      kind: "image",
      providerId: "official",
      accountId: "openai-primary",
      upstreamId: "openai",
      upstreamModel: "gpt-image-2",
      apiShape: "openai-images",
      priority: 10,
    };

    expect(resolveProvider(params("image_gen", "gpt-image-2", falRoute)).name).toBe("fal-image");
    expect(resolveProvider(params("image_gen", "gpt-image-2", officialRoute)).name).toBe("openai-image");
  });

  it("does not choose a default image provider when no route was selected", () => {
    expect(() => resolveProvider(params("image_gen", "gpt-image-2"))).toThrow(
      "No configured provider route",
    );
  });

  it("routes MiniMax TTS to the hosted MiniMax audio provider", () => {
    expect(resolveProvider(params("audio_gen", "minimax-tts", {
      modelCode: "minimax-tts",
      kind: "audio",
      providerId: "minimax",
      upstreamId: "minimax",
      upstreamModel: "speech-02-hd",
      apiShape: "minimax",
      priority: 8,
    })).name).toBe("minimax-audio");
  });

  it("routes ElevenLabs TTS to the hosted ElevenLabs audio provider", () => {
    expect(resolveProvider(params("audio_gen", "elevenlabs-tts", {
      modelCode: "elevenlabs-tts",
      kind: "audio",
      providerId: "elevenlabs",
      upstreamId: "elevenlabs",
      upstreamModel: "eleven_multilingual_v2",
      apiShape: "elevenlabs",
      priority: 8,
    })).name).toBe("elevenlabs-tts");
  });

  it("routes the selected Suno account to the Suno adapter", () => {
    expect(resolveProvider(params("audio_gen", "suno-v5.5", {
      modelCode: "suno-v5.5",
      kind: "audio",
      providerId: "suno",
      accountId: "suno-primary",
      upstreamId: "suno",
      upstreamModel: "V5_5",
      apiShape: "suno",
      priority: 8,
    })).name).toBe("suno-audio");
  });
});
