import { describe, expect, it } from "vitest";

import {
  listModelCatalogEntries,
  listModelUpstreamRoutes,
  type ProviderAccountAvailability,
} from "./model-routing.js";
import { ModelCardSchema, type ModelCard } from "./models.js";

const MODEL_INPUT = {
  id: "provider-capability-audio",
  name: "Provider capability audio",
  provider: "Test",
  kind: "audio" as const,
  defaultAspectRatio: "1:1",
  parameters: [
    {
      id: "voice_id",
      label: "Voice ID",
      type: "text" as const,
      defaultValue: "",
    },
    {
      id: "format",
      label: "Format",
      type: "select" as const,
      options: [{ label: "WAV", value: "wav" }],
      defaultValue: "wav",
    },
  ],
  defaultParams: { voice_id: "", format: "wav" },
  input: {
    requiresPrompt: true,
    inputMode: {},
    promptModalities: ["text" as const],
  },
  availableProviders: ["speech-basic", "speech-full"],
  defaultProvider: "speech-basic",
};

function model(): ModelCard {
  return ModelCardSchema.parse({
    ...MODEL_INPUT,
    providerImplementations: [
      {
        providerId: "speech-basic",
        upstreamId: "speech-basic",
        upstreamModel: "audio-v1",
        apiShape: "speech-basic",
        priority: 1,
        excludedParameterIds: ["voice_id"],
      },
      {
        providerId: "speech-full",
        upstreamId: "speech-full",
        upstreamModel: "audio-v1",
        apiShape: "speech-full",
        priority: 2,
      },
    ],
  });
}

const PROVIDERS: ProviderAccountAvailability[] = [
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
];

describe("provider parameter support", () => {
  it("rejects exclusions that do not name a canonical card parameter", () => {
    const parsed = ModelCardSchema.safeParse({
      ...MODEL_INPUT,
      providerImplementations: [
        {
          providerId: "speech-basic",
          upstreamId: "speech-basic",
          upstreamModel: "audio-v1",
          apiShape: "speech-basic",
          excludedParameterIds: ["invented_control"],
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["providerImplementations", 0, "excludedParameterIds", 0],
        message: expect.stringMatching(/declared parameter/i),
      }),
    );
  });

  it("rejects a provider parameter that is both overridden and excluded", () => {
    const parsed = ModelCardSchema.safeParse({
      ...MODEL_INPUT,
      providerImplementations: [
        {
          providerId: "speech-basic",
          upstreamId: "speech-basic",
          upstreamModel: "audio-v1",
          apiShape: "speech-basic",
          parameterOverrides: [MODEL_INPUT.parameters[0]],
          excludedParameterIds: ["voice_id"],
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["providerImplementations", 0, "excludedParameterIds", 0],
        message: expect.stringMatching(/override.*exclude/i),
      }),
    );
  });

  it("rejects a provider default override outside its effective parameter domain", () => {
    const parsed = ModelCardSchema.safeParse({
      ...MODEL_INPUT,
      providerImplementations: [
        {
          providerId: "speech-basic",
          upstreamId: "speech-basic",
          upstreamModel: "audio-v1",
          apiShape: "speech-basic",
          parameterOverrides: [
            {
              id: "format",
              label: "Format",
              type: "select",
              options: [{ label: "WAV", value: "wav" }],
              defaultValue: "wav",
            },
          ],
          defaultParamOverrides: { format: "mp3" },
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["providerImplementations", 0, "defaultParamOverrides", "format"],
        message: expect.stringMatching(/candidate/i),
      }),
    );
  });

  it("rejects an invalid default declared by a provider parameter override", () => {
    const parsed = ModelCardSchema.safeParse({
      ...MODEL_INPUT,
      providerImplementations: [
        {
          providerId: "speech-basic",
          upstreamId: "speech-basic",
          upstreamModel: "audio-v1",
          apiShape: "speech-basic",
          parameterOverrides: [
            {
              id: "format",
              label: "Format",
              type: "select",
              options: [{ label: "WAV", value: "wav" }],
              defaultValue: "mp3",
            },
          ],
        },
      ],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues).toContainEqual(
      expect.objectContaining({
        path: ["providerImplementations", 0, "parameterOverrides", 0, "defaultValue"],
        message: expect.stringMatching(/candidate/i),
      }),
    );
  });

  it("skips a provider that excludes a requested parameter", () => {
    const routes = listModelUpstreamRoutes({
      modelCode: "provider-capability-audio",
      kind: "audio",
      models: [model()],
      configuredProviders: PROVIDERS,
      requestedParameterIds: ["voice_id"],
    });

    expect(routes.map((route) => route.providerId)).toEqual(["speech-full"]);
  });

  it("keeps the full card and marks a parameter unavailable only when every configured provider excludes it", () => {
    const [basicOnly] = listModelCatalogEntries({
      models: [model()],
      configuredProviders: [PROVIDERS[0]!],
    });
    const [both] = listModelCatalogEntries({
      models: [model()],
      configuredProviders: PROVIDERS,
    });

    expect(basicOnly?.model.parameters.map(({ id }) => id)).toEqual([
      "voice_id",
      "format",
    ]);
    expect(basicOnly?.unavailableParameterIds).toEqual(["voice_id"]);
    expect(both?.unavailableParameterIds).toEqual([]);
  });
});
