import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MESHY_BASE_URL,
  buildImageToThreeDBody,
  buildRiggingBody,
  buildTextToThreeDPreviewBody,
  buildTextToThreeDRefineBody,
  meshyPollImageToThreeD,
  meshyPollRigging,
  meshyPollTextToThreeD,
  meshySubmitImageToThreeD,
  meshySubmitRigging,
  meshySubmitTextToThreeD,
} from "./meshy-executor.js";
import { ProviderExecutionError } from "@clash/action-sdk";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(
  body: unknown,
  status = 200,
): {
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
} {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "error",
    text: async () => JSON.stringify(body),
  };
}

describe("Meshy request builders", () => {
  it("builds a text-to-3d preview request with the required fields and glb-only formats", () => {
    expect(
      buildTextToThreeDPreviewBody({
        aiModel: "meshy-7",
        prompt: "a monster mask",
        pbr: false,
      }),
    ).toEqual({
      mode: "preview",
      prompt: "a monster mask",
      ai_model: "meshy-7",
      target_formats: ["glb"],
      pose_mode: "",
    });
  });

  it("rejects an empty text-to-3d prompt before any request is sent", () => {
    expect(() =>
      buildTextToThreeDPreviewBody({ aiModel: "meshy-7", prompt: "   ", pbr: false }),
    ).toThrow(ProviderExecutionError);
  });

  it("enables remesh only when a target polycount is requested", () => {
    expect(
      buildTextToThreeDPreviewBody({
        aiModel: "meshy-7",
        prompt: "a chestnut horse",
        pbr: false,
        targetPolycount: 50_000,
      }),
    ).toMatchObject({ target_polycount: 50_000, should_remesh: true });
  });

  it("rejects a target polycount outside Meshy's documented range", () => {
    expect(() =>
      buildTextToThreeDPreviewBody({
        aiModel: "meshy-7",
        prompt: "a chestnut horse",
        pbr: false,
        targetPolycount: 400_000,
      }),
    ).toThrow(ProviderExecutionError);
  });

  it("builds a text-to-3d refine request naming the preview task and texture options", () => {
    expect(
      buildTextToThreeDRefineBody("preview-task-1", {
        aiModel: "meshy-7",
        pbr: true,
        textureResolution: "4k",
      }),
    ).toEqual({
      mode: "refine",
      preview_task_id: "preview-task-1",
      ai_model: "meshy-7",
      target_formats: ["glb"],
      enable_pbr: true,
    texture_resolution: "4k",
    });
  });

  it("always sends enable_pbr explicitly, even when false", () => {
    expect(
      buildTextToThreeDRefineBody("preview-task-1", {
        aiModel: "meshy-7",
        pbr: false,
      }),
    ).toMatchObject({ enable_pbr: false });
  });

  it("rejects a texture resolution outside Meshy's documented menu", () => {
    expect(() =>
      buildTextToThreeDRefineBody("preview-task-1", {
        aiModel: "meshy-7",
        pbr: false,
        textureResolution: "16k" as never,
      }),
    ).toThrow(ProviderExecutionError);
  });

  it("builds an image-to-3d request from a resolved image URL", () => {
    expect(
      buildImageToThreeDBody({
        aiModel: "meshy-6",
        imageUrl: "https://example.com/ref.png",
        prompt: "a wooden chair",
        pbr: true,
        textureResolution: "2k",
        poseMode: "a-pose",
      }),
    ).toEqual({
      image_url: "https://example.com/ref.png",
      ai_model: "meshy-6",
      target_formats: ["glb"],
      enable_pbr: true,
      pose_mode: "a-pose",
      texture_resolution: "2k",
      texture_prompt: "a wooden chair",
    });
  });

  it("omits texture_prompt for image-to-3d when no prompt text was given", () => {
    expect(
      buildImageToThreeDBody({
        aiModel: "meshy-6",
        imageUrl: "data:image/png;base64,AAAA",
        prompt: "",
        pbr: false,
      }),
    ).not.toHaveProperty("texture_prompt");
  });

  it("rejects an image-to-3d request with no image URL", () => {
    expect(() =>
      buildImageToThreeDBody({ aiModel: "meshy-6", imageUrl: "", prompt: "", pbr: false }),
    ).toThrow(ProviderExecutionError);
  });

  it("builds a rigging request with the model URL and an optional height", () => {
    expect(
      buildRiggingBody({ modelUrl: "https://example.com/char.glb", heightMeters: 1.8 }),
    ).toEqual({ model_url: "https://example.com/char.glb", height_meters: 1.8 });
  });

  it("omits height_meters for rigging when not provided", () => {
    expect(buildRiggingBody({ modelUrl: "https://example.com/char.glb" })).toEqual({
      model_url: "https://example.com/char.glb",
    });
  });

  it("rejects a non-positive rigging height", () => {
    expect(() =>
      buildRiggingBody({ modelUrl: "https://example.com/char.glb", heightMeters: 0 }),
    ).toThrow(ProviderExecutionError);
  });

  it("rejects a rigging request with no model URL", () => {
    expect(() => buildRiggingBody({ modelUrl: "" })).toThrow(ProviderExecutionError);
  });
});

