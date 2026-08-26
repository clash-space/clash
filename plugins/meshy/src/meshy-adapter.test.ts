import { afterEach, describe, expect, it, vi } from "vitest";

import { meshyAdapter } from "./meshy-adapter.js";
import { MESHY_BASE_URL } from "./meshy-executor.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

type CapturedRequest = { url: string; method?: string; body: Record<string, unknown> };

function invocation(
  values: Record<string, unknown>,
  options: {
    operation?: "submit" | "poll";
    pollState?: unknown;
    references?: unknown[];
  } = {},
) {
  return {
    invocationId: "invocation-1",
    operation: options.operation ?? "submit",
    ...(options.pollState === undefined ? {} : { pollState: options.pollState }),
    input: {
      values: { ...values },
      references: options.references ?? [],
    },
  } as never;
}

function context(
  responseBody: unknown,
  captured: CapturedRequest[],
  stored: Record<string, string> = { apiKey: "msy_test" },
  reference?: (input: unknown) => Promise<unknown>,
) {
  vi.stubGlobal(
    "fetch",
    async (url: string, init: { method?: string; body?: string } = {}) => {
      captured.push({
        url,
        method: init.method,
        body: JSON.parse(init.body ?? "{}") as Record<string, unknown>,
      });
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify(responseBody),
      };
    },
  );
  return {
    store: {
      get: async (key: string) => stored[key],
      put: async () => undefined,
      remove: async () => undefined,
    },
    ...(reference ? { reference } : {}),
  } as never;
}

function throwingStore() {
  return {
    store: {
      get: async () => {
        throw new Error("credentials must not be read before the request shape is valid");
      },
      put: async () => undefined,
      remove: async () => undefined,
    },
  } as never;
}

describe("Meshy adapter: routing", () => {
  it("submits text-to-3d when the invocation carries no image reference", async () => {
    const requests: CapturedRequest[] = [];
    const step = await meshyAdapter.submit(
      invocation({ upstreamModel: "meshy-7", prompt: "a monster mask", modelParams: { PBR: false } }),
      context({ result: "preview-task-1" }, requests),
    );
    expect(requests[0]?.url).toBe(`${MESHY_BASE_URL}/v2/text-to-3d`);
    expect(requests[0]?.body).toMatchObject({ mode: "preview", prompt: "a monster mask" });
    expect(step).toEqual({
      status: "accepted",
      pollState: {
        kind: "text-to-3d",
        phase: "preview",
        taskId: "preview-task-1",
        aiModel: "meshy-7",
        pbr: false,
      },
    });
  });

  it("submits image-to-3d when exactly one image reference is attached, passing its resolved URL", async () => {
    const requests: CapturedRequest[] = [];
    const step = await meshyAdapter.submit(
      invocation(
        { upstreamModel: "meshy-6", prompt: "", modelParams: { PBR: true } },
        { references: [{ slot: "image", index: 0, asset: { assetId: "a1", uri: "clash-asset://a1", kind: "image" } }] },
      ),
      context({ result: "image-task-1" }, requests, { apiKey: "msy_test" }, async () => ({
        form: "provider-url",
        providerUrl: "https://example.com/ref.png",
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "image",
        mediaType: "image/png",
      })),
    );
    expect(requests[0]?.url).toBe(`${MESHY_BASE_URL}/v1/image-to-3d`);
    expect(requests[0]?.body).toMatchObject({ image_url: "https://example.com/ref.png", enable_pbr: true });
    expect(step).toEqual({ status: "accepted", pollState: { kind: "image-to-3d", taskId: "image-task-1" } });
  });

  it("turns a bytes-form image reference into a data URI, never a clash-asset URI", async () => {
    const requests: CapturedRequest[] = [];
    await meshyAdapter.submit(
      invocation(
        { upstreamModel: "meshy-6", prompt: "", modelParams: { PBR: false } },
        { references: [{ slot: "image", index: 0, asset: { assetId: "a1", uri: "clash-asset://a1", kind: "image" } }] },
      ),
      context({ result: "image-task-1" }, requests, { apiKey: "msy_test" }, async () => ({
        form: "bytes",
        bytes: Uint8Array.from([1, 2, 3, 4]),
        mediaType: "image/png",
      })),
    );
    const imageUrl = requests[0]?.body.image_url;
    expect(typeof imageUrl).toBe("string");
    expect(imageUrl as string).toMatch(/^data:image\/png;base64,/);
    expect(imageUrl as string).not.toContain("clash-asset://");
  });

  it("refuses an executor-url image reference instead of handing it to Meshy", async () => {
    await expect(
      meshyAdapter.submit(
        invocation(
          { upstreamModel: "meshy-6", prompt: "", modelParams: { PBR: false } },
          { references: [{ slot: "image", index: 0, asset: { assetId: "a1", uri: "clash-asset://a1", kind: "image" } }] },
        ),
        context({}, [], { apiKey: "msy_test" }, async () => ({
          form: "executor-url",
          executorUrl: "http://127.0.0.1:1234/local-only",
          expiresAt: "2026-01-01T00:00:00.000Z",
        })),
      ),
    ).rejects.toMatchObject({ failure: { code: "invalid_request", retryable: false } });
  });

  it("rejects a second image reference before ever reading the account's credentials", async () => {
    await expect(
      meshyAdapter.submit(
        invocation(
          { upstreamModel: "meshy-6", prompt: "" },
          {
            references: [
              { slot: "image", index: 0, asset: { assetId: "a1", uri: "clash-asset://a1", kind: "image" } },
              { slot: "image", index: 1, asset: { assetId: "a2", uri: "clash-asset://a2", kind: "image" } },
            ],
          },
        ),
        throwingStore(),
      ),
    ).rejects.toMatchObject({ failure: { code: "invalid_request", requestState: "rejected" } });
  });

  it("submits rigging from a resolved model reference", async () => {
    const requests: CapturedRequest[] = [];
    const step = await meshyAdapter.submit(
      invocation(
        { upstreamModel: "rig", modelParams: { heightMeters: 1.8 } },
        { references: [{ slot: "model", index: 0, asset: { assetId: "m1", uri: "clash-asset://m1", kind: "model" } }] },
      ),
      context({ result: "rig-task-1" }, requests, { apiKey: "msy_test" }, async () => ({
        form: "provider-url",
        providerUrl: "https://example.com/char.glb",
        expiresAt: "2026-01-01T00:00:00.000Z",
        kind: "model",
        mediaType: "model/gltf-binary",
      })),
    );
    expect(requests[0]?.url).toBe(`${MESHY_BASE_URL}/v1/rigging`);
    expect(requests[0]?.body).toMatchObject({ model_url: "https://example.com/char.glb", height_meters: 1.8 });
    expect(step).toEqual({ status: "accepted", pollState: { kind: "rig", taskId: "rig-task-1" } });
  });

  it("rejects a rigging submit with no model reference before reading credentials", async () => {
    await expect(
      meshyAdapter.submit(invocation({ upstreamModel: "rig" }, { references: [] }), throwingStore()),
    ).rejects.toMatchObject({ failure: { code: "invalid_request", requestState: "rejected" } });
  });

  it("fails with authentication_failed, at the rejected boundary, when the account has no apiKey", async () => {
    await expect(
      meshyAdapter.submit(
        invocation({ upstreamModel: "meshy-7", prompt: "a monster mask" }),
        context({}, [], {}),
      ),
    ).rejects.toMatchObject({
      failure: { code: "authentication_failed", retryable: false, requestState: "rejected" },
    });
  });
});

