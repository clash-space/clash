import { describe, expect, it, vi } from "vitest";

import { ProviderExecutionError } from "@clash/action-sdk";

import {
  TRIPO_API_BASE_URL,
  buildTripoImageToModelBody,
  buildTripoRigBody,
  buildTripoTextToModelBody,
  tripoPollTask,
  tripoSubmitTask,
  tripoUploadFile,
} from "./tripo-client.js";

function jsonResponse(status: number, body: unknown, statusText = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    async text() {
      return JSON.stringify(body);
    },
  };
}

describe("buildTripoTextToModelBody", () => {
  it("builds the minimal request Tripo documents for text-to-model", () => {
    expect(
      buildTripoTextToModelBody({
        prompt: "A cat wearing a spacesuit",
        model: "v3.1-20260211",
      }),
    ).toEqual({
      prompt: "A cat wearing a spacesuit",
      model: "v3.1-20260211",
    });
  });

  it("forwards only the five v1 quality parameters, translated to Tripo's field names", () => {
    expect(
      buildTripoTextToModelBody({
        prompt: "A futuristic sci-fi helmet",
        model: "v3.1-20260211",
        pbr: true,
        textureQuality: "detailed",
        geometryQuality: "detailed",
        faceLimit: 80_000,
        autoSize: true,
      }),
    ).toEqual({
      prompt: "A futuristic sci-fi helmet",
      model: "v3.1-20260211",
      pbr: true,
      texture_quality: "detailed",
      geometry_quality: "detailed",
      face_limit: 80_000,
      auto_size: true,
    });
  });

  it("rejects an empty prompt", () => {
    expect(() =>
      buildTripoTextToModelBody({ prompt: "   ", model: "v3.1-20260211" }),
    ).toThrow(ProviderExecutionError);
  });

  it("rejects a prompt over Tripo's documented 1024 UTF-8 byte limit", () => {
    expect(() =>
      buildTripoTextToModelBody({
        prompt: "a".repeat(1025),
        model: "v3.1-20260211",
      }),
    ).toThrow(/1024/);
  });

  it("rejects a textureQuality outside standard, detailed, extreme", () => {
    expect(() =>
      buildTripoTextToModelBody({
        prompt: "A cat",
        model: "v3.1-20260211",
        textureQuality: "ultra",
      }),
    ).toThrow(/textureQuality/);
  });

  it("rejects a geometryQuality outside standard, detailed", () => {
    expect(() =>
      buildTripoTextToModelBody({
        prompt: "A cat",
        model: "v3.1-20260211",
        geometryQuality: "extreme",
      }),
    ).toThrow(/geometryQuality/);
  });

  it("rejects a faceLimit above Tripo's documented v3.1 standard-mode triangle ceiling", () => {
    expect(() =>
      buildTripoTextToModelBody({
        prompt: "A cat",
        model: "v3.1-20260211",
        faceLimit: 1_500_001,
      }),
    ).toThrow(/faceLimit/);
  });

  it("rejects a non-integer faceLimit", () => {
    expect(() =>
      buildTripoTextToModelBody({
        prompt: "A cat",
        model: "v3.1-20260211",
        faceLimit: 12.5,
      }),
    ).toThrow(/faceLimit/);
  });

  it("rejects a non-boolean pbr", () => {
    expect(() =>
      buildTripoTextToModelBody({
        prompt: "A cat",
        model: "v3.1-20260211",
        pbr: "true",
      }),
    ).toThrow(/pbr/);
  });

  it("rejects a non-boolean autoSize", () => {
    expect(() =>
      buildTripoTextToModelBody({
        prompt: "A cat",
        model: "v3.1-20260211",
        autoSize: "yes",
      }),
    ).toThrow(/autoSize/);
  });
});

describe("buildTripoImageToModelBody", () => {
  it("sends the resolved image reference as Tripo's input field and never a prompt", () => {
    expect(
      buildTripoImageToModelBody({
        inputImage: "https://cdn.example.test/reference.png",
        model: "v3.1-20260211",
        pbr: false,
      }),
    ).toEqual({
      input: "https://cdn.example.test/reference.png",
      model: "v3.1-20260211",
      pbr: false,
    });
  });

  it("rejects an empty resolved image input", () => {
    expect(() =>
      buildTripoImageToModelBody({ inputImage: "  ", model: "v3.1-20260211" }),
    ).toThrow(ProviderExecutionError);
  });
});

