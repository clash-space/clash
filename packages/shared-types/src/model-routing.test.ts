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
import { MOCK_MODEL_CARDS, MODEL_CARDS, ModelCardSchema } from "./models";

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

  it("allows model cards to own provider route implementations", () => {
    const parsed = ModelCardSchema.parse({
      id: "gpt-image-2",
      name: "GPT Image 2",
      provider: "OpenAI",
      kind: "image",
      parameters: [],
      defaultParams: {},
      availableProviders: ["official"],
      defaultProvider: "official",
      providerImplementations: [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          upstreamModel: "gpt-image-2",
          apiShape: "openai-images",
          priority: 10,
          requiredCredentials: ["apiKey"],
        },
      ],
    });

    expect((parsed as any).providerImplementations).toEqual([
      {
        providerId: "official",
        upstreamId: "openai",
        region: "global",
        upstreamModel: "gpt-image-2",
        apiShape: "openai-images",
        priority: 10,
        requiredCredentials: ["apiKey"],
      },
    ]);
  });

  it("rejects model cards whose default provider is not one of their implementations", () => {
    expect(() => ModelCardSchema.parse({
      id: "broken-model",
      name: "Broken",
      provider: "Broken Provider",
      kind: "image",
      parameters: [],
      defaultParams: {},
      availableProviders: ["fal"],
    })).toThrow(/defaultProvider/);

    expect(() => ModelCardSchema.parse({
      id: "broken-model",
      name: "Broken",
      provider: "Broken Provider",
      kind: "image",
      parameters: [],
      defaultParams: {},
      availableProviders: ["fal"],
      defaultProvider: "replicate",
    })).toThrow(/defaultProvider/);
  });

  it("keeps every routed model backed by a first-class model card", () => {
    const modelCardIds = new Set([...MODEL_CARDS, ...MOCK_MODEL_CARDS].map((model) => model.id));
    const routedModelIds = [...new Set(MODEL_UPSTREAM_ROUTES.map((route) => route.modelCode))].sort();

    expect(routedModelIds.filter((modelId) => !modelCardIds.has(modelId))).toEqual([]);
  });

  it("exposes first-class mock model cards only when mock routing is enabled", () => {
    const mockModel = MOCK_MODEL_CARDS.find((model) => model.id === "mock-image-model");
    const mockTextModel = MOCK_MODEL_CARDS.find((model) => model.id === "mock-text-model");

    expect(mockModel).toMatchObject({
      id: "mock-image-model",
      name: "Mock Image Model",
      availableProviders: ["mock"],
      defaultProvider: "mock",
      providerImplementations: [
        expect.objectContaining({
          providerId: "mock",
          upstreamId: "mock",
          upstreamModel: "fal-ai/mock-image",
          apiShape: "fal",
        }),
      ],
    });
    expect(mockTextModel).toMatchObject({
      id: "mock-text-model",
      name: "Mock Text Model",
      kind: "text",
      availableProviders: ["mock"],
      defaultProvider: "mock",
      providerImplementations: [
        expect.objectContaining({
          providerId: "mock",
          upstreamId: "mock",
          upstreamModel: "mock/text-completion",
          apiShape: "openai-compatible",
        }),
      ],
    });
    expect(listModelCatalogEntries().some((entry) => entry.model.id === "mock-image-model")).toBe(false);
    expect(listModelCatalogEntries().some((entry) => entry.model.id === "mock-text-model")).toBe(false);

    const mockEntries = listModelCatalogEntries({
      configuredProviders: [{ providerId: "mock", upstreamId: "mock", enabled: true }],
    });
    const entry = mockEntries.find((candidate) => candidate.model.id === "mock-image-model");
    const textEntry = mockEntries.find((candidate) => candidate.model.id === "mock-text-model");

    expect(entry).toMatchObject({
      tier: "available",
      selectedRoute: {
        modelCode: "mock-image-model",
        providerId: "mock",
        upstreamId: "mock",
        upstreamModel: "fal-ai/mock-image",
      },
      candidateProviders: ["mock"],
    });
    expect(textEntry).toMatchObject({
      tier: "available",
      selectedRoute: {
        modelCode: "mock-text-model",
        providerId: "mock",
        upstreamId: "mock",
        upstreamModel: "mock/text-completion",
      },
      candidateProviders: ["mock"],
    });
    const supportedMockModelIds = listProviderModelSupport({ includeMock: true })
      .find((support) => support.providerId === "mock")?.models
      .map((model) => model.id);
    expect(supportedMockModelIds).toContain("mock-image-model");
    expect(supportedMockModelIds).toContain("mock-text-model");
  });

  it("exports model cards after applying schema validation and defaults", () => {
    const cardsMissingPromptDefaults = MODEL_CARDS
      .filter((model) => !model.input.promptModalities?.length)
      .map((model) => model.id);

    expect(cardsMissingPromptDefaults).toEqual([]);
    expect(MODEL_CARDS.map((model) => ModelCardSchema.parse(model).id)).toEqual(MODEL_CARDS.map((model) => model.id));
  });

  it("requires routed model cards to explicitly declare their provider implementations", () => {
    const modelCards = new Map(MODEL_CARDS.map((model) => [model.id, model]));
    const providersByModel = new Map<string, Set<string>>();

    for (const route of MODEL_UPSTREAM_ROUTES) {
      const providerId = route.providerId ?? route.upstreamId;
      if (providerId === "local" || providerId === "mock") continue;
      const providers = providersByModel.get(route.modelCode) ?? new Set<string>();
      providers.add(providerId);
      providersByModel.set(route.modelCode, providers);
    }

    const failures = [...providersByModel.entries()].flatMap(([modelId, providerIds]) => {
      const model = modelCards.get(modelId);
      const declaredProviders = (model?.availableProviders ?? []).map(String);
      const missingProviders = [...providerIds].filter((providerId) => !declaredProviders.includes(providerId));
      const extraProviders = declaredProviders.filter((providerId) => !providerIds.has(providerId));
      const defaultProvider = model?.defaultProvider ? String(model.defaultProvider) : "";
      const routedDefaultProvider = MODEL_UPSTREAM_ROUTES
        .filter((route) => route.modelCode === modelId)
        .map((route) => ({
          providerId: route.providerId ?? route.upstreamId,
          priority: route.priority ?? 1000,
        }))
        .filter((route) => route.providerId !== "local" && route.providerId !== "mock")
        .sort((a, b) => a.priority - b.priority || a.providerId.localeCompare(b.providerId))[0]?.providerId;
      const problems: string[] = [];
      if (!model) problems.push("missing model card");
      if (missingProviders.length > 0) problems.push(`missing providers: ${missingProviders.join(", ")}`);
      if (extraProviders.length > 0) problems.push(`providers without routes: ${extraProviders.join(", ")}`);
      if (!defaultProvider) problems.push("missing defaultProvider");
      else if (!declaredProviders.includes(defaultProvider)) problems.push(`defaultProvider not declared: ${defaultProvider}`);
      else if (routedDefaultProvider && defaultProvider !== routedDefaultProvider) {
        problems.push(`defaultProvider ${defaultProvider} does not match routed default ${routedDefaultProvider}`);
      }
      return problems.length > 0 ? [`${modelId}: ${problems.join("; ")}`] : [];
    }).sort();

    expect(failures).toEqual([]);
  });

  it("builds hosted route table from model card implementations", () => {
    const compactRoute = (route: {
      modelCode: string;
      providerId?: string;
      upstreamId: string;
      region?: string;
      upstreamModel: string;
      apiShape: string;
      priority: number;
      requiredCredentials?: readonly string[];
      requiredOAuth?: readonly string[];
    }) => Object.fromEntries(Object.entries({
      modelCode: route.modelCode,
      providerId: route.providerId,
      upstreamId: route.upstreamId,
      region: route.region,
      upstreamModel: route.upstreamModel,
      apiShape: route.apiShape,
      priority: route.priority,
      requiredCredentials: route.requiredCredentials,
      requiredOAuth: route.requiredOAuth,
    }).filter(([, value]) => value !== undefined));

    const declared = MODEL_CARDS.flatMap((model) =>
      (model.providerImplementations ?? []).map((implementation) => compactRoute({
        modelCode: model.id,
        providerId: implementation.providerId,
        upstreamId: implementation.upstreamId,
        region: implementation.region,
        upstreamModel: implementation.upstreamModel,
        apiShape: implementation.apiShape,
        priority: implementation.priority ?? 100,
        requiredCredentials: implementation.requiredCredentials,
        requiredOAuth: implementation.requiredOAuth,
      })),
    ).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    const hostedRoutes = MODEL_UPSTREAM_ROUTES
      .filter((route) => route.upstreamId !== "mock")
      .map(compactRoute)
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

    expect(hostedRoutes).toEqual(declared);
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
      { upstreamId: "google-agent-platform", enabled: true, configuredCredentials: ["vertexCredentials"] },
    ];

    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-image",
      kind: "image",
      configuredUpstreams: upstreams,
    });

    expect(route).toMatchObject({
      upstreamId: "google-agent-platform",
      upstreamModel: "gemini-3.1-flash-image",
    });
  });

  it("orders fallback candidates by user upstream order before route defaults", () => {
    const routes = listModelUpstreamRoutes({
      modelCode: "gemini-3.1-flash-image",
      kind: "image",
      configuredUpstreams: [
        { upstreamId: "fal", enabled: true, configuredCredentials: ["apiKey"] },
        { upstreamId: "google-agent-platform", enabled: true, configuredCredentials: ["vertexCredentials"] },
      ],
    });

    expect(routes.map((route) => route.upstreamId)).toEqual(["fal", "google-agent-platform"]);
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
      modelCode: "gemini-3.1-flash-image",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "google-ai-studio",
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

  it("indexes provider support from model card implementations", () => {
    const model = ModelCardSchema.parse({
      id: "custom-model",
      name: "Custom Model",
      provider: "Custom",
      kind: "image",
      parameters: [],
      defaultParams: {},
      availableProviders: ["custom"],
      defaultProvider: "custom",
      providerImplementations: [
        {
          providerId: "custom",
          upstreamId: "openai",
          region: "team-a",
          upstreamModel: "team/custom-model",
          apiShape: "openai-compatible",
          priority: 42,
          requiredCredentials: ["apiKey"],
        },
      ],
    });

    expect(listProviderModelSupport({ models: [model] })).toEqual([
      {
        providerId: "custom",
        upstreamId: "openai",
        region: "team-a",
        models: [
          {
            id: "custom-model",
            aliases: [],
            name: "Custom Model",
            kind: "image",
            upstreamModel: "team/custom-model",
            apiShape: "openai-compatible",
            requiredCredentials: ["apiKey"],
            requiredOAuth: [],
          },
        ],
        requiredCredentials: ["apiKey"],
        requiredOAuth: [],
      },
    ]);
  });

  it("separates Google AI Studio from Google Cloud Agent Platform provider accounts", () => {
    const aiStudio = listProviderModelSupport().find((support) =>
      support.providerId === "official" &&
      support.upstreamId === "google-ai-studio" &&
      support.region === "global"
    );
    const agentPlatform = listProviderModelSupport().find((support) =>
      support.providerId === "official" &&
      support.upstreamId === "google-agent-platform" &&
      support.region === "global"
    );
    const aiStudioFlashRoutes = aiStudio?.models.filter((model) => model.id === "nano-banana-2");
    const agentPlatformFlashRoutes = agentPlatform?.models.filter((model) => model.id === "nano-banana-2");

    expect(aiStudioFlashRoutes).toEqual([
      expect.objectContaining({
        apiShape: "google-ai-studio",
        requiredCredentials: ["apiKey"],
        requiredOAuth: [],
      }),
    ]);
    expect(aiStudio?.requiredCredentials).toEqual(["apiKey"]);
    expect(aiStudio?.models.some((model) => model.apiShape === "google-agent-platform")).toBe(false);

    expect(agentPlatformFlashRoutes).toEqual([
      expect.objectContaining({
        apiShape: "google-agent-platform",
        requiredCredentials: ["vertexCredentials"],
        requiredOAuth: [],
      }),
    ]);
    expect(agentPlatform?.requiredCredentials).toEqual(["vertexCredentials"]);
    expect(agentPlatform?.models.some((model) => model.apiShape === "google-ai-studio")).toBe(false);
  });

  it("keeps provider definitions free of per-model support declarations", () => {
    const providersWithModelLists = MODEL_PROVIDER_DEFINITIONS
      .filter((provider) => "supportedModels" in provider)
      .map((provider) => [provider.providerId, provider.upstreamId, provider.region ?? ""].join(":"));

    expect(providersWithModelLists).toEqual([]);
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
      modelCode: "gemini-3.1-flash-image",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
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

  it("normalizes model aliases before applying configured provider scopes and priorities", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-image",
      kind: "image",
      configuredProviders: [
        {
          providerId: "fal",
          upstreamId: "fal",
          enabled: true,
          configuredCredentials: ["apiKey"],
          supportedModelIds: ["gemini-3.1-flash-image"],
          modelPriorities: { "gemini-3.1-flash-image": 20 },
        },
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          configuredCredentials: ["apiKey"],
          supportedModelIds: ["nano-banana-2"],
          modelPriorities: { "nano-banana-2": 10 },
        },
      ],
    });

    expect(route).toMatchObject({
      modelCode: "nano-banana-2",
      providerId: "replicate",
      upstreamId: "replicate",
      upstreamModel: "google/nano-banana-2",
    });
  });

  it("uses a provider model priority even when another key in that provider has higher key priority", () => {
    const routes = listModelUpstreamRoutes({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 1,
          configuredCredentials: ["apiKey"],
        },
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 20,
          configuredCredentials: ["apiKey"],
          modelPriorities: { "gpt-image-2": 10 },
        },
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          priority: 5,
          configuredCredentials: ["apiKey"],
          modelPriorities: { "gpt-image-2": 20 },
        },
      ],
    });

    expect(routes.map((route) => `${route.providerId}/${route.upstreamId}`)).toEqual([
      "replicate/replicate",
      "official/openai",
    ]);
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
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: false,
          priority: 1,
          configuredCredentials: ["apiKey"],
        },
        {
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
          priority: 20,
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "google-ai-studio",
      apiShape: "google-ai-studio",
      upstreamModel: "gemini-3.1-flash-tts-preview",
    });
  });

  it("does not use Google Cloud Agent Platform credentials for Google AI Studio routes", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-tts",
      kind: "audio",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          priority: 1,
          configuredCredentials: ["vertexCredentials"],
        },
      ],
    });

    expect(route).toBeNull();
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

  it("treats Google image model names as aliases for Clash canonical model ids", () => {
    const proRoute = resolveModelUpstreamRoute({
      modelCode: "gemini-3-pro-image",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
        },
      ],
    });
    const fakeProRoute = resolveModelUpstreamRoute({
      modelCode: "not-a-real-google-image-model",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
        },
      ],
    });
    const flashRoute = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-image",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
        },
      ],
    });
    const flashLiteRoute = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-lite-image",
      kind: "image",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          configuredCredentials: ["vertexCredentials"],
        },
      ],
    });

    expect(proRoute).toMatchObject({
      modelCode: "nano-banana-pro",
      upstreamModel: "gemini-3-pro-image",
    });
    expect(fakeProRoute).toBeNull();
    expect(flashRoute).toMatchObject({
      modelCode: "nano-banana-2",
      upstreamModel: "gemini-3.1-flash-image",
    });
    expect(flashLiteRoute).toMatchObject({
      modelCode: "nano-banana-2-lite",
      upstreamModel: "gemini-3.1-flash-lite-image",
    });
  });

  it("routes current Google Agent Platform SOTA text models through official Vertex credentials", () => {
    const configuredProviders: ProviderAccountAvailability[] = [
      {
        providerId: "official",
        upstreamId: "google-agent-platform",
        region: "global",
        enabled: true,
        configuredCredentials: ["vertexCredentials"],
      },
    ];

    expect(
      ["gemini-3.5-flash", "gemini-3.1-pro", "gemini-3-flash", "gemini-3.1-flash-lite"].map((modelCode) =>
        resolveModelUpstreamRoute({
          modelCode,
          kind: "text",
          configuredProviders,
        })
      )
    ).toEqual([
      expect.objectContaining({
        modelCode: "gemini-3.5-flash",
        upstreamId: "google-agent-platform",
        upstreamModel: "gemini-3.5-flash",
        apiShape: "google-agent-platform",
        requiredCredentials: ["vertexCredentials"],
      }),
      expect.objectContaining({
        modelCode: "gemini-3.1-pro",
        upstreamId: "google-agent-platform",
        upstreamModel: "gemini-3.1-pro-preview",
        apiShape: "google-agent-platform",
        requiredCredentials: ["vertexCredentials"],
      }),
      expect.objectContaining({
        modelCode: "gemini-3-flash",
        upstreamId: "google-agent-platform",
        upstreamModel: "gemini-3-flash-preview",
        apiShape: "google-agent-platform",
        requiredCredentials: ["vertexCredentials"],
      }),
      expect.objectContaining({
        modelCode: "gemini-3.1-flash-lite",
        upstreamId: "google-agent-platform",
        upstreamModel: "gemini-3.1-flash-lite",
        apiShape: "google-agent-platform",
        requiredCredentials: ["vertexCredentials"],
      }),
    ]);
  });

  it("lists Clash canonical image models instead of provider model aliases", () => {
    const entries = listModelCatalogEntries();
    const ids = entries.map((entry) => entry.model.id);

    expect(ids).toContain("nano-banana-2");
    expect(ids).toContain("nano-banana-2-lite");
    expect(ids).toContain("nano-banana-pro");
    expect(ids).not.toContain("gemini-3.1-flash-image");
    expect(ids).not.toContain("gemini-3.1-flash-lite-image");
    expect(ids).not.toContain("gemini-3-pro-image");
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
