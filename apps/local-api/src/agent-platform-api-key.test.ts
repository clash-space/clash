import { describe, expect, it } from "vitest";

import { ModelCardSchema } from "@clash/shared-types";

import { localExecutableModelCards } from "./local-aigc.js";

const googleCard = ModelCardSchema.parse({
  id: "google-plugin-boundary-test",
  name: "Google plugin boundary test",
  provider: "Google",
  kind: "image",
  defaultAspectRatio: "1:1",
  parameters: [],
  defaultParams: {},
  input: {
    requiresPrompt: true,
    inputMode: {},
    promptModalities: ["text"],
  },
  availableProviders: ["google-direct", "google-plugin"],
  defaultProvider: "google-plugin",
  providerImplementations: [
    {
      providerId: "google-direct",
      upstreamId: "google-ai-studio",
      upstreamModel: "gemini-image",
      apiShape: "google-ai-studio",
      requiredCredentials: ["apiKey"],
    },
    {
      providerId: "google-plugin",
      upstreamId: "google-ai-studio",
      upstreamModel: "gemini-image",
      apiShape: "google-ai-studio",
      executorPluginId: "clash.google",
      executorExportId: "google-execute",
    },
  ],
});

describe("the local Google execution boundary", () => {
  it("exposes the executable Provider plugin route, never the old direct adapter", () => {
    const [filtered] = localExecutableModelCards([googleCard]);

    expect(filtered?.providerImplementations).toEqual([
      expect.objectContaining({
        providerId: "google-plugin",
        executorPluginId: "clash.google",
        executorExportId: "google-execute",
      }),
    ]);
  });
});
