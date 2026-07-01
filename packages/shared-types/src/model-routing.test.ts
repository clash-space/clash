import { describe, expect, it } from "vitest";

import {
  MODEL_UPSTREAM_ROUTES,
  MODEL_PROVIDER_DEFINITIONS,
  listModelCatalogEntries,
  listProviderModelSupport,
  listModelUpstreamRoutes,
  resolveModelUpstreamRoute,
  type ProviderAccountAvailability,
  type UpstreamAvailability,
} from "./model-routing";
import { MODEL_CARDS, ModelCardSchema } from "./models";

describe("model upstream routing", () => {
  it("allows model cards to declare current provider account implementations", () => {
    const parsed = ModelCardSchema.parse({
      id: "seedance-2-text",
      name: "Seedance 2.0",
      provider: "ByteDance",
      kind: "video",
      parameters: [],
      defaultParams: {},
      availableProviders: ["jimeng", "volcengine", "replicate", "kie", "mock"],
      defaultProvider: "jimeng",
    });

    expect(parsed.availableProviders).toEqual(["jimeng", "volcengine", "replicate", "kie", "mock"]);
    expect(parsed.defaultProvider).toBe("jimeng");
  });

  it("keeps every routed model backed by a first-class model card", () => {
    const modelCardIds = new Set(MODEL_CARDS.map((model) => model.id));
    const routedModelIds = [...new Set(MODEL_UPSTREAM_ROUTES.map((route) => route.modelCode))].sort();

    expect(routedModelIds.filter((modelId) => !modelCardIds.has(modelId))).toEqual([]);
  });

  it("routes canonical Seedance model codes to fal-shaped mock endpoints", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "seedance-2-ref",
      kind: "video",
      allowMock: true,
      configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
    });

    expect(route).toMatchObject({
      modelCode: "seedance-2-ref",
      upstreamId: "mock",
      upstreamModel: "bytedance/seedance-2.0/reference-to-video",
      apiShape: "fal",
    });
  });

  it("skips configured upstreams without required variables and falls back", () => {
    const upstreams: UpstreamAvailability[] = [
      { upstreamId: "fal", enabled: true, configuredCredentials: [] },
      { upstreamId: "google", enabled: true, configuredCredentials: ["vertexCredentials"] },
    ];

    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-flash-image-2",
      kind: "image",
      configuredUpstreams: upstreams,
    });

    expect(route).toMatchObject({
      upstreamId: "google",
      upstreamModel: "gemini-3.1-flash-image-preview",
    });
  });

  it("orders fallback candidates by user upstream order before route defaults", () => {
    const routes = listModelUpstreamRoutes({
      modelCode: "gemini-flash-image-2",
      kind: "image",
      configuredUpstreams: [
        { upstreamId: "fal", enabled: true, configuredCredentials: ["apiKey"] },
        { upstreamId: "google", enabled: true, configuredCredentials: ["vertexCredentials"] },
      ],
    });

    expect(routes.map((route) => route.upstreamId)).toEqual(["fal", "google"]);
  });

  it("keeps mock routes out of hosted resolution unless explicitly allowed", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "seedance-2-text",
      kind: "video",
      configuredUpstreams: [{ upstreamId: "mock", enabled: true }],
    });

    expect(route).toBeNull();
  });

  it("marks mock-backed catalog entries available only when mock routing is explicitly configured", () => {
    const mockEntries = listModelCatalogEntries({
      configuredProviders: [{ providerId: "mock", upstreamId: "mock", enabled: true }],
    });
    const mockNanoBanana = mockEntries.find((entry) => entry.model.id === "nano-banana-2");

    expect(mockNanoBanana).toMatchObject({
      tier: "available",
      selectedRoute: {
        providerId: "mock",
        upstreamId: "mock",
        upstreamModel: "fal-ai/nano-banana-2",
      },
      missingCredentials: [],
    });

    const unavailableEntries = listModelCatalogEntries({ configuredProviders: [] });
    const unavailableNanoBanana = unavailableEntries.find((entry) => entry.model.id === "nano-banana-2");
    expect(unavailableNanoBanana?.selectedRoute?.upstreamId).not.toBe("mock");
  });

  it("routes GPT Image 2 to the OpenAI image upstream with variables", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredUpstreams: [
        { upstreamId: "openai", enabled: true, configuredCredentials: ["apiKey"] },
      ],
    });

    expect(route).toMatchObject({
      modelCode: "gpt-image-2",
      upstreamId: "openai",
      upstreamModel: "gpt-image-2",
      apiShape: "openai-images",
      requiredCredentials: ["apiKey"],
    });
    expect(route).not.toHaveProperty("requiredSecretIds");
  });

  it("routes official Google AI Studio image models when a Gemini API key is configured", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-flash-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "google",
      upstreamModel: "gemini-3.1-flash-image",
      apiShape: "google-ai-studio",
      requiredCredentials: ["apiKey"],
    });
  });

  it("routes Minimax TTS to fal when the fal key is configured", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "minimax-tts",
      kind: "audio",
      configuredUpstreams: [
        { upstreamId: "fal", enabled: true, configuredCredentials: ["apiKey"] },
      ],
    });

    expect(route).toMatchObject({
      modelCode: "minimax-tts",
      upstreamId: "fal",
      upstreamModel: "fal-ai/minimax/speech-02-hd",
      apiShape: "fal",
      requiredCredentials: ["apiKey"],
    });
  });

  it("keeps local ASR model cards available without hosted provider setup", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "sensevoice-small-asr",
      kind: "asr",
      configuredProviders: [],
    });

    expect(route).toMatchObject({
      modelCode: "sensevoice-small-asr",
      providerId: "local",
      upstreamId: "local",
      upstreamModel: "iic/SenseVoiceSmall",
      apiShape: "local-asr",
    });

    const entries = listModelCatalogEntries({ configuredProviders: [] });
    expect(entries.find((entry) => entry.model.id === "sensevoice-small-asr")).toMatchObject({
      tier: "available",
      selectedRoute: {
        providerId: "local",
        upstreamId: "local",
        upstreamModel: "iic/SenseVoiceSmall",
      },
      missingCredentials: [],
    });
  });

  it("routes hosted official media providers from configured provider accounts", () => {
    const cases = [
      {
        modelCode: "kling-3",
        kind: "video" as const,
        providerId: "kling",
        upstreamId: "kling",
        upstreamModel: "kling-v3",
        apiShape: "kling",
        credentials: ["accessKey", "secretKey"],
      },
      {
        modelCode: "minimax-tts",
        kind: "audio" as const,
        providerId: "minimax",
        upstreamId: "minimax",
        upstreamModel: "speech-02-hd",
        apiShape: "minimax",
        credentials: ["apiKey"],
      },
      {
        modelCode: "elevenlabs-tts",
        kind: "audio" as const,
        providerId: "elevenlabs",
        upstreamId: "elevenlabs",
        upstreamModel: "eleven_multilingual_v2",
        apiShape: "elevenlabs",
        credentials: ["apiKey"],
      },
      {
        modelCode: "seedance-2-ref",
        kind: "video" as const,
        providerId: "jimeng",
        upstreamId: "jimeng",
        upstreamModel: "seedance2.0fast",
        apiShape: "dreamina-cli",
        credentials: [],
        oauth: ["dreamina"],
      },
      {
        modelCode: "seedance-2-text",
        kind: "video" as const,
        providerId: "volcengine",
        upstreamId: "volcengine",
        upstreamModel: "doubao-seedance-2-0-pro",
        apiShape: "modelark",
        credentials: ["apiKey"],
      },
    ] as const;

    for (const item of cases) {
      const route = resolveModelUpstreamRoute({
        modelCode: item.modelCode,
        kind: item.kind,
        configuredProviders: [
          {
            providerId: item.providerId,
            upstreamId: item.upstreamId,
            enabled: true,
            configuredCredentials: [...item.credentials],
            availableOAuth: "oauth" in item ? [...item.oauth] : undefined,
          },
        ],
      });

      expect(route, item.providerId).toMatchObject({
        modelCode: item.modelCode,
        providerId: item.providerId,
        upstreamId: item.upstreamId,
        upstreamModel: item.upstreamModel,
        apiShape: item.apiShape,
      });
      if (item.credentials.length) expect(route).toMatchObject({ requiredCredentials: [...item.credentials] });
      else expect(route?.requiredCredentials).toBeUndefined();
      if ("oauth" in item) expect(route).toMatchObject({ requiredOAuth: [...item.oauth] });
    }
  });

  it("routes Dreamina through the official CLI adapter only when OAuth is connected", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "seedance-2-ref",
      kind: "video",
      configuredProviders: [
        {
          providerId: "jimeng",
          upstreamId: "jimeng",
          enabled: true,
          availableOAuth: ["dreamina"],
        } as any,
      ],
    });

    expect(route).toMatchObject({
      modelCode: "seedance-2-ref",
      providerId: "jimeng",
      upstreamId: "jimeng",
      upstreamModel: "seedance2.0fast",
      apiShape: "dreamina-cli",
      requiredOAuth: ["dreamina"],
    });
    expect(route?.requiredCredentials).toBeUndefined();
  });

  it("keeps Dreamina model cards in the missing-provider tier until OAuth is connected", () => {
    const entries = listModelCatalogEntries({
      configuredProviders: [
        {
          providerId: "jimeng",
          upstreamId: "jimeng",
          enabled: true,
          availableOAuth: [],
        } as any,
      ],
    });

    const seedance = entries.find((entry) => entry.model.id === "seedance-2-ref");
    expect(seedance).toMatchObject({
      tier: "configured-provider",
      selectedRoute: null,
      candidateProviders: ["jimeng"],
      missingCredentials: [],
    });
    expect((seedance as any)?.missingOAuth).toEqual(["dreamina"]);
  });

  it("indexes provider-declared model support by provider", () => {
    const supports = listProviderModelSupport();
    const byProvider = new Map<string, (typeof supports)[number]>(
      supports.map((support) => [support.providerId, support]),
    );

    expect(byProvider.get("kling")).toMatchObject({
      providerId: "kling",
      upstreamId: "kling",
      models: [expect.objectContaining({ id: "kling-3", apiShape: "kling" })],
      requiredCredentials: ["accessKey", "secretKey"],
    });
    expect(byProvider.get("minimax")).toMatchObject({
      providerId: "minimax",
      models: [expect.objectContaining({ id: "minimax-tts", apiShape: "minimax" })],
      requiredCredentials: ["apiKey"],
    });
    expect(byProvider.get("elevenlabs")).toMatchObject({
      providerId: "elevenlabs",
      models: [expect.objectContaining({ id: "elevenlabs-tts", apiShape: "elevenlabs" })],
      requiredCredentials: ["apiKey"],
    });
    expect(byProvider.get("jimeng")?.models.map((model) => model.id)).toContain("seedance-2-ref");
    expect(byProvider.get("volcengine")?.models.map((model) => model.id)).toContain("seedance-2-text");
    expect(byProvider.has("midjourney")).toBe(false);
  });

  it("keeps provider declarations as the source for hosted provider support", () => {
    const declared = new Set(
      MODEL_PROVIDER_DEFINITIONS.map((provider) => [provider.providerId, provider.upstreamId, provider.region ?? ""].join(":")),
    );

    for (const support of listProviderModelSupport()) {
      expect(declared.has([support.providerId, support.upstreamId, support.region ?? ""].join(":"))).toBe(true);
    }
  });

  it("falls back Gemini TTS model codes to fal when only the fal key is configured", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-tts",
      kind: "audio",
      configuredUpstreams: [
        { upstreamId: "fal", enabled: true, configuredCredentials: ["apiKey"] },
      ],
    });

    expect(route).toMatchObject({
      upstreamId: "fal",
      upstreamModel: "fal-ai/minimax/speech-02-hd",
      apiShape: "fal",
    });
  });

  it("resolves weighted provider accounts before static route priority", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-flash-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
          weight: 10,
        },
        {
          providerId: "fal",
          enabled: true,
          configuredCredentials: ["apiKey"],
          weight: 90,
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "fal",
      upstreamId: "fal",
      upstreamModel: "fal-ai/nano-banana-2",
      apiShape: "fal",
    });
  });

  it("uses configured provider order before static route priority when provider weights tie", () => {
    const routes = listModelUpstreamRoutes({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          configuredCredentials: ["apiKey"],
        },
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(routes.map((route) => `${route.providerId}/${route.upstreamId}`)).toEqual([
      "replicate/replicate",
      "official/openai",
    ]);
  });

  it("honors per-account supported model filters before provider priority", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 1,
          configuredCredentials: ["apiKey"],
          supportedModelIds: ["nano-banana-2"],
        },
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          priority: 20,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "openai",
      upstreamModel: "gpt-image-2",
    });

    const allowedRoute = resolveModelUpstreamRoute({
      modelCode: "nano-banana-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 1,
          configuredCredentials: ["apiKey"],
          supportedModelIds: ["nano-banana-2"],
        },
      ],
    });

    expect(allowedRoute).toMatchObject({
      providerId: "replicate",
      upstreamId: "replicate",
      upstreamModel: "google/nano-banana-2",
    });
  });

  it("applies provider ordering only to the model it was configured for", () => {
    const configuredProviders = [
      {
        providerId: "fal",
        upstreamId: "fal",
        enabled: true,
        configuredCredentials: ["apiKey"],
        modelPriorities: { "nano-banana-2": 20 },
      },
      {
        providerId: "replicate",
        upstreamId: "replicate",
        enabled: true,
        configuredCredentials: ["apiKey"],
        modelPriorities: { "nano-banana-2": 10 },
      },
    ] satisfies ProviderAccountAvailability[];

    const nanoRoute = resolveModelUpstreamRoute({
      modelCode: "nano-banana-2",
      kind: "image",
      configuredProviders,
    });
    const fluxRoute = resolveModelUpstreamRoute({
      modelCode: "flux-schnell",
      kind: "image",
      configuredProviders,
    });

    expect(nanoRoute?.providerId).toBe("replicate");
    expect(fluxRoute?.providerId).toBe("fal");
  });

  it("uses provider weight before array order for the same model", () => {
    const routes = listModelUpstreamRoutes({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          weight: 10,
          configuredCredentials: ["apiKey"],
        },
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          weight: 90,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(routes.map((route) => `${route.providerId}/${route.upstreamId}`)).toEqual([
      "replicate/replicate",
      "official/openai",
    ]);
  });

  it("does not let an incomplete higher-priority key block a complete key for the same provider", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gpt-image-2",
      kind: "image",
      allowMock: true,
      configuredProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 1,
          configuredCredentials: [],
        },
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 20,
          configuredCredentials: ["apiKey"],
        },
        { providerId: "mock", enabled: true },
      ],
    });

    expect(route).toMatchObject({
      providerId: "replicate",
      upstreamId: "replicate",
      apiShape: "replicate",
      upstreamModel: "openai/gpt-image-2",
    });
  });

  it("does not let a disabled key block an enabled key for the same provider", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-tts",
      kind: "audio",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: false,
          priority: 1,
          configuredCredentials: ["apiKey"],
        },
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
          priority: 20,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "google",
      apiShape: "google-ai-studio",
      upstreamModel: "gemini-3.1-flash-tts-preview",
    });
  });

  it("uses the credential set that satisfies the route when official provider accounts share an upstream", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-tts",
      kind: "audio",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
          priority: 1,
          configuredCredentials: ["vertexCredentials"],
        },
        {
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
          priority: 20,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "google",
      apiShape: "google-ai-studio",
      upstreamModel: "gemini-3.1-flash-tts-preview",
    });
  });

  it("marks a model available when any configured key for its provider satisfies required credentials", () => {
    const entries = listModelCatalogEntries({
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          priority: 1,
          configuredCredentials: [],
        },
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          priority: 20,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    const gptImage = entries.find((entry) => entry.model.id === "gpt-image-2");
    expect(gptImage).toMatchObject({
      tier: "available",
      selectedRoute: {
        providerId: "official",
        upstreamId: "openai",
      },
      missingCredentials: [],
    });
  });

  it("routes KIE provider accounts through the KIE market API shape", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "nano-banana-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "kie",
          upstreamId: "kie",
          configuredCredentials: ["apiKey"],
          weight: 100,
        },
        {
          providerId: "fal",
          upstreamId: "fal",
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "kie",
      upstreamId: "kie",
      upstreamModel: "nano-banana-2",
      apiShape: "kie",
      requiredCredentials: ["apiKey"],
    });
  });

  it("routes Replicate provider accounts through prediction models", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          configuredCredentials: ["apiKey"],
          weight: 100,
        },
        {
          providerId: "official",
          upstreamId: "openai",
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "replicate",
      upstreamId: "replicate",
      upstreamModel: "openai/gpt-image-2",
      apiShape: "replicate",
      requiredCredentials: ["apiKey"],
    });
  });

  it("keeps official provider accounts separate from internal upstream adapters and regions", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "openai",
      region: "global",
      upstreamModel: "gpt-image-2",
    });
  });

  it("classifies model catalog entries by runnable and configured-provider tiers", () => {
    const configuredProviders: ProviderAccountAvailability[] = [
      { providerId: "fal", enabled: true, configuredCredentials: ["apiKey"] },
      { providerId: "official", upstreamId: "openai", enabled: true, configuredCredentials: [] },
    ];

    const entries = listModelCatalogEntries({ configuredProviders });
    const nanoBanana = entries.find((entry) => entry.model.id === "nano-banana-2");
    const gptImage = entries.find((entry) => entry.model.id === "gpt-image-2");

    expect(nanoBanana).toMatchObject({
      tier: "available",
      selectedRoute: {
        providerId: "fal",
        upstreamId: "fal",
      },
    });
    expect(gptImage).toMatchObject({
      tier: "configured-provider",
      missingCredentials: ["apiKey"],
      candidateProviders: ["official"],
    });
  });

  it("does not treat an enabled provider account with omitted credential metadata as ready", () => {
    const entries = listModelCatalogEntries({
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
        },
      ],
    });

    expect(entries.find((entry) => entry.model.id === "gpt-image-2")).toMatchObject({
      tier: "configured-provider",
      selectedRoute: null,
      missingCredentials: ["apiKey"],
      candidateProviders: ["official"],
    });
  });

  it("does not treat an OAuth-backed provider account with omitted OAuth metadata as ready", () => {
    const entries = listModelCatalogEntries({
      configuredProviders: [
        {
          providerId: "jimeng",
          upstreamId: "jimeng",
          enabled: true,
        },
      ],
    });

    expect(entries.find((entry) => entry.model.id === "seedance-2-text")).toMatchObject({
      tier: "configured-provider",
      selectedRoute: null,
      missingOAuth: ["dreamina"],
      candidateProviders: ["jimeng"],
    });
  });
});
