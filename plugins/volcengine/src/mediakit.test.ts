import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { validateExecutablePluginPackage } from "@clash/shared-types";
import {
  MEDIAKIT_DEFAULT_BASE_URL,
  buildMediaKitRequest,
  mediaKitPoll,
  mediaKitSubmit,
  volcengineMediaKitAdapter,
} from "./mediakit.js";

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("Volcengine MediaKit request translation", () => {
  it("builds a standard-tier request with an enum resolution and bitrate level", () => {
    expect(
      buildMediaKitRequest(
        {
          toolVersion: "standard",
          scene: "ugc",
          enhanceStyle: "hd",
          resolution: "1080p",
          bitrateLevel: "medium",
          fps: 30,
          clientToken: "run-1",
        },
        "https://media.test/source.mp4",
      ),
    ).toEqual({
      video_url: "https://media.test/source.mp4",
      tool_version: "standard",
      scene: "ugc",
      enhance_style: "hd",
      resolution: "1080p",
      bitrate_level: "medium",
      fps: 30,
      client_token: "run-1",
    });
  });

  it("accepts resolution_limit and bitrate as numeric alternatives", () => {
    expect(
      buildMediaKitRequest(
        {
          toolVersion: "professional",
          enhanceStyle: "natural",
          resolutionLimit: 2160,
          bitrate: 12000,
          fps: 60,
          bitDepth: 10,
        },
        "https://media.test/source.mp4",
      ),
    ).toEqual({
      video_url: "https://media.test/source.mp4",
      tool_version: "professional",
      enhance_style: "natural",
      resolution_limit: 2160,
      bitrate: 12000,
      fps: 60,
      bit_depth: 10,
    });
  });

  it("rejects scene for the professional tool version", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "professional", scene: "common" },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/scene.*standard/i);
  });

  it("rejects bit_depth for the standard tool version", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "standard", bitDepth: 8 },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/bit_depth.*professional/i);
  });

  it("rejects both resolution and resolution_limit together", () => {
    expect(() =>
      buildMediaKitRequest(
        {
          toolVersion: "standard",
          resolution: "1080p",
          resolutionLimit: 1080,
        },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/resolution.*resolution_limit/i);
  });

  it("rejects both bitrate_level and bitrate together", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "standard", bitrateLevel: "high", bitrate: 5000 },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/bitrate_level.*bitrate/i);
  });

  it("rejects a resolution_limit outside the published 128..4320 range", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "standard", resolutionLimit: 100 },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/resolution_limit/i);
  });

  it("rejects an fps outside the published 15..120 range", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "standard", fps: 200 },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/fps/i);
  });

  it("never invents a preserve_audio field", () => {
    const body = buildMediaKitRequest(
      { toolVersion: "standard" },
      "https://media.test/source.mp4",
    );
    expect(body).not.toHaveProperty("preserve_audio");
  });

  it("accepts a mediaOutputDestination with a non-empty vod:// path", () => {
    expect(
      buildMediaKitRequest(
        { toolVersion: "standard", mediaOutputDestination: "vod://bucket/key.mp4" },
        "https://media.test/source.mp4",
      ),
    ).toMatchObject({ media_output_destination: "vod://bucket/key.mp4" });
  });

  it("accepts a mediaOutputDestination with a non-empty tos:// path", () => {
    expect(
      buildMediaKitRequest(
        { toolVersion: "standard", mediaOutputDestination: "tos://bucket/key.mp4" },
        "https://media.test/source.mp4",
      ),
    ).toMatchObject({ media_output_destination: "tos://bucket/key.mp4" });
  });

  it("rejects a mediaOutputDestination with an empty vod:// path", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "standard", mediaOutputDestination: "vod://" },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/media_output_destination/i);
  });

  it("rejects a mediaOutputDestination with an empty tos:// path", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "standard", mediaOutputDestination: "tos://" },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/media_output_destination/i);
  });

  it("rejects a mediaOutputDestination with an unsupported scheme", () => {
    expect(() =>
      buildMediaKitRequest(
        { toolVersion: "standard", mediaOutputDestination: "s3://bucket/key.mp4" },
        "https://media.test/source.mp4",
      ),
    ).toThrow(/media_output_destination/i);
  });
});

