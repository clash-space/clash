import { describe, expect, it } from "vitest";

import type { GenerationParams } from "./params";
import { resolveProvider } from "./registry";

function params(type: GenerationParams["type"], modelName?: string): GenerationParams {
  return {
    taskId: "task-1",
    nodeId: "node-1",
    projectId: "project-1",
    type,
    actorType: "user",
    actorUserId: "user-1",
    modelName,
  };
}

describe("generation provider registry", () => {
  it("routes Seedance model codes to the hosted Volcengine video provider", () => {
    expect(resolveProvider(params("video_gen", "seedance-2-ref")).name).toBe("volcengine-video");
  });

  it("routes Kling model codes to the hosted Kling video provider", () => {
    expect(resolveProvider(params("video_gen", "kling-3")).name).toBe("kling-video");
  });

  it("routes Google image model codes to the Google image provider", () => {
    expect(resolveProvider(params("image_gen", "gemini-3.1-flash-image")).name).toBe("google-image");
  });

  it("routes GPT Image 2 model codes to the OpenAI image provider", () => {
    expect(resolveProvider(params("image_gen", "gpt-image-2")).name).toBe("openai-image");
  });

  it("routes MiniMax TTS to the hosted MiniMax audio provider", () => {
    expect(resolveProvider(params("audio_gen", "minimax-tts")).name).toBe("minimax-audio");
  });

  it("routes ElevenLabs TTS to the hosted ElevenLabs audio provider", () => {
    expect(resolveProvider(params("audio_gen", "elevenlabs-tts")).name).toBe("elevenlabs-tts");
  });
});