describe("buildTripoRigBody", () => {
  it("always requests biped, mixamo, glb regardless of caller input", () => {
    expect(
      buildTripoRigBody({
        inputModel: "https://cdn.example.test/model.glb",
        model: "v1.0-20240301",
      }),
    ).toEqual({
      input: "https://cdn.example.test/model.glb",
      model: "v1.0-20240301",
      rig_type: "biped",
      spec: "mixamo",
      out_format: "glb",
    });
  });

  it("rejects an empty resolved model input", () => {
    expect(() =>
      buildTripoRigBody({ inputModel: "", model: "v1.0-20240301" }),
    ).toThrow(ProviderExecutionError);
  });
});

describe("tripoSubmitTask", () => {
  it("fails before any request when the account has no apiKey stored", async () => {
    const fetch = vi.fn();
    await expect(
      tripoSubmitTask({
        apiKey: "",
        path: "/generation/text-to-model",
        body: { prompt: "hi", model: "v3.1-20260211" },
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "authentication_failed",
        retryable: false,
        requestState: "rejected",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sends a Bearer authorization header to the exact documented base URL", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_abc123" } }),
    );
    await tripoSubmitTask({
      apiKey: "sk-test",
      path: "/generation/text-to-model",
      body: { prompt: "hi", model: "v3.1-20260211" },
      fetch,
    });
    expect(fetch).toHaveBeenCalledWith(
      `${TRIPO_API_BASE_URL}/generation/text-to-model`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer sk-test",
        }),
        body: JSON.stringify({ prompt: "hi", model: "v3.1-20260211" }),
      }),
    );
  });

  it("defaults to the international base URL when no baseUrl is supplied", () => {
    expect(TRIPO_API_BASE_URL).toBe("https://openapi.tripo3d.ai/v3");
  });

  it("sends the request to an explicitly supplied China baseUrl instead of the default", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_cn1" } }),
    );
    await tripoSubmitTask({
      apiKey: "sk-test",
      baseUrl: "https://openapi.tripo3d.com/v3",
      path: "/generation/text-to-model",
      body: { prompt: "hi", model: "v3.1-20260211" },
      fetch,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://openapi.tripo3d.com/v3/generation/text-to-model",
      expect.anything(),
    );
    // Never also calls the international host: no automatic cross-region fallback.
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("openapi.tripo3d.ai"),
      expect.anything(),
    );
  });

  it("returns the accepted taskId from a successful envelope", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_abc123" } }),
    );
    await expect(
      tripoSubmitTask({
        apiKey: "sk-test",
        path: "/generation/text-to-model",
        body: { prompt: "hi", model: "v3.1-20260211" },
        fetch,
      }),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "task_abc123" },
    });
  });

  it("converts a non-2xx HTTP response into a rejected Provider failure", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(401, { code: 1000, message: "Invalid API Key" }, "Unauthorized"),
    );
    await expect(
      tripoSubmitTask({
        apiKey: "sk-test",
        path: "/generation/text-to-model",
        body: { prompt: "hi", model: "v3.1-20260211" },
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "authentication_failed",
        retryable: false,
        requestState: "rejected",
      },
    });
  });

  it("treats a non-zero envelope code on an HTTP 200 response as a rejected submit", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 2010,
        message: "Insufficient credits",
        suggestion: "Please top up your account",
      }),
    );
    await expect(
      tripoSubmitTask({
        apiKey: "sk-test",
        path: "/generation/text-to-model",
        body: { prompt: "hi", model: "v3.1-20260211" },
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "quota_exhausted",
        message: "Insufficient credits",
        retryable: false,
        requestState: "rejected",
        providerCode: "2010",
      },
    });
  });

  it("maps rate-limit envelope code 2000 to a retryable failure", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 2000, message: "Too many requests" }),
    );
    await expect(
      tripoSubmitTask({
        apiKey: "sk-test",
        path: "/generation/text-to-model",
        body: { prompt: "hi", model: "v3.1-20260211" },
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: { code: "rate_limited", retryable: true },
    });
  });

  it("maps content-policy envelope code 2008 to content_rejected", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 2008, message: "Content policy violation" }),
    );
    await expect(
      tripoSubmitTask({
        apiKey: "sk-test",
        path: "/generation/text-to-model",
        body: { prompt: "hi", model: "v3.1-20260211" },
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: { code: "content_rejected", retryable: false },
    });
  });

  it("fails with invalid_response when the envelope has no task_id", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { code: 0, data: {} }));
    await expect(
      tripoSubmitTask({
        apiKey: "sk-test",
        path: "/generation/text-to-model",
        body: { prompt: "hi", model: "v3.1-20260211" },
        fetch,
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response" } });
  });
});

