import { describe, expect, it, vi } from "vitest";

import { ProviderExecutionError } from "@clash/action-sdk";

import { tripoAdapter } from "./tripo-adapter.js";
import { TRIPO_API_BASE_URL } from "./tripo-client.js";

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

function context(options: {
  apiKey?: string;
  region?: string;
  reference?: (reference: unknown) => Promise<unknown>;
  fetch: ReturnType<typeof vi.fn>;
}) {
  const originalFetch = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = options.fetch as never;
  const stored: Record<string, string | undefined> = {
    apiKey: options.apiKey,
    region: options.region,
  };
  return {
    upload: vi.fn(),
    asset: vi.fn(),
    document: vi.fn(),
    store: {
      get: vi.fn(async (key: string) => stored[key]),
      put: vi.fn(),
      remove: vi.fn(),
    },
    reference:
      options.reference ??
      (async () => {
        throw new Error("no reference resolver configured for this test");
      }),
    hostTools: {} as never,
    restoreFetch: () => {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    },
  };
}

const imageReference = {
  slot: "image",
  index: 0,
  asset: {
    assetId: "asset-1",
    uri: "clash-asset://asset-1",
    kind: "image" as const,
    mediaType: "image/png",
  },
};

const modelReference = {
  slot: "model",
  index: 0,
  asset: {
    assetId: "asset-2",
    uri: "clash-asset://asset-2",
    kind: "model" as const,
    mediaType: "model/gltf-binary",
  },
};

