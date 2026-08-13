import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
  buildFalDirectorModelInput,
  falPoll,
  falSubmit,
} from "./fal-executor.js";
import { falAdapter } from "./fal-adapter.js";

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

describe("fal executor", () => {
  it("translates Director quality into the upstream Hunyuan3D request", () => {
    expect(
      buildFalDirectorModelInput({
        prompt: "A chestnut horse",
        quality: "low-poly",
        pbr: true,
        faceCount: 123_456,
      }),
    ).toEqual({
      prompt: "A chestnut horse",
      enable_pbr: true,
      face_count: 123_456,
      generate_type: "LowPoly",
      polygon_type: "quadrilateral",
    });
  });

  it("submits once and returns the opaque request id without polling", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: Record<string, unknown>) =>
        jsonResponse({ request_id: "request-9" }),
    );
    const result = await falSubmit({
      apiKey: "fal-key",
      endpoint: HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
      input: { prompt: "A chestnut horse", quality: "normal", pbr: true },
      fetch,
      queueBaseUrl: "https://queue.fal.test",
    });

    expect(result).toEqual({
      status: "accepted",
      pollState: { requestId: "request-9" },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(
      `https://queue.fal.test/${HUNYUAN3D_TEXT_TO_3D_ENDPOINT}`,
    );
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("checks a queued request once and leaves scheduling to the Host", async () => {
    const fetch = vi.fn(
      async (_url: string, _init?: Record<string, unknown>) =>
        jsonResponse({ status: "IN_PROGRESS" }),
    );
    const result = await falPoll({
      apiKey: "fal-key",
      endpoint: HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
      state: { requestId: "request-9" },
      fetch,
      queueBaseUrl: "https://queue.fal.test",
    });

    expect(result).toEqual({
      status: "accepted",
      pollState: { requestId: "request-9" },
      retryAfterMs: 1_000,
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("checkpoints a completed status before fetching the GLB result", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ status: "COMPLETED" }))
      .mockResolvedValueOnce(
        jsonResponse({
          model_glb: {
            url: "https://fal.media/horse.glb",
            content_type: "model/gltf-binary",
          },
          thumbnail: { url: "https://fal.media/horse.png" },
        }),
      );
    const status = await falPoll({
      apiKey: "fal-key",
      endpoint: HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
      state: { requestId: "request-9" },
      fetch,
      queueBaseUrl: "https://queue.fal.test",
    });
    expect(status).toEqual({
      status: "accepted",
      pollState: { requestId: "request-9", phase: "result" },
      retryAfterMs: 0,
    });
    expect(fetch).toHaveBeenCalledOnce();

    const result = await falPoll({
      apiKey: "fal-key",
      endpoint: HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
      state: { requestId: "request-9", phase: "result" },
      fetch,
      queueBaseUrl: "https://queue.fal.test",
    });

    expect(result).toEqual({
      status: "completed",
      media: {
        url: "https://fal.media/horse.glb",
        contentType: "model/gltf-binary",
      },
      thumbnailUrl: "https://fal.media/horse.png",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0]?.[0]).toMatch(/\/status$/);
    expect(fetch.mock.calls[1]?.[0]).not.toMatch(/\/status$/);
  });

  it("preserves the checkpointed result phase through the SDK adapter", async () => {
    const fetch = vi.fn(async (_url: string) =>
      jsonResponse({
        model_glb: {
          url: "https://fal.media/recovered.glb",
          content_type: "model/gltf-binary",
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await falAdapter.poll!(
      {
        protocol: "clash.plugin.invoke/v1",
        invocationId: "fal-result-phase",
        taskId: "director:run-1:media",
        projectId: "project-1",
        operation: "poll",
        target: {
          pluginId: "clash.fal",
          version: "0.1.0",
          exportId: "fal-execute",
          schemaHash: `sha256:${"f".repeat(64)}`,
          kind: "provider-executor",
        },
        input: {
          values: {
            kind: "model",
            upstreamModel: HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
          },
          references: [],
        },
        pollState: { requestId: "request-9", phase: "result" },
        actor: { kind: "system", id: "local-aigc" },
      } as never,
      {
        store: {
          get: async (key: string) =>
            key === "apiKey"
              ? "fal-key"
              : key === "queueBaseUrl"
                ? "https://queue.fal.test"
                : undefined,
          put: async () => undefined,
          remove: async () => undefined,
        },
      } as never,
    );

    expect(result).toEqual({
      status: "completed",
      media: {
        media: {
          url: "https://fal.media/recovered.glb",
          mediaType: "model/gltf-binary",
          kind: "model",
        },
      },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).not.toMatch(/\/status$/);
  });

  it("preserves the accepted-state boundary on poll failures", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ detail: "upstream unavailable" }, 503),
    );
    await expect(
      falPoll({
        apiKey: "fal-key",
        endpoint: HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
        state: { requestId: "request-9" },
        fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "provider_unavailable",
        retryable: true,
        requestState: "accepted",
      },
    });
  });
});
