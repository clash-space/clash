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
      referenceImageUrls: ["data:image/png;base64,AA=="],
      referenceAudioUrls: [
        "data:audio/mpeg;base64,AQID",
        "data:audio/x-wav;base64,BAUG",
      ],
      orderedContentParts: [
        { type: "text", text: "Keep " },
        { type: "image", url: "data:image/png;base64,AA==" },
        { type: "text", text: " moving with " },
        { type: "audio", url: "data:audio/mpeg;base64,AQID" },
        { type: "text", text: " and " },
        { type: "audio", url: "data:audio/x-wav;base64,BAUG" },
        { type: "text", text: "." },
      ],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input.values).toMatchObject({
      referenceAudioUrls: [
        "data:audio/mpeg;base64,AQID",
        "data:audio/x-wav;base64,BAUG",
      ],
      orderedContentParts: [
        { type: "text", text: "Keep " },
        { type: "image", url: "data:image/png;base64,AA==" },
        { type: "text", text: " moving with " },
        { type: "audio", url: "data:audio/mpeg;base64,AQID" },
        { type: "text", text: " and " },
        { type: "audio", url: "data:audio/x-wav;base64,BAUG" },
        { type: "text", text: "." },
      ],
    });
  });
});