describe("tripoAdapter.submit — tripo-h3.1", () => {
  it("fails before any request when the account has no apiKey stored", async () => {
    const fetch = vi.fn();
    const ctx = context({ apiKey: "", fetch });
    await expect(
      tripoAdapter.submit(
        {
          taskId: "t1",
          operation: "submit",
          input: {
            values: {
              modelId: "tripo-h3.1",
              upstreamModel: "v3.1-20260211",
              prompt: "A cat wearing a spacesuit",
            },
            references: [],
          },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({
      failure: {
        code: "authentication_failed",
        retryable: false,
        requestState: "rejected",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });

  it("calls text-to-model with the prompt when no image reference is present", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_abc123" } }),
    );
    const ctx = context({ apiKey: "sk-test", fetch });
    const result = await tripoAdapter.submit(
      {
        taskId: "t1",
        operation: "submit",
        input: {
          values: {
            modelId: "tripo-h3.1",
            upstreamModel: "v3.1-20260211",
            prompt: "A cat wearing a spacesuit",
            modelParams: { pbr: true, textureQuality: "detailed" },
          },
          references: [],
        },
      } as never,
      ctx as never,
    );
    expect(fetch).toHaveBeenCalledWith(
      `${TRIPO_API_BASE_URL}/generation/text-to-model`,
      expect.objectContaining({
        body: JSON.stringify({
          prompt: "A cat wearing a spacesuit",
          model: "v3.1-20260211",
          pbr: true,
          texture_quality: "detailed",
        }),
      }),
    );
    expect(result).toEqual({
      status: "accepted",
      pollState: { taskId: "task_abc123" },
    });
    ctx.restoreFetch();
  });

  it("calls image-to-model with the resolved provider-url and never a prompt when an image reference is present", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_img1" } }),
    );
    const reference = vi.fn(async () => ({
      form: "provider-url" as const,
      providerUrl: "https://objects.example.test/reference.png?sig=1",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "image" as const,
    }));
    const ctx = context({ apiKey: "sk-test", fetch, reference });
    const result = await tripoAdapter.submit(
      {
        taskId: "t1",
        operation: "submit",
        input: {
          values: {
            modelId: "tripo-h3.1",
            upstreamModel: "v3.1-20260211",
            prompt: "ignored because an image reference is present",
          },
          references: [imageReference],
        },
      } as never,
      ctx as never,
    );
    expect(reference).toHaveBeenCalledWith(imageReference);
    expect(fetch).toHaveBeenCalledWith(
      `${TRIPO_API_BASE_URL}/generation/image-to-model`,
      expect.objectContaining({
        body: JSON.stringify({
          input: "https://objects.example.test/reference.png?sig=1",
          model: "v3.1-20260211",
        }),
      }),
    );
    expect(result).toEqual({
      status: "accepted",
      pollState: { taskId: "task_img1" },
    });
    ctx.restoreFetch();
  });

  it("uploads bytes through Tripo's own Files API and sends the resulting file_token, never a clash-asset URI", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetch = vi.fn(async (url: string, init?: { body?: unknown }) => {
      calls.push({ url, body: init?.body });
      if (url === `${TRIPO_API_BASE_URL}/files`) {
        return jsonResponse(200, { code: 0, data: { file_token: "file_abc123" } });
      }
      return jsonResponse(200, { code: 0, data: { task_id: "task_img2" } });
    });
    const reference = vi.fn(async () => ({
      form: "bytes" as const,
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      kind: "image" as const,
    }));
    const ctx = context({ apiKey: "sk-test", fetch, reference });
    await tripoAdapter.submit(
      {
        taskId: "t1",
        operation: "submit",
        input: {
          values: { modelId: "tripo-h3.1", upstreamModel: "v3.1-20260211" },
          references: [imageReference],
        },
      } as never,
      ctx as never,
    );
    expect(calls[0]!.url).toBe(`${TRIPO_API_BASE_URL}/files`);
    expect(calls[0]!.body).toBeInstanceOf(FormData);
    expect(calls[1]!.body).toBe(
      JSON.stringify({ input: "file_abc123", model: "v3.1-20260211" }),
    );
    for (const call of calls) {
      expect(JSON.stringify(call.body ?? "")).not.toContain("clash-asset://");
    }
    ctx.restoreFetch();
  });

  it("rejects when the image reference resolves to text instead of media", async () => {
    const fetch = vi.fn();
    const reference = vi.fn(async () => ({ form: "text" as const, text: "hello" }));
    const ctx = context({ apiKey: "sk-test", fetch, reference });
    await expect(
      tripoAdapter.submit(
        {
          taskId: "t1",
          operation: "submit",
          input: {
            values: { modelId: "tripo-h3.1", upstreamModel: "v3.1-20260211" },
            references: [imageReference],
          },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({ failure: { code: "invalid_request" } });
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });

  it("rejects when neither a prompt nor an image reference is supplied", async () => {
    const fetch = vi.fn();
    const ctx = context({ apiKey: "sk-test", fetch });
    await expect(
      tripoAdapter.submit(
        {
          taskId: "t1",
          operation: "submit",
          input: {
            values: { modelId: "tripo-h3.1", upstreamModel: "v3.1-20260211" },
            references: [],
          },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({ failure: { code: "invalid_request" } });
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });
});

describe("tripoAdapter.submit — tripo-auto-rig", () => {
  it("requires a model reference", async () => {
    const fetch = vi.fn();
    const ctx = context({ apiKey: "sk-test", fetch });
    await expect(
      tripoAdapter.submit(
        {
          taskId: "t1",
          operation: "submit",
          input: {
            values: { modelId: "tripo-auto-rig", upstreamModel: "v1.0-20240301" },
            references: [],
          },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({ failure: { code: "invalid_request" } });
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });

  it("always requests biped, mixamo, glb against the resolved model reference", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_rig1" } }),
    );
    const reference = vi.fn(async () => ({
      form: "provider-url" as const,
      providerUrl: "https://objects.example.test/model.glb?sig=1",
      expiresAt: "2026-01-01T00:00:00.000Z",
      kind: "model" as const,
    }));
    const ctx = context({ apiKey: "sk-test", fetch, reference });
    const result = await tripoAdapter.submit(
      {
        taskId: "t1",
        operation: "submit",
        input: {
          values: { modelId: "tripo-auto-rig", upstreamModel: "v1.0-20240301" },
          references: [modelReference],
        },
      } as never,
      ctx as never,
    );
    expect(fetch).toHaveBeenCalledWith(
      `${TRIPO_API_BASE_URL}/animations/rig`,
      expect.objectContaining({
        body: JSON.stringify({
          input: "https://objects.example.test/model.glb?sig=1",
          model: "v1.0-20240301",
          rig_type: "biped",
          spec: "mixamo",
          out_format: "glb",
        }),
      }),
    );
    expect(result).toEqual({
      status: "accepted",
      pollState: { taskId: "task_rig1" },
    });
    ctx.restoreFetch();
  });
});

describe("tripoAdapter.submit — unsupported model", () => {
  it("rejects a modelId this plugin does not bind", async () => {
    const fetch = vi.fn();
    const ctx = context({ apiKey: "sk-test", fetch });
    await expect(
      tripoAdapter.submit(
        {
          taskId: "t1",
          operation: "submit",
          input: {
            values: { modelId: "some-other-model", upstreamModel: "v1" },
            references: [],
          },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({ failure: { code: "invalid_request" } });
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });
});

describe("tripoAdapter.poll", () => {
  it("rejects an unusable poll state before reading account data", async () => {
    const fetch = vi.fn();
    const ctx = context({ apiKey: "sk-test", fetch });
    await expect(
      tripoAdapter.poll!(
        {
          taskId: "t1",
          operation: "poll",
          pollState: {},
          input: { values: {}, references: [] },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({
      failure: { code: "contract_violation", requestState: "accepted" },
    });
    expect(ctx.store.get).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });

  it("keeps a running task as an accepted poll", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "running" } }),
    );
    const ctx = context({ apiKey: "sk-test", fetch });
    await expect(
      tripoAdapter.poll!(
        {
          taskId: "t1",
          operation: "poll",
          pollState: { taskId: "task_abc123" },
          input: { values: {}, references: [] },
        } as never,
        ctx as never,
      ),
    ).resolves.toMatchObject({ status: "accepted" });
    ctx.restoreFetch();
  });

  it("completes with a model-kind media output pinned to model/gltf-binary", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 0,
        data: {
          status: "success",
          output: { model_url: "https://cdn.tripo3d.ai/output/model_pbr.glb" },
        },
      }),
    );
    const ctx = context({ apiKey: "sk-test", fetch });
    await expect(
      tripoAdapter.poll!(
        {
          taskId: "t1",
          operation: "poll",
          pollState: { taskId: "task_abc123" },
          input: { values: {}, references: [] },
        } as never,
        ctx as never,
      ),
    ).resolves.toEqual({
      status: "completed",
      media: {
        media: {
          url: "https://cdn.tripo3d.ai/output/model_pbr.glb",
          mediaType: "model/gltf-binary",
          kind: "model",
        },
      },
    });
    ctx.restoreFetch();
  });

  it("surfaces a failed task as a non-retryable Provider failure", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 0,
        data: { status: "failed", error_code: 2018, error_message: "Model too complex" },
      }),
    );
    const ctx = context({ apiKey: "sk-test", fetch });
    await expect(
      tripoAdapter.poll!(
        {
          taskId: "t1",
          operation: "poll",
          pollState: { taskId: "task_abc123" },
          input: { values: {}, references: [] },
        } as never,
        ctx as never,
      ),
    ).rejects.toBeInstanceOf(ProviderExecutionError);
    ctx.restoreFetch();
  });
});

describe("tripoAdapter region routing", () => {
  it("submits to the international host by default when no region is stored", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_default" } }),
    );
    const ctx = context({ apiKey: "sk-test", fetch });
    await tripoAdapter.submit(
      {
        taskId: "t1",
        operation: "submit",
        input: {
          values: {
            modelId: "tripo-h3.1",
            upstreamModel: "v3.1-20260211",
            prompt: "A cat",
          },
          references: [],
        },
      } as never,
      ctx as never,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://openapi.tripo3d.ai/v3/generation/text-to-model",
      expect.anything(),
    );
    ctx.restoreFetch();
  });

  it("submits to the China host for an account whose stored region is china", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { task_id: "task_cn" } }),
    );
    const ctx = context({ apiKey: "sk-test", region: "china", fetch });
    await tripoAdapter.submit(
      {
        taskId: "t1",
        operation: "submit",
        input: {
          values: {
            modelId: "tripo-h3.1",
            upstreamModel: "v3.1-20260211",
            prompt: "A cat",
          },
          references: [],
        },
      } as never,
      ctx as never,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://openapi.tripo3d.com/v3/generation/text-to-model",
      expect.anything(),
    );
    // No automatic cross-region fallback or trial: the international host must never be touched.
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining("openapi.tripo3d.ai"),
      expect.anything(),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    ctx.restoreFetch();
  });

  it("uploads bytes and submits to the same China host, never mixing hosts within one submit", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.endsWith("/files")) {
        return jsonResponse(200, { code: 0, data: { file_token: "file_cn1" } });
      }
      return jsonResponse(200, { code: 0, data: { task_id: "task_cn_img" } });
    });
    const reference = vi.fn(async () => ({
      form: "bytes" as const,
      bytes: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      kind: "image" as const,
    }));
    const ctx = context({ apiKey: "sk-test", region: "china", fetch, reference });
    await tripoAdapter.submit(
      {
        taskId: "t1",
        operation: "submit",
        input: {
          values: { modelId: "tripo-h3.1", upstreamModel: "v3.1-20260211" },
          references: [imageReference],
        },
      } as never,
      ctx as never,
    );
    expect(calls).toEqual([
      "https://openapi.tripo3d.com/v3/files",
      "https://openapi.tripo3d.com/v3/generation/image-to-model",
    ]);
    ctx.restoreFetch();
  });

  it("polls the China host for an account whose stored region is china", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { status: "running" } }),
    );
    const ctx = context({ apiKey: "sk-test", region: "china", fetch });
    await tripoAdapter.poll!(
      {
        taskId: "t1",
        operation: "poll",
        pollState: { taskId: "task_abc123" },
        input: { values: {}, references: [] },
      } as never,
      ctx as never,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://openapi.tripo3d.com/v3/tasks/task_abc123",
      expect.anything(),
    );
    ctx.restoreFetch();
  });

  it("rejects an illegal stored region as a structured, rejected submit failure without calling fetch", async () => {
    const fetch = vi.fn();
    const ctx = context({ apiKey: "sk-test", region: "eu", fetch });
    await expect(
      tripoAdapter.submit(
        {
          taskId: "t1",
          operation: "submit",
          input: {
            values: {
              modelId: "tripo-h3.1",
              upstreamModel: "v3.1-20260211",
              prompt: "A cat",
            },
            references: [],
          },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({
      failure: {
        code: "invalid_request",
        retryable: false,
        requestState: "rejected",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });

  it("rejects an illegal stored region as a structured, accepted poll failure without calling fetch", async () => {
    const fetch = vi.fn();
    const ctx = context({ apiKey: "sk-test", region: "eu", fetch });
    await expect(
      tripoAdapter.poll!(
        {
          taskId: "t1",
          operation: "poll",
          pollState: { taskId: "task_abc123" },
          input: { values: {}, references: [] },
        } as never,
        ctx as never,
      ),
    ).rejects.toMatchObject({
      failure: {
        code: "invalid_request",
        retryable: false,
        requestState: "accepted",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
    ctx.restoreFetch();
  });
});