describe("tripoPollTask", () => {
  it("fails before any request when the account has no apiKey stored", async () => {
    const fetch = vi.fn();
    await expect(
      tripoPollTask({ apiKey: "", state: { taskId: "task_abc123" }, fetch }),
    ).rejects.toMatchObject({
      failure: { code: "authentication_failed", requestState: "accepted" },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("queries the exact task-query endpoint with a Bearer header", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 0,
        data: { task_id: "task_abc123", status: "running", progress: 40 },
      }),
    );
    await tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch });
    expect(fetch).toHaveBeenCalledWith(
      `${TRIPO_API_BASE_URL}/tasks/task_abc123`,
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer sk-test" }),
      }),
    );
  });

  it("polls an explicitly supplied China baseUrl instead of the default", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "running" } }),
    );
    await tripoPollTask({
      apiKey: "sk-test",
      baseUrl: "https://openapi.tripo3d.com/v3",
      state: { taskId: "task_abc123" },
      fetch,
    });
    expect(fetch).toHaveBeenCalledWith(
      "https://openapi.tripo3d.com/v3/tasks/task_abc123",
      expect.anything(),
    );
  });

  it("keeps queued as an accepted poll", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "queued" } }),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "task_abc123" },
      retryAfterMs: expect.any(Number),
    });
  });

  it("keeps running as an accepted poll", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "running" } }),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).resolves.toMatchObject({ status: "accepted" });
  });

  it("completes with the GLB output pinned to model/gltf-binary", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 0,
        data: {
          status: "success",
          output: { model_url: "https://cdn.tripo3d.ai/output/model_pbr.glb" },
        },
      }),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).resolves.toEqual({
      status: "completed",
      media: {
        url: "https://cdn.tripo3d.ai/output/model_pbr.glb",
        mediaType: "model/gltf-binary",
      },
    });
  });

  it("fails with invalid_response when success has no model_url", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "success", output: {} } }),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response" } });
  });

  it("fails a failed task with provider_failed and the upstream error detail", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 0,
        data: { status: "failed", error_code: 2018, error_message: "Model too complex" },
      }),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).rejects.toMatchObject({
      failure: {
        code: "provider_failed",
        message: "Model too complex",
        retryable: false,
        requestState: "accepted",
        providerCode: "2018",
      },
    });
  });

  it("fails a cancelled task with the cancelled failure code", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "cancelled" } }),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "cancelled", retryable: false } });
  });

  it("fails on an unrecognized task status instead of guessing its meaning", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "banned" } }),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response" } });
  });

  it("converts a non-2xx HTTP response into an accepted-request Provider failure", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(404, { code: 0, message: "Task not found" }, "Not Found"),
    );
    await expect(
      tripoPollTask({ apiKey: "sk-test", state: { taskId: "task_abc123" }, fetch }),
    ).rejects.toMatchObject({
      failure: { code: "task_not_found", requestState: "accepted" },
    });
  });
});

describe("tripoUploadFile", () => {
  it("fails before any request when the account has no apiKey stored", async () => {
    const fetch = vi.fn();
    await expect(
      tripoUploadFile({
        apiKey: "",
        bytes: new Uint8Array([1, 2, 3]),
        filename: "image.png",
        contentType: "image/png",
        fetch,
      }),
    ).rejects.toMatchObject({ failure: { code: "authentication_failed" } });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uploads multipart form data with a Bearer header and returns the file_token", async () => {
    const fetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
      expect(url).toBe(`${TRIPO_API_BASE_URL}/files`);
      expect(init?.body).toBeInstanceOf(FormData);
      return jsonResponse(200, { code: 0, data: { file_token: "file_abc123" } });
    });
    await expect(
      tripoUploadFile({
        apiKey: "sk-test",
        bytes: new Uint8Array([1, 2, 3]),
        filename: "image.png",
        contentType: "image/png",
        fetch,
      }),
    ).resolves.toBe("file_abc123");
  });

  it("uploads to an explicitly supplied China baseUrl instead of the default", async () => {
    const fetch = vi.fn(async (url: string) => {
      expect(url).toBe("https://openapi.tripo3d.com/v3/files");
      return jsonResponse(200, { code: 0, data: { file_token: "file_cn1" } });
    });
    await expect(
      tripoUploadFile({
        apiKey: "sk-test",
        baseUrl: "https://openapi.tripo3d.com/v3",
        bytes: new Uint8Array([1, 2, 3]),
        filename: "image.png",
        contentType: "image/png",
        fetch,
      }),
    ).resolves.toBe("file_cn1");
  });

  it("fails with invalid_response when the upload response has no file_token", async () => {
    const fetch = vi.fn(async () => jsonResponse(200, { code: 0, data: {} }));
    await expect(
      tripoUploadFile({
        apiKey: "sk-test",
        bytes: new Uint8Array([1, 2, 3]),
        filename: "image.png",
        contentType: "image/png",
        fetch,
      }),
    ).rejects.toMatchObject({ failure: { code: "invalid_response" } });
  });
});
