import { describe, expect, it } from "vitest";

import { ModelCardSchema } from "@clash/shared-types";

import {
  createMockExternalAigcService,
  type ProviderPluginExecutorRequest,
} from "./local-aigc.js";

const model = ModelCardSchema.parse({
  id: "provider-capability-audio",
  name: "Provider capability audio",
  provider: "Test",
  kind: "audio",
  defaultAspectRatio: "1:1",
  parameters: [
    {
      id: "voice_id",
      label: "Voice ID",
      type: "text",
      defaultValue: "",
    },
  ],
  defaultParams: { voice_id: "" },
  input: {
    requiresPrompt: true,
    inputMode: {},
    promptModalities: ["text"],
  },
  availableProviders: ["speech-basic", "speech-full"],
  defaultProvider: "speech-basic",
  providerImplementations: [
    {
      providerId: "speech-basic",
      upstreamId: "speech-basic",
      upstreamModel: "audio-v1",
      apiShape: "speech-basic",
      priority: 1,
      excludedParameterIds: ["voice_id"],
      executorPluginId: "test.speech",
      executorExportId: "basic-execute",
    },
    {
      providerId: "speech-full",
      upstreamId: "speech-full",
      upstreamModel: "audio-v1",
      apiShape: "speech-full",
      priority: 2,
      executorPluginId: "test.speech",
      executorExportId: "full-execute",
    },
  ],
});

describe("provider parameter routing", () => {
  it("routes a selected provider-only feature to an implementation that supports it", async () => {
    const requests: ProviderPluginExecutorRequest[] = [];
    const service = createMockExternalAigcService({
      modelCards: async () => [model],
      providerAccounts: async () => [
        {
          id: "basic-account",
          providerId: "speech-basic",
          upstreamId: "speech-basic",
          enabled: true,
        },
        {
          id: "full-account",
          providerId: "speech-full",
          upstreamId: "speech-full",
          enabled: true,
        },
      ],
      providerPluginExecutor: async (request) => {
        requests.push(request);
        return {
          status: "completed",
          binding: {
            pluginId: request.pluginId,
            version: "0.1.0",
            exportId: request.exportId,
            schemaHash: `sha256:${"a".repeat(64)}`,
          },
          media: {
            url: "data:audio/wav;base64,AA==",
            contentType: "audio/wav",
          },
        };
      },
    });

    await service.generateAudio({
      taskId: "audio-with-voice",
      model: model.id,
      prompt: "Read this line.",
      modelParams: { voice_id: "speaker-123" },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.exportId).toBe("full-execute");
  });
});