describe("Meshy adapter: poll dispatch", () => {
  it("polls the image-to-3d task endpoint for image-to-3d state", async () => {
    const requests: CapturedRequest[] = [];
    const step = await meshyAdapter.poll!(
      invocation({}, { operation: "poll", pollState: { kind: "image-to-3d", taskId: "image-task-1" } }),
      context(
        { status: "SUCCEEDED", model_urls: { glb: "https://assets.meshy.ai/img.glb" } },
        requests,
      ),
    );
    expect(requests[0]?.url).toBe(`${MESHY_BASE_URL}/v1/image-to-3d/image-task-1`);
    expect(step).toEqual({
      status: "completed",
      media: { media: { url: "https://assets.meshy.ai/img.glb", mediaType: "model/gltf-binary", kind: "model" } },
    });
  });

  it("polls the rigging task endpoint for rig state", async () => {
    const requests: CapturedRequest[] = [];
    await meshyAdapter.poll!(
      invocation({}, { operation: "poll", pollState: { kind: "rig", taskId: "rig-task-1" } }),
      context({ status: "IN_PROGRESS" }, requests),
    );
    expect(requests[0]?.url).toBe(`${MESHY_BASE_URL}/v1/rigging/rig-task-1`);
  });

  it("polls the text-to-3d task endpoint for the preview phase", async () => {
    const requests: CapturedRequest[] = [];
    await meshyAdapter.poll!(
      invocation(
        {},
        {
          operation: "poll",
          pollState: { kind: "text-to-3d", phase: "preview", taskId: "preview-task-1", aiModel: "meshy-7", pbr: false },
        },
      ),
      context({ status: "IN_PROGRESS" }, requests),
    );
    expect(requests[0]?.url).toBe(`${MESHY_BASE_URL}/v2/text-to-3d/preview-task-1`);
  });

  it("rejects a malformed poll state before reading any credentials", async () => {
    await expect(
      meshyAdapter.poll!(invocation({}, { operation: "poll", pollState: { nonsense: true } }), throwingStore()),
    ).rejects.toMatchObject({ failure: { code: "contract_violation", requestState: "accepted" } });
  });
});