describe("Volcengine MediaKit lifecycle", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("submits once and returns the durable task id from the documented envelope", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetch = vi.fn(
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return response({
          success: true,
          task_id: "mk-task-1",
          request_id: "req-1",
        });
      },
    );
    const body = {
      video_url: "https://media.test/source.mp4",
      tool_version: "standard",
    };

    await expect(
      mediaKitSubmit({
        apiKey: "mk-key",
        body,
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "mk-task-1" },
    });
    expect(calls).toEqual([
      {
        url: `${MEDIAKIT_DEFAULT_BASE_URL}/api/v1/tools/enhance-video`,
        init: {
          method: "POST",
          headers: {
            authorization: "Bearer mk-key",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      },
    ]);
  });

  it("polls and reports a running task as still accepted", async () => {
    const fetch = vi.fn(async () => response({ status: "running" }));

    await expect(
      mediaKitPoll({
        apiKey: "mk-key",
        state: { taskId: "mk-task-1" },
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "mk-task-1" },
      retryAfterMs: 5_000,
    });
  });

  it("polls once and returns the documented completed result.video_url", async () => {
    const calls: string[] = [];
    const fetch = vi.fn(async (input: string | URL | Request) => {
      calls.push(String(input));
      return response({
        status: "completed",
        result: {
          video_url: "https://media.test/result.mp4",
          duration: 12.5,
          resolution: "1080p",
          fps: 30,
          tool_version: "standard",
        },
      });
    });

    await expect(
      mediaKitPoll({
        apiKey: "mk-key",
        state: { taskId: "mk-task-1" },
        fetch: fetch as typeof globalThis.fetch,
      }),
    ).resolves.toEqual({
      status: "completed",
      media: {
        media: {
          url: "https://media.test/result.mp4",
          mediaType: "video/mp4",
        },
      },
    });
    expect(calls).toEqual([
      `${MEDIAKIT_DEFAULT_BASE_URL}/api/v1/tasks/mk-task-1`,
    ]);
  });

  it("reports a failed task with the documented error contract", async () => {
    await expect(
      mediaKitPoll({
        apiKey: "mk-key",
        state: { taskId: "mk-task-failed" },
        fetch: (async () =>
          response({
            status: "failed",
            error: {
              code: "InvalidParameter",
              type: "invalid_request",
              message: "fps must be between 15 and 120",
              param: "fps",
            },
          })) as typeof globalThis.fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "provider_failed",
        message: expect.stringMatching(/fps must be between 15 and 120/),
        retryable: false,
        requestState: "accepted",
        providerCode: "InvalidParameter",
      },
    });
  });

  it("classifies an ambiguous submit outage as retryable", async () => {
    await expect(
      mediaKitSubmit({
        apiKey: "mk-key",
        body: { video_url: "https://media.test/source.mp4" },
        fetch: (async () =>
          response(
            { error: { message: "upstream unavailable" } },
            { status: 503, statusText: "Service Unavailable" },
          )) as typeof globalThis.fetch,
      }),
    ).rejects.toMatchObject({
      failure: {
        code: "provider_unavailable",
        retryable: true,
        requestState: "unknown",
        providerCode: "HTTP_503",
      },
    });
  });

  it("resolves the account apiKey and video reference through Host-scoped capabilities", async () => {
    const fetch = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        response({ success: true, task_id: "mk-task-2", request_id: "req-2" }),
    );
    vi.stubGlobal("fetch", fetch);
    const store = new Map([
      ["apiKey", "account-key"],
      ["baseUrl", "https://mediakit-gateway.test"],
    ]);

    await expect(
      volcengineMediaKitAdapter.submit(
        {
          input: {
            values: { toolVersion: "standard", enhanceStyle: "hd" },
            references: [
              {
                slot: "video",
                index: 0,
                asset: {
                  assetId: "source-video",
                  uri: "clash-asset://source-video",
                  kind: "video",
                },
              },
            ],
          },
        } as never,
        {
          store: { get: async (key: string) => store.get(key) },
          reference: async () => ({
            form: "provider-url" as const,
            providerUrl: "https://media.test/reference.mp4",
            expiresAt: "2026-08-13T12:00:00.000Z",
            kind: "video" as const,
          }),
        } as never,
      ),
    ).resolves.toEqual({
      status: "accepted",
      pollState: { taskId: "mk-task-2" },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://mediakit-gateway.test/api/v1/tools/enhance-video",
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      video_url: "https://media.test/reference.mp4",
      tool_version: "standard",
      enhance_style: "hd",
    });
  });

  it("rejects a video reference that resolves to bytes instead of a Host provider-url", async () => {
    const store = new Map([["apiKey", "account-key"]]);

    await expect(
      volcengineMediaKitAdapter.submit(
        {
          input: {
            values: { toolVersion: "standard" },
            references: [
              {
                slot: "video",
                index: 0,
                asset: {
                  assetId: "source-video",
                  uri: "clash-asset://source-video",
                  kind: "video",
                },
              },
            ],
          },
        } as never,
        {
          store: { get: async (key: string) => store.get(key) },
          reference: async () => ({
            form: "bytes" as const,
            bytes: new Uint8Array([1, 2, 3]),
            mediaType: "video/mp4",
            kind: "video" as const,
          }),
        } as never,
      ),
    ).rejects.toMatchObject({
      failure: {
        code: "invalid_request",
        message: expect.stringMatching(/provider-url/i),
        requestState: "rejected",
      },
    });
  });
});

describe("Volcengine plugin package activation", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const json = async (path: string) =>
    JSON.parse(await readFile(join(root, path), "utf8"));

  it("resolves the MediaKit video-enhance binding against its exact named provider, not a guess among the package's three providers", async () => {
    const manifest = await json("manifest.json");
    const providerPaths: { path: string }[] = manifest.contributes.providers;
    const providers = Object.fromEntries(
      await Promise.all(
        providerPaths.map(async ({ path }) => [path, await json(path)]),
      ),
    );
    const bindingPaths: { path: string }[] = manifest.contributes.modelBindings;
    const bindings = Object.fromEntries(
      await Promise.all(
        bindingPaths.map(async ({ path }) => [path, await json(path)]),
      ),
    );
    const cardPaths: { path: string }[] = manifest.contributes.cards;
    const cards = Object.fromEntries(
      await Promise.all(cardPaths.map(async ({ path }) => [path, await json(path)])),
    );
    const contractTests = Object.fromEntries(
      await Promise.all(
        manifest.contractTests.map(async (path: string) => [path, await json(path)]),
      ),
    );

    const validated = validateExecutablePluginPackage(
      manifest,
      cards,
      contractTests,
      { providers, modelBindings: bindings },
    );

    const resolved = validated.modelBindings["bindings/video-enhance.json"];
    expect(resolved.spec.providerId).toBe("volcengine-mediakit");
    expect(resolved.spec.upstreamId).toBe("volcengine-mediakit");
    expect(resolved.spec.executorExportId).toBe("volcengine-mediakit-execute");
  });
});
