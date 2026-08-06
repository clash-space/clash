import { describe, expect, it } from "vitest";

import { capability, validateRefs } from "./model-capabilities";
import { listModelUpstreamRoutes } from "./model-routing";
import { MODEL_CARDS, ModelProviderImplementationSchema, normalizeModelId } from "./models";

function card(id: string) {
  const value = MODEL_CARDS.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing model card: ${id}`);
  return value;
}

describe("Seedance and H3 unified model cards", () => {
  it("requires an export for external projector links while allowing same-plugin shorthand", () => {
    const base = {
      providerId: "fal",
      upstreamId: "fal",
      upstreamModel: "example/model",
      apiShape: "fal",
    } as const;
    expect(ModelProviderImplementationSchema.safeParse({
      ...base,
      projectorPluginId: "first-party-media",
    }).success).toBe(false);
    expect(ModelProviderImplementationSchema.safeParse({
      ...base,
      projectorExportId: "project",
    }).success).toBe(true);
    expect(ModelProviderImplementationSchema.safeParse({
      ...base,
      projectorPluginId: "first-party-media",
      projectorExportId: "project",
    }).success).toBe(true);
  });

  it("keeps the FLUX text-to-video model card independent from its other input modes", () => {
    const pureTextVideoCards = MODEL_CARDS.filter((model) => {
      if (model.kind !== "video") return false;
      const input = model.input.inputMode;
      return !input.images && !input.videos && !input.audios && !input.startEnd;
    });

    expect(pureTextVideoCards.map((model) => model.id)).toEqual(["flux-3-video"]);
    expect(pureTextVideoCards[0]).not.toHaveProperty("family");
    expect(pureTextVideoCards[0]).not.toHaveProperty("workflow");
    expect(MODEL_CARDS.some((model) => model.id === "veo-3.1-lite")).toBe(false);
  });

  it("models Seedance 2.0 text-only as the empty-reference case of one all-purpose-reference card", () => {
    expect(MODEL_CARDS.some((candidate) => candidate.id === "seedance-2-text")).toBe(false);
    expect(normalizeModelId("seedance-2-text")).toBe("seedance-2-ref");

    const model = card("seedance-2-ref");
    expect(model.name).toContain("全能参考");
    expect(model.provider).toBe("ByteDance");
    expect(capability(model).requiresAnyReferenceOf).toBeUndefined();
    expect(model.input.promptModalities).toEqual(["text", "image", "video", "audio"]);
    expect(model.input.inputMode.maxTotalReferences).toBe(12);
    expect(validateRefs(model, { image: 9, video: 3, audio: 1 }, { prompt: "too many" }))
      .toMatch(/at most 12 total references/i);
  });

  it("exposes Seedance 2.5 as all-purpose reference plus a separate first/last-frame card", () => {
    expect(MODEL_CARDS.some((candidate) => candidate.id === "seedance-2.5-text")).toBe(false);
    const omni = card("seedance-2.5-ref");
    const frames = card("seedance-2.5-startend");

    expect(omni.name).toContain("全能参考");
    expect(capability(omni).requiresAnyReferenceOf).toBeUndefined();
    expect(omni.input.inputMode).toMatchObject({
      images: { max: 30 },
      videos: {
        max: 10,
        constraints: { minDurationMs: 2_000, maxDurationMs: 30_000 },
        maxTotalDurationMs: 30_000,
      },
      audios: {
        max: 10,
        constraints: { minDurationMs: 2_000, maxDurationMs: 30_000 },
        maxTotalDurationMs: 30_000,
      },
      maxTotalReferences: 50,
    });
    expect(frames.input.inputMode.startEnd).toBeDefined();
    expect(frames.input.inputMode.images).toBeUndefined();
    expect(validateRefs(omni, { image: 30, video: 10, audio: 10 }, { prompt: "ok" })).toBeNull();
    expect(validateRefs(omni, { image: 30, video: 10, audio: 11 }, { prompt: "too many" }))
      .toMatch(/at most 50 total references/i);
  });

  it("publishes every user-configurable Dreamina Seedance 2.5 duration, ratio, and resolution candidate", () => {
    const model = card("seedance-2.5-ref");
    const duration = model.parameters.find((parameter) => parameter.id === "duration");
    const ratio = model.parameters.find((parameter) => parameter.id === "aspect_ratio");
    const resolution = model.parameters.find((parameter) => parameter.id === "resolution");

    expect(duration?.options?.map((option) => option.value)).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 4),
    );
    expect(ratio?.options?.map((option) => option.value)).toEqual([
      "1:1", "3:4", "16:9", "4:3", "9:16", "21:9",
    ]);
    expect(resolution?.options?.map((option) => option.value)).toEqual(["480p", "720p"]);
  });

  it("routes the verified Dreamina and Volcengine Seedance 2.5 implementations without guessed providers", () => {
    const model = card("seedance-2.5-ref");
    expect(model.availableProviders).toEqual(["jimeng", "volcengine"]);

    const routes = listModelUpstreamRoutes({
      modelCode: model.id,
      kind: "video",
      configuredProviders: [
        { providerId: "jimeng", upstreamId: "jimeng", enabled: true, availableOAuth: ["dreamina"] },
        { providerId: "volcengine", upstreamId: "volcengine", enabled: true, configuredCredentials: ["apiKey"] },
      ],
    });
    expect(routes.map((route) => [route.providerId, route.upstreamModel])).toEqual([
      ["jimeng", "seedance2.5"],
      ["volcengine", "doubao-seedance-2-5"],
    ]);
    expect(routes[0]?.referenceBinding).toEqual({ type: "grouped-references" });
    expect(routes[1]?.referenceBinding).toMatchObject({
      type: "positional-tokens",
      tokens: { image: "[Image {n}]", video: "[Video {n}]", audio: "[Audio {n}]" },
    });
  });

  it("models MiniMax H3 text-only as the empty-reference case of its all-purpose-reference card", () => {
    expect(MODEL_CARDS.some((candidate) => candidate.id === "minimax-h3-ref")).toBe(false);
    expect(normalizeModelId("minimax-h3-ref")).toBe("minimax-h3");

    const model = card("minimax-h3");
    expect(model.name).toContain("全能参考");
    expect(capability(model).requiresAnyReferenceOf).toBeUndefined();
    expect(model.input.referenceBinding).toMatchObject({ type: "ordered-content-parts" });
    expect(card("minimax-h3-startend").input.inputMode.startEnd).toBeDefined();
  });

  it("routes both H3 cards through independent MiniMax, fal, and Pika providers", () => {
    const omni = card("minimax-h3");
    const frames = card("minimax-h3-startend");
    expect(omni.availableProviders).toEqual(["minimax", "fal", "pika"]);
    expect(frames.availableProviders).toEqual(["minimax", "fal", "pika"]);

    const providers = [
      { providerId: "minimax" as const, upstreamId: "minimax" as const, enabled: true, configuredCredentials: ["apiKey"] },
      { providerId: "fal" as const, upstreamId: "fal" as const, enabled: true, configuredCredentials: ["apiKey"] },
      { providerId: "pika" as const, upstreamId: "pika" as const, enabled: true, configuredCredentials: ["apiKey"] },
    ];
    const omniRoutes = listModelUpstreamRoutes({ modelCode: omni.id, kind: "video", configuredProviders: providers });
    const frameRoutes = listModelUpstreamRoutes({ modelCode: frames.id, kind: "video", configuredProviders: providers });

    expect(omniRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "minimax", upstreamModel: "MiniMax-H3", apiShape: "minimax" }),
      expect.objectContaining({
        providerId: "fal",
        upstreamModel: "minimax/h3/reference-to-video",
        apiShape: "fal",
        projectorPluginId: "clash-first-party-media",
        projectorExportId: "fal-h3",
        defaultParamOverrides: { duration: 5, aspect_ratio: "16:9" },
        parameterOverrides: expect.arrayContaining([
          expect.objectContaining({ id: "aspect_ratio", description: expect.stringMatching(/reference/i) }),
        ]),
        referenceBinding: {
          type: "positional-tokens",
          modalityScopedIndexes: true,
          tokens: { image: "Image {n}", video: "Video {n}", audio: "Audio {n}" },
        },
      }),
      expect.objectContaining({
        providerId: "pika",
        upstreamModel: "minimax/h3/reference-to-video",
        apiShape: "pika",
        referenceBinding: {
          type: "positional-tokens",
          modalityScopedIndexes: true,
          tokens: { image: "@Image{n}", video: "@Video{n}", audio: "@Audio{n}" },
        },
      }),
    ]));
    expect(frameRoutes).toEqual(expect.arrayContaining([
      expect.objectContaining({ providerId: "minimax", upstreamModel: "MiniMax-H3" }),
      expect.objectContaining({ providerId: "fal", upstreamModel: "minimax/h3/image-to-video", apiShape: "fal" }),
      expect.objectContaining({ providerId: "pika", upstreamModel: "minimax/h3/image-to-video", apiShape: "pika" }),
    ]));
    expect(omni.providerImplementations?.find((implementation) => implementation.providerId === "fal")?.projectorExportId)
      .toBe("fal-h3");
    expect(omni.providerImplementations?.find((implementation) => implementation.providerId === "fal")?.projectorPluginId)
      .toBe("clash-first-party-media");
    expect(frames.providerImplementations?.find((implementation) => implementation.providerId === "fal")?.projectorExportId)
      .toBe("fal-h3");
  });

  it("links fal Seedance and Music routes to first-party plugin projectors", () => {
    for (const modelId of ["seedance-2-ref", "seedance-2-startend"]) {
      expect(card(modelId).providerImplementations
        ?.find((implementation) => implementation.providerId === "fal")?.projectorExportId)
        .toBe("fal-seedance-2");
      expect(card(modelId).providerImplementations
        ?.find((implementation) => implementation.providerId === "fal")?.projectorPluginId)
        .toBe("clash-first-party-media");
    }
    expect(card("minimax-music-3").providerImplementations
      ?.find((implementation) => implementation.providerId === "fal")?.projectorExportId)
      .toBe("fal-minimax-music-3");
  });

  it("publishes Gemini Omni Flash as one optional-reference card without unsupported inputs", () => {
    const model = card("gemini-omni-flash");

    expect(model).toMatchObject({
      name: "Gemini Omni Flash",
      kind: "video",
      availableProviders: ["official"],
      defaultProvider: "official",
      input: {
        promptModalities: ["text", "image"],
        referenceBinding: { type: "ordered-content-parts" },
        inputMode: {
          images: { max: 6 },
        },
      },
    });
    expect(model.parameters.find((parameter) => parameter.id === "duration")?.options?.map((option) => option.value))
      .toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(model.parameters.find((parameter) => parameter.id === "aspect_ratio")?.options?.map((option) => option.value))
      .toEqual(["16:9", "9:16"]);
    expect(model.parameters).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "resolution", readOnly: true, defaultValue: "720p" }),
      expect.objectContaining({ id: "frame_rate", readOnly: true, defaultValue: 24 }),
      expect.objectContaining({ id: "native_audio", readOnly: true, defaultValue: true }),
    ]));
    expect(model.input.inputMode.videos).toBeUndefined();
    expect(model.input.inputMode.audios).toBeUndefined();

    const route = listModelUpstreamRoutes({
      modelCode: model.id,
      kind: "video",
      configuredProviders: [{
        providerId: "official",
        upstreamId: "google-ai-studio",
        enabled: true,
        configuredCredentials: ["apiKey"],
      }],
    });
    expect(route).toEqual([
      expect.objectContaining({
        apiShape: "google-ai-studio-interactions",
        upstreamModel: "gemini-omni-flash-preview",
      }),
    ]);
  });
});