describe("Meshy text-to-3d submit/poll", () => {
  it("submits a preview and returns durable poll state carrying the refine inputs", async () => {
    const fetch = vi.fn(async () => jsonResponse({ result: "preview-task-1" }));
    const step = await meshySubmitTextToThreeD({
      apiKey: "msy_test",
      fetch,
      input: { aiModel: "meshy-7", prompt: "a monster mask", pbr: true },
    });
    expect(step).toEqual({
      status: "accepted",
      pollState: {
        kind: "text-to-3d",
        phase: "preview",
        taskId: "preview-task-1",
        aiModel: "meshy-7",
        pbr: true,
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      `${MESHY_BASE_URL}/v2/text-to-3d`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer msy_test" }),
      }),
    );
  });

  it("classifies a rejected preview submit as an HTTP failure with a rejected boundary", async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: "prompt too long" }, 400));
    await expect(
      meshySubmitTextToThreeD({
        apiKey: "msy_test",
        fetch,
        input: { aiModel: "meshy-7", prompt: "a monster mask", pbr: false },
      }),
    ).rejects.toMatchObject({
      failure: { code: "invalid_request", retryable: false, requestState: "rejected" },
    });
  });

  it("keeps polling while the preview task is still in progress", async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: "IN_PROGRESS", progress: 40 }));
    const step = await meshyPollTextToThreeD({
      apiKey: "msy_test",
      fetch,
      state: { kind: "text-to-3d", phase: "preview", taskId: "preview-task-1", aiModel: "meshy-7", pbr: false },
    });
    expect(step).toMatchObject({
      status: "accepted",
      pollState: { phase: "preview", taskId: "preview-task-1" },
    });
    expect(fetch).toHaveBeenCalledWith(
      `${MESHY_BASE_URL}/v2/text-to-3d/preview-task-1`,
      expect.anything(),
    );
  });

  it("submits refine once the preview succeeds, without returning completion yet", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "SUCCEEDED" }))
      .mockResolvedValueOnce(jsonResponse({ result: "refine-task-1" }));
    const step = await meshyPollTextToThreeD({
      apiKey: "msy_test",
      fetch,
      state: {
        kind: "text-to-3d",
        phase: "preview",
        taskId: "preview-task-1",
        aiModel: "meshy-7",
        pbr: true,
        textureResolution: "4k",
      },
    });
    expect(step).toEqual({
      status: "accepted",
      pollState: { kind: "text-to-3d", phase: "refine", taskId: "refine-task-1" },
      retryAfterMs: 0,
    });
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `${MESHY_BASE_URL}/v2/text-to-3d`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          mode: "refine",
          preview_task_id: "preview-task-1",
          ai_model: "meshy-7",
          target_formats: ["glb"],
          enable_pbr: true,
          texture_resolution: "4k",
        }),
      }),
    );
  });

  it("fails the preview when Meshy reports the task failed", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ status: "FAILED", task_error: { type: "invalid_input", code: "image_too_complex", message: "too complex" } }),
    );
    await expect(
      meshyPollTextToThreeD({
        apiKey: "msy_test",
        fetch,
        state: { kind: "text-to-3d", phase: "preview", taskId: "t1", aiModel: "meshy-7", pbr: false },
      }),
    ).rejects.toMatchObject({
      failure: { code: "provider_failed", retryable: false, requestState: "accepted", providerCode: "image_too_complex" },
    });
  });

  it("completes once the refine task succeeds, returning the GLB media", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        status: "SUCCEEDED",
        model_urls: { glb: "https://assets.meshy.ai/model.glb" },
      }),
    );
    const step = await meshyPollTextToThreeD({
      apiKey: "msy_test",
      fetch,
      state: { kind: "text-to-3d", phase: "refine", taskId: "refine-task-1" },
    });
    expect(step).toEqual({
      status: "completed",
      media: { url: "https://assets.meshy.ai/model.glb", mediaType: "model/gltf-binary" },
    });
  });

  it("fails the refine completion when Meshy returns no GLB URL", async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: "SUCCEEDED", model_urls: {} }));
    await expect(
      meshyPollTextToThreeD({
        apiKey: "msy_test",
        fetch,
        state: { kind: "text-to-3d", phase: "refine", taskId: "refine-task-1" },
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "accepted" } });
  });
});

