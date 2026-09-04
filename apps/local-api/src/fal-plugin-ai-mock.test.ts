import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

import { loadTrustedBundledPluginModule } from "./bundled-plugin-modules.js";
import {
  createMockFalQueueService,
  handleFalMockHttpRequest,
} from "./fal-mock.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

function invocation(input: {
  id: string;
  values: ExecutablePluginInvocation["input"]["values"];
  references?: ExecutablePluginInvocation["input"]["references"];
  operation?: "submit" | "poll";
  pollState?: ExecutablePluginInvocation["pollState"];
}): ExecutablePluginInvocation {
  return {
    protocol: "clash.plugin.invoke/v1",
    invocationId: `ai-mock-${input.id}`,
    taskId: `task-${input.id}`,
    projectId: "project-ai-mock",
    operation: input.operation ?? "submit",
    target: {
      pluginId: "clash.fal",
      version: "0.2.0",
      exportId: "fal-execute",
      schemaHash: `sha256:${"a".repeat(64)}`,
      kind: "provider-executor",
    },
    input: {
      values: input.values,
      references: input.references ?? [],
    },
    assetInputs: [],
    ...(input.pollState === undefined ? {} : { pollState: input.pollState }),
    actor: { kind: "system", id: "ai-mock" },
  };
}

describe("Fal plugin against local ai-mock", () => {
  it("runs image edit, reference video, and TTS through the real plugin queue lifecycle", async () => {
    const falMock = createMockFalQueueService();
    const loaded = await loadTrustedBundledPluginModule("clash.fal");
    const ingested: Array<{
      kind: string;
      mediaType?: string;
      byteLength: number;
      url: string;
    }> = [];

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      if (new URL(request.url).origin !== "http://fal.mock") {
        throw new Error(`Unexpected non-mock request: ${request.url}`);
      }
      return handleFalMockHttpRequest(falMock, request);
    });
    vi.stubGlobal("fetch", mockFetch);

    const hostContext = {
      store: {
        get: async (key: string) =>
          key === "apiKey"
            ? "mock"
            : key === "queueBaseUrl"
              ? "http://fal.mock/fal"
              : undefined,
        put: async () => undefined,
        remove: async () => undefined,
      },
      reference: async (reference: { asset: { assetId: string; kind: string; mediaType?: string } }) => ({
        form: "provider-url" as const,
        providerUrl: `http://assets.mock/${reference.asset.assetId}`,
        kind: reference.asset.kind,
        mediaType: reference.asset.mediaType,
      }),
      upload: async (request: {
        slot: string;
        kind: "image" | "video" | "audio" | "model";
        mediaType?: string;
        url?: string;
      }) => {
        expect(request.url).toBeTruthy();
        const response = await mockFetch(request.url!);
        expect(response.status).toBe(200);
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(bytes.byteLength).toBeGreaterThan(0);
        ingested.push({
          kind: request.kind,
          mediaType: request.mediaType,
          byteLength: bytes.byteLength,
          url: request.url!,
        });
        const assetId = `ai-mock-${request.kind}-${ingested.length}`;
        return {
          slot: request.slot,
          kind: "asset" as const,
          asset: {
            assetId,
            uri: `clash-asset://${assetId}`,
            kind: request.kind,
            mediaType: request.mediaType,
          },
        };
      },
    };

    const cases: Array<{
      id: string;
      values: ExecutablePluginInvocation["input"]["values"];
      references: ExecutablePluginInvocation["input"]["references"];
      endpoint: string;
    }> = [
      {
        id: "nano-edit",
        values: {
          modelId: "nano-banana-2",
          upstreamModel: "fal-ai/nano-banana-2",
          kind: "image",
          prompt: "keep pose, replace costume",
          aspectRatio: "9:16",
          modelParams: {},
        },
        references: [
          {
            slot: "content" as const,
            index: 0,
            asset: {
              assetId: "pose.png",
              uri: "clash-asset://pose",
              kind: "image" as const,
              mediaType: "image/png",
            },
          },
        ],
        endpoint: "fal-ai/nano-banana-2/edit",
      },
      {
        id: "seedance-ref",
        values: {
          modelId: "seedance-2-ref",
          upstreamModel: "bytedance/seedance-2.0/reference-to-video",
          kind: "video",
          prompt: "@Image1 follows @Video1 timing",
          aspectRatio: "16:9",
          duration: 4,
          modelParams: { resolution: "480p", generate_audio: true },
        },
        references: [
          {
            slot: "content" as const,
            index: 0,
            asset: {
              assetId: "fighter.png",
              uri: "clash-asset://fighter",
              kind: "image" as const,
              mediaType: "image/png",
            },
          },
          {
            slot: "content" as const,
            index: 1,
            asset: {
              assetId: "motion.mp4",
              uri: "clash-asset://motion",
              kind: "video" as const,
              mediaType: "video/mp4",
            },
          },
        ],
        endpoint: "bytedance/seedance-2.0/reference-to-video",
      },
      {
        id: "minimax-tts",
        values: {
          modelId: "minimax-tts",
          upstreamModel: "fal-ai/minimax/speech-02-hd",
          kind: "audio",
          prompt: "Fal plugin ai mock check",
          modelParams: { voice_id: "female-warm", format: "mp3" },
        },
        references: [],
        endpoint: "fal-ai/minimax/speech-02-hd",
      },
    ];

    for (const testCase of cases) {
      const submitted = await loaded.plugin.invoke(
        invocation(testCase),
        hostContext as never,
      );
      expect(submitted).toMatchObject({
        status: "accepted",
        pollState: { endpoint: testCase.endpoint },
      });

      let result = submitted;
      let polls = 0;
      while (result.status === "accepted" && polls < 6) {
        result = await loaded.plugin.invoke(
          invocation({
            ...testCase,
            operation: "poll",
            pollState: result.pollState,
          }),
          hostContext as never,
        );
        polls += 1;
      }

      expect(polls).toBe(4);
      expect(result).toMatchObject({
        status: "completed",
        outputs: [{ kind: "asset" }],
      });
    }

    expect(ingested.map(({ kind }) => kind)).toEqual([
      "image",
      "video",
      "audio",
    ]);
    expect(ingested.map(({ mediaType }) => mediaType)).toEqual([
      "image/svg+xml",
      "video/mp4",
      "audio/wav",
    ]);
    expect(mockFetch).toHaveBeenCalledTimes(18);
  });
});
