import { describe, expect, it } from "vitest";

import {
  listModelCatalogEntries,
  listModelUpstreamRoutes,
  resolveModelUpstreamRoute,
  type ProviderAccountAvailability,
  type UpstreamAvailability,
} from "./model-routing";

describe("model upstream routing", () => {
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
      { upstreamId: "fal", enabled: true, availableVariables: [] },
      { upstreamId: "google", enabled: true, availableVariables: ["GOOGLE_VERTEX"] },
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
        { upstreamId: "fal", enabled: true, availableVariables: ["FAL_API_KEY"] },
        { upstreamId: "google", enabled: true, availableVariables: ["GOOGLE_VERTEX"] },
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

  it("routes GPT Image 2 to the OpenAI image upstream with variables", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gpt-image-2",
      kind: "image",
      configuredUpstreams: [
        { upstreamId: "openai", enabled: true, availableVariables: ["OPENAI_API_KEY"] },
      ],
    });

    expect(route).toMatchObject({
      modelCode: "gpt-image-2",
      upstreamId: "openai",
      upstreamModel: "gpt-image-2",
      apiShape: "openai-images",
      requiredVariables: ["OPENAI_API_KEY"],
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
          availableVariables: ["GOOGLE_API_KEY"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "official",
      upstreamId: "google",
      upstreamModel: "gemini-3.1-flash-image",
      apiShape: "google-ai-studio",
      requiredVariables: ["GOOGLE_API_KEY"],
    });
  });

  it("routes Minimax TTS to fal when the fal key is configured", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "minimax-tts",
      kind: "audio",
      configuredUpstreams: [
        { upstreamId: "fal", enabled: true, availableVariables: ["FAL_API_KEY"] },
      ],
    });

    expect(route).toMatchObject({
      modelCode: "minimax-tts",
      upstreamId: "fal",
      upstreamModel: "fal-ai/minimax/speech-02-hd",
      apiShape: "fal",
      requiredVariables: ["FAL_API_KEY"],
    });
  });

  it("falls back Gemini TTS model codes to fal when only the fal key is configured", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "gemini-3.1-flash-tts",
      kind: "audio",
      configuredUpstreams: [
        { upstreamId: "fal", enabled: true, availableVariables: ["FAL_API_KEY"] },
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
          availableVariables: ["GOOGLE_VERTEX"],
          weight: 10,
        },
        {
          providerId: "fal",
          enabled: true,
          availableVariables: ["FAL_API_KEY"],
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

  it("routes KIE provider accounts through the KIE market API shape", () => {
    const route = resolveModelUpstreamRoute({
      modelCode: "nano-banana-2",
      kind: "image",
      configuredProviders: [
        {
          providerId: "kie",
          upstreamId: "kie",
          availableVariables: ["KIE_API_KEY"],
          weight: 100,
        },
        {
          providerId: "fal",
          upstreamId: "fal",
          availableVariables: ["FAL_API_KEY"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "kie",
      upstreamId: "kie",
      upstreamModel: "nano-banana-2",
      apiShape: "kie",
      requiredVariables: ["KIE_API_KEY"],
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
          availableVariables: ["REPLICATE_API_TOKEN"],
          weight: 100,
        },
        {
          providerId: "official",
          upstreamId: "openai",
          availableVariables: ["OPENAI_API_KEY"],
        },
      ],
    });

    expect(route).toMatchObject({
      providerId: "replicate",
      upstreamId: "replicate",
      upstreamModel: "openai/gpt-image-2",
      apiShape: "replicate",
      requiredVariables: ["REPLICATE_API_TOKEN"],
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
          availableVariables: ["OPENAI_API_KEY"],
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
      { providerId: "fal", enabled: true, availableVariables: ["FAL_API_KEY"] },
      { providerId: "official", upstreamId: "openai", enabled: true, availableVariables: [] },
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
      missingVariables: ["OPENAI_API_KEY"],
      candidateProviders: ["official"],
    });
  });
});