describe("Meshy image-to-3d submit/poll", () => {
  it("submits an image-to-3d task directly, without a preview stage", async () => {
    const fetch = vi.fn(async () => jsonResponse({ result: "image-task-1" }));
    const step = await meshySubmitImageToThreeD({
      apiKey: "msy_test",
      fetch,
      input: { aiModel: "meshy-6", imageUrl: "https://example.com/a.png", prompt: "", pbr: false },
    });
    expect(step).toEqual({
      status: "accepted",
      pollState: { kind: "image-to-3d", taskId: "image-task-1" },
    });
    expect(fetch).toHaveBeenCalledWith(
      `${MESHY_BASE_URL}/v1/image-to-3d`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("completes once the image-to-3d task succeeds", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ status: "SUCCEEDED", model_urls: { glb: "https://assets.meshy.ai/img.glb" } }),
    );
    const step = await meshyPollImageToThreeD({
      apiKey: "msy_test",
      fetch,
      state: { kind: "image-to-3d", taskId: "image-task-1" },
    });
    expect(step).toEqual({
      status: "completed",
      media: { url: "https://assets.meshy.ai/img.glb", mediaType: "model/gltf-binary" },
    });
  });

  it("classifies a cancelled image-to-3d task distinctly from a failure", async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: "CANCELED" }));
    await expect(
      meshyPollImageToThreeD({ apiKey: "msy_test", fetch, state: { kind: "image-to-3d", taskId: "t1" } }),
    ).rejects.toMatchObject({ failure: { code: "cancelled", requestState: "accepted" } });
  });
});

describe("Meshy rigging submit/poll", () => {
  it("submits a rigging task from a model URL", async () => {
    const fetch = vi.fn(async () => jsonResponse({ result: "rig-task-1" }));
    const step = await meshySubmitRigging({
      apiKey: "msy_test",
      fetch,
      input: { modelUrl: "https://example.com/char.glb", heightMeters: 1.8 },
    });
    expect(step).toEqual({ status: "accepted", pollState: { kind: "rig", taskId: "rig-task-1" } });
    expect(fetch).toHaveBeenCalledWith(
      `${MESHY_BASE_URL}/v1/rigging`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("completes once rigging succeeds, reading the rigged GLB from the result object", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        status: "SUCCEEDED",
        result: { rigged_character_glb_url: "https://assets.meshy.ai/rigged.glb" },
      }),
    );
    const step = await meshyPollRigging({ apiKey: "msy_test", fetch, state: { kind: "rig", taskId: "rig-task-1" } });
    expect(step).toEqual({
      status: "completed",
      media: { url: "https://assets.meshy.ai/rigged.glb", mediaType: "model/gltf-binary" },
    });
  });

  it("fails rigging completion when the result carries no rigged GLB URL", async () => {
    const fetch = vi.fn(async () => jsonResponse({ status: "SUCCEEDED", result: {} }));
    await expect(
      meshyPollRigging({ apiKey: "msy_test", fetch, state: { kind: "rig", taskId: "rig-task-1" } }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response", requestState: "accepted" } });
  });

  it("classifies a 401 rigging poll as an authentication failure that stays accepted", async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: "bad key" }, 401));
    await expect(
      meshyPollRigging({ apiKey: "msy_bad", fetch, state: { kind: "rig", taskId: "rig-task-1" } }),
    ).rejects.toMatchObject({
      failure: { code: "authentication_failed", retryable: false, requestState: "accepted" },
    });
  });
});
