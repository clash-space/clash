import { describe, expect, it } from "vitest";

import { createMockExternalAigcService } from "./local-aigc.js";

describe("provider plugin text output", () => {
  it("delivers a plugin text value through generateText without inventing an asset", async () => {
    const binding = {
      pluginId: "clash.minimax",
      version: "0.1.0",
      exportId: "minimax-execute",
      schemaHash: `sha256:${"c".repeat(64)}`,
    } as const;
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "minimax-primary",
        providerId: "minimax",
        upstreamId: "minimax",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "not-sent-to-a-vendor" },
        availableOAuth: [],
      }],
      providerPluginExecutor: async () => ({
        status: "completed",
        binding,
        output: {
          slot: "text",
          kind: "value",
          value: "M3 text from the executable provider.",
        },
      }),
    });

    await expect(service.generateText({
      taskId: "text-task",
      model: "minimax-m3",
      prompt: "Write one sentence.",
    })).resolves.toEqual({
      text: "M3 text from the executable provider.",
      provider: "minimax",
      modelEndpoint: "MiniMax-M3",
    });
  });

  it("preserves uploaded reference MIME types before invoking its plugin", async () => {
    const requests: Array<Record<string, any>> = [];
    const service = createMockExternalAigcService({
      providerAccounts: async () => [{
        id: "minimax-primary",
        providerId: "minimax",
        upstreamId: "minimax",
        enabled: true,
        configuredCredentials: ["apiKey"],
        credentials: { apiKey: "not-sent-to-a-vendor" },
        availableOAuth: [],
      }],
      providerPluginExecutor: async (request) => {
        requests.push(request as unknown as Record<string, any>);
        return {
          status: "accepted",
          binding: {
            pluginId: request.pluginId,
            version: "0.1.0",
            exportId: request.exportId,
            schemaHash: `sha256:${"d".repeat(64)}`,
          },
          pollState: { taskId: "minimax-h3-audio" },
        };
      },
    });

    await service.generateVideo({
      taskId: "video-task",
      model: "minimax-h3",
      prompt: "Keep the subject moving with the reference audio.",
      references: [
        { slot: "content", index: 0, text: { nodeId: "t0", value: "Keep " } },
        {
          slot: "content",
          index: 1,
          asset: {
            assetId: "image-1",
            uri: "clash-asset://image-1",
            kind: "image",
            mediaType: "image/png",
          },
        },
        { slot: "content", index: 2, text: { nodeId: "t2", value: " moving with " } },
        {
          slot: "content",
          index: 3,
          asset: {
            assetId: "audio-1",
            uri: "clash-asset://audio-1",
            kind: "audio",
            mediaType: "audio/mpeg",
          },
        },
        { slot: "content", index: 4, text: { nodeId: "t4", value: " and " } },
        {
          slot: "content",
          index: 5,
          asset: {
            assetId: "audio-2",
            uri: "clash-asset://audio-2",
            kind: "audio",
            mediaType: "audio/x-wav",
          },
        },
        { slot: "content", index: 6, text: { nodeId: "t6", value: "." } },
      ],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slot: "content",
          index: 3,
          asset: expect.objectContaining({ mediaType: "audio/mpeg" }),
        }),
        expect.objectContaining({
          slot: "content",
          index: 5,
          asset: expect.objectContaining({ mediaType: "audio/x-wav" }),
        }),
      ]),
    );
    expect(requests[0]?.input.values).not.toHaveProperty("referenceAudioUrls");
    expect(requests[0]?.input.values).not.toHaveProperty("orderedContentParts");
  });

  it("passes the selected implementation apiShape as route metadata", async () => {
    const requests: Array<Record<string, any>> = [];
    const service = createMockExternalAigcService({
      modelCards: async () => [{
        id: "dummy-analysis",
        aliases: [],
        name: "Dummy analysis",
        provider: "dummy-provider",
        kind: "text",
        semanticShape: "media_analysis",
        visibility: { scope: "public" },
        parameters: [],
        defaultParams: {},
        defaultAspectRatio: "1:1",
        input: {
          requiresPrompt: true,
          inputMode: { audios: { max: 1 } },
          promptModalities: ["text", "audio"],
        },
        providerImplementations: [{
          providerId: "dummy-provider",
          upstreamId: "dummy-provider",
          upstreamModel: "provider-managed",
          apiShape: "dummy-analyse-media",
          executorPluginId: "dummy.plugin",
          executorExportId: "execute",
        }],
      }],
      providerAccounts: async () => [{
        id: "dummy-account",
        providerId: "dummy-provider",
        upstreamId: "dummy-provider",
        enabled: true,
        configuredCredentials: [],
      }],
      providerPluginExecutor: async (request) => {
        requests.push(request as unknown as Record<string, any>);
        return {
          status: "completed",
          binding: {
            pluginId: request.pluginId,
            version: "0.1.0",
            exportId: request.exportId,
            schemaHash: `sha256:${"e".repeat(64)}`,
          },
          output: { slot: "text", kind: "value", value: "{}" },
        };
      },
    });

    await service.generateText({ taskId: "analysis-task", model: "dummy-analysis", prompt: "inspect" });
    expect(requests[0]?.input.values).toMatchObject({ apiShape: "dummy-analyse-media" });
  });
});
