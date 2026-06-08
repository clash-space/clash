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
  it("routes Seedance model codes to the fal video provider", () => {
    expect(resolveProvider(params("video_gen", "seedance-2-ref")).name).toBe("fal-video");
  });

  it("routes Google image model codes to the Google image provider", () => {
    expect(resolveProvider(params("image_gen", "gemini-flash-image-2")).name).toBe("google-image");
  });

  it("routes GPT Image 2 model codes to the OpenAI image provider", () => {
    expect(resolveProvider(params("image_gen", "gpt-image-2")).name).toBe("openai-image");
  });

  it("does not route mock-only providers in hosted registry", () => {
    expect(() => resolveProvider(params("audio_gen", "minimax-tts"))).toThrow(
      "Unsupported audio model: minimax-tts",
    );
  });
});
