import { describe, expect, it } from "vitest";

import { capability, validateRefs } from "./model-capabilities.js";
import {
  applyModelProviderImplementation,
  listModelUpstreamRoutes,
} from "./model-routing.js";
import {
  MODEL_CARDS,
  ModelProviderImplementationSchema,
  normalizeModelId,
} from "./models.js";

function card(id: string) {
  const value = MODEL_CARDS.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing model card: ${id}`);
  return value;
}

// The case that asserted fal Seedance and Music routes carried first-party plugin projectors is
// gone, along with the projector assertions on the H3 routes below. Those routes named
// `clash.media` and its `fal-*` exports, and all of it was deleted: the plugin had no executor, so
// the fal chain never ran. The routes themselves still ship and are still asserted here.
describe("Seedance and H3 unified model cards", () => {
  it("requires an export for external projector links while allowing same-plugin shorthand", () => {
    const base = {
      providerId: "fal",
      upstreamId: "fal",
      upstreamModel: "example/model",
      apiShape: "fal",
    } as const;
    expect(
      ModelProviderImplementationSchema.safeParse({
        ...base,
        projectorPluginId: "first-party-media",
      }).success,
    ).toBe(false);
    expect(
      ModelProviderImplementationSchema.safeParse({
        ...base,
        projectorExportId: "project",
      }).success,
    ).toBe(true);
    expect(
      ModelProviderImplementationSchema.safeParse({
        ...base,
        projectorPluginId: "first-party-media",
        projectorExportId: "project",
      }).success,
    ).toBe(true);
  });

  it("retains provider-scoped input adaptations in the implementation schema", () => {
    const implementation = ModelProviderImplementationSchema.parse({
      providerId: "minimax",
      upstreamId: "minimax",
      upstreamModel: "MiniMax-H3",
      apiShape: "minimax",
      inputAdaptation: {
        audio: {
          mimeAliases: {
            "audio/mpeg": "audio/mp3",
            "audio/x-wav": "audio/wav",
          },
        },
      },
    });

    expect(implementation.inputAdaptation).toEqual({
      audio: {
        mimeAliases: {
          "audio/mpeg": "audio/mp3",
          "audio/x-wav": "audio/wav",
        },
      },
    });
  });

  it("keeps the FLUX text-to-video model card independent from its other input modes", () => {
    const pureTextVideoCards = MODEL_CARDS.filter((model) => {
      if (model.kind !== "video") return false;
      const input = model.input.inputMode;
      return !input.images && !input.videos && !input.audios && !input.startEnd;
    });

    expect(pureTextVideoCards.map((model) => model.id)).toEqual([
      "flux-3-video",
    ]);
    expect(pureTextVideoCards[0]).not.toHaveProperty("family");
    expect(pureTextVideoCards[0]).not.toHaveProperty("workflow");
    expect(MODEL_CARDS.some((model) => model.id === "veo-3.1-lite")).toBe(
      false,
    );
  });

  it("models Seedance 2.0 text-only as the empty-reference case of one all-purpose-reference card", () => {
    expect(
      MODEL_CARDS.some((candidate) => candidate.id === "seedance-2-text"),
    ).toBe(false);
    expect(normalizeModelId("seedance-2-text")).toBe("seedance-2-ref");

    const model = card("seedance-2-ref");
    expect(model.name).toContain("全能参考");
    expect(model.provider).toBe("ByteDance");
    expect(capability(model).requiresAnyReferenceOf).toBeUndefined();
    expect(model.input.promptModalities).toEqual([
      "text",
      "image",
      "video",
      "audio",
    ]);
    expect(model.input.inputMode.maxTotalReferences).toBe(15);
    expect(
      validateRefs(
        model,
        { image: 9, video: 3, audio: 3 },
        { prompt: "within the published limit" },
      ),
    ).toBeNull();
    expect(
      validateRefs(
        model,
        { image: 9, video: 3, audio: 4 },
        { prompt: "too many" },
      ),
    ).toMatch(/at most 15 total references/i);
  });

  it("rejects Seedance 2.0 audio-only references before provider submission", () => {
    const model = card("seedance-2-ref");

    expect(
      validateRefs(
        model,
        { audio: 1 },
        { prompt: "Follow the reference rhythm" },
      ),
    ).toMatch(
      /requires at least one reference image or video when reference audio is attached/i,
    );
    expect(
      validateRefs(
        model,
        { image: 1, audio: 1 },
        { prompt: "Follow the reference rhythm" },
      ),
    ).toBeNull();
    expect(
      validateRefs(
        model,
        { video: 1, audio: 1 },
        { prompt: "Follow the reference rhythm" },
      ),
    ).toBeNull();
  });

  it("carries ModelArk's published media envelopes into every Seedance input surface", () => {
    const image = {
      mimeTypes: [
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/bmp",
        "image/tiff",
        "image/gif",
        "image/heic",
        "image/heif",
      ],
      fileExtensions: [
        "jpg",
        "jpeg",
        "png",
        "webp",
        "bmp",
        "tif",
        "tiff",
        "gif",
        "heic",
        "heif",
      ],
      maxBytes: 30 * 1024 * 1024,
      minWidth: 300,
      maxWidth: 6_000,
      minHeight: 300,
      maxHeight: 6_000,
      minAspectRatio: 0.4,
      maxAspectRatio: 2.5,
    };
    const video = (maxDurationMs: number) => ({
      mimeTypes: ["video/mp4", "video/quicktime"],
      fileExtensions: ["mp4", "mov"],
      maxBytes: 200 * 1024 * 1024,
      minDurationMs: 2_000,
      maxDurationMs,
      minFrameRate: 24,
      maxFrameRate: 60,
    });
    const audio = (maxDurationMs: number) => ({
      mimeTypes: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3"],
      fileExtensions: ["wav", "mp3"],
      maxBytes: 15 * 1024 * 1024,
      minDurationMs: 2_000,
      maxDurationMs,
    });

    for (const [version, maxDurationMs] of [
      ["seedance-2", 15_000],
      ["seedance-2.5", 30_000],
    ] as const) {
      const omni = card(`${version}-ref`).input.inputMode;
      expect(omni.images?.constraints).toEqual(image);
      expect(omni.videos?.constraints).toEqual(video(maxDurationMs));
      expect(omni.audios?.constraints).toEqual(audio(maxDurationMs));
      expect(omni.maxEmbeddedRequestBytes).toBe(64 * 1024 * 1024);
      expect(
        card(`${version}-startend`).input.inputMode.startEnd?.constraints,
      ).toEqual(image);
      expect(
        card(`${version}-extend`).input.inputMode.videos?.constraints,
      ).toEqual(video(maxDurationMs));
    }
  });

  it("exposes Seedance 2.5 as all-purpose reference plus a separate first/last-frame card", () => {
    expect(
      MODEL_CARDS.some((candidate) => candidate.id === "seedance-2.5-text"),
    ).toBe(false);
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
    expect(
      validateRefs(omni, { image: 30, video: 10, audio: 10 }, { prompt: "ok" }),
    ).toBeNull();
    expect(
      validateRefs(
        omni,
        { image: 30, video: 10, audio: 11 },
        { prompt: "too many" },
      ),
    ).toMatch(/at most 50 total references/i);
  });

  it("keeps the Seedance 2.5 duration, ratio, and resolution candidates on the shared card", () => {
    const model = card("seedance-2.5-ref");
    const duration = model.parameters.find(
      (parameter) => parameter.id === "duration",
    );
    const ratio = model.parameters.find(
      (parameter) => parameter.id === "aspect_ratio",
    );
    const resolution = model.parameters.find(
      (parameter) => parameter.id === "resolution",
    );

    expect(duration?.options?.map((option) => option.value)).toEqual(
      Array.from({ length: 27 }, (_, index) => index + 4),
    );
    expect(ratio?.options?.map((option) => option.value)).toEqual([
      "1:1",
      "3:4",
      "16:9",
      "4:3",
      "9:16",
      "21:9",
    ]);
    expect(resolution?.options?.map((option) => option.value)).toEqual([
      "480p",
      "720p",
    ]);
  });

  it("models Seedance extension as a video-only continuation card", () => {
    const seedance20 = card("seedance-2-extend");
    const seedance25 = card("seedance-2.5-extend");

    expect(seedance20.input.inputMode).toMatchObject({
      videos: { min: 1, max: 3, maxTotalDurationMs: 15_000 },
      maxTotalReferences: 3,
    });
    expect(seedance25.input.inputMode).toMatchObject({
      videos: { min: 1, max: 10, maxTotalDurationMs: 30_000 },
      maxTotalReferences: 10,
    });
    for (const model of [seedance20, seedance25]) {
      expect(model.input.inputMode.images).toBeUndefined();
      expect(model.input.inputMode.audios).toBeUndefined();
      expect(model.input.presentation).toEqual({ type: "video-continuation" });
      expect(
        validateRefs(model, { video: 0 }, { prompt: "Continue forward" }),
      ).toMatch(/requires at least 1 reference video/i);
      expect(
        validateRefs(
          model,
          { image: 1, video: 1 },
          { prompt: "Continue forward" },
        ),
      ).toMatch(/does not accept reference images/i);
    }
    expect(
      validateRefs(seedance20, { video: 4 }, { prompt: "Bridge the clips" }),
    ).toMatch(/at most 3/i);
    expect(
      validateRefs(seedance25, { video: 10 }, { prompt: "Bridge the clips" }),
    ).toBeNull();
    expect(
      seedance25.parameters.some(
        (parameter) => parameter.id === "output_format",
      ),
    ).toBe(false);
    expect(seedance25.defaultParams).not.toHaveProperty("output_format");
  });

  it("exposes editing as a Volcengine control on the all-purpose cards instead of a duplicate card", () => {
    expect(
      MODEL_CARDS.some((candidate) => candidate.id === "seedance-2-edit"),
    ).toBe(false);
    expect(
      MODEL_CARDS.some((candidate) => candidate.id === "seedance-2.5-edit"),
    ).toBe(false);

    for (const modelId of ["seedance-2-ref", "seedance-2.5-ref"]) {
      const model = card(modelId);
      const [route] = listModelUpstreamRoutes({
        modelCode: modelId,
        kind: "video",
        configuredProviders: [
          {
            providerId: "volcengine",
            upstreamId: "volcengine",
            enabled: true,
            configuredCredentials: ["apiKey"],
          },
        ],
      });
      const effective = applyModelProviderImplementation(model, route);
      expect(effective.parameters).toContainEqual(
        expect.objectContaining({
          id: "edit_mode",
          type: "boolean",
          defaultValue: false,
        }),
      );
      expect(effective.defaultParams.edit_mode).toBe(false);
      if (modelId === "seedance-2-ref") {
        expect(
          effective.parameters
            .find((parameter) => parameter.id === "resolution")
            ?.options?.map((option) => option.value),
        ).toEqual(["480p", "720p", "1080p", "4k"]);
      } else {
        expect(
          effective.parameters
            .find((parameter) => parameter.id === "duration")
            ?.options?.map((option) => option.value),
        ).toEqual([-1, ...Array.from({ length: 27 }, (_, index) => index + 4)]);
        expect(
          effective.parameters
            .find((parameter) => parameter.id === "aspect_ratio")
            ?.options?.map((option) => option.value),
        ).toEqual(["21:9", "16:9", "4:3", "1:1", "3:4", "9:16", "adaptive"]);
        expect(
          effective.parameters
            .find((parameter) => parameter.id === "aspect_ratio")
            ?.options?.find((option) => option.value === "adaptive")?.label,
        ).toBe("Auto");
      }
      expect(
        effective.parameters.some(
          (parameter) => parameter.id === "output_format",
        ),
      ).toBe(false);
      expect(effective.defaultParams).not.toHaveProperty("output_format");
    }
  });

  it("executes every Volcengine Seedance capability through the bundled Provider plugin", () => {
    const configuredProviders = [
      {
        providerId: "volcengine" as const,
        upstreamId: "volcengine" as const,
        enabled: true,
        configuredCredentials: ["apiKey"],
      },
    ];

    for (const modelCode of [
      "seedance-2-ref",
      "seedance-2-startend",
      "seedance-2-extend",
      "seedance-2.5-ref",
      "seedance-2.5-startend",
      "seedance-2.5-extend",
    ]) {
      expect(
        listModelUpstreamRoutes({
          modelCode,
          kind: "video",
          configuredProviders,
        }),
      ).toEqual([
        expect.objectContaining({
          executorPluginId: "clash.volcengine",
          executorExportId: "volcengine-execute",
        }),
      ]);
    }
  });

  it("routes the verified Volcengine Seedance 2.5 implementation without guessed providers", () => {
    const model = card("seedance-2.5-ref");
    expect(model.availableProviders).toEqual(["volcengine"]);

    const routes = listModelUpstreamRoutes({
      modelCode: model.id,
      kind: "video",
      configuredProviders: [
        {
          providerId: "volcengine",
          upstreamId: "volcengine",
          enabled: true,
          configuredCredentials: ["apiKey"],
        },
      ],
    });
    expect(
      routes.map((route) => [route.providerId, route.upstreamModel]),
    ).toEqual([["volcengine", "doubao-seedance-2-5-260628"]]);
    expect(routes[0]?.referenceBinding).toMatchObject({
      type: "positional-tokens",
      tokens: { image: "@图像{n}", video: "@视频{n}", audio: "@音频{n}" },
    });
  });

  it("routes both extension cards to the documented Volcengine model ids", () => {
    const configuredProviders = [
      {
        providerId: "volcengine" as const,
        upstreamId: "volcengine" as const,
        enabled: true,
        configuredCredentials: ["apiKey"],
      },
    ];
    expect(
      listModelUpstreamRoutes({
        modelCode: "seedance-2-extend",
        kind: "video",
        configuredProviders,
      }),
    ).toEqual([
      expect.objectContaining({
        upstreamModel: "doubao-seedance-2-0-260128",
        apiShape: "modelark",
      }),
    ]);
    expect(
      listModelUpstreamRoutes({
        modelCode: "seedance-2.5-extend",
        kind: "video",
        configuredProviders,
      }),
    ).toEqual([
      expect.objectContaining({
        upstreamModel: "doubao-seedance-2-5-260628",
        apiShape: "modelark",
      }),
    ]);
  });

  it("models MiniMax H3 text-only as the empty-reference case of its all-purpose-reference card", () => {
    expect(
      MODEL_CARDS.some((candidate) => candidate.id === "minimax-h3-ref"),
    ).toBe(false);
    expect(normalizeModelId("minimax-h3-ref")).toBe("minimax-h3");

    const model = card("minimax-h3");
    expect(model.name).toContain("全能参考");
    expect(capability(model).requiresAnyReferenceOf).toBeUndefined();
    expect(model.input.referenceBinding).toMatchObject({
      type: "ordered-content-parts",
    });
    expect(card("minimax-h3-startend").input.inputMode.startEnd).toBeDefined();
  });

  it("routes both H3 cards through independent MiniMax, fal, and Pika providers", () => {
    const omni = card("minimax-h3");
    const frames = card("minimax-h3-startend");
    expect(omni.availableProviders).toEqual(["minimax", "fal", "pika"]);
    expect(frames.availableProviders).toEqual(["minimax", "fal", "pika"]);

    const providers = [
      {
        providerId: "minimax" as const,
        upstreamId: "minimax" as const,
        enabled: true,
        configuredCredentials: ["apiKey"],
      },
      {
        providerId: "fal" as const,
        upstreamId: "fal" as const,
        enabled: true,
        configuredCredentials: ["apiKey"],
      },
      {
        providerId: "pika" as const,
        upstreamId: "pika" as const,
        enabled: true,
        configuredCredentials: ["apiKey"],
      },
    ];
    const omniRoutes = listModelUpstreamRoutes({
      modelCode: omni.id,
      kind: "video",
      configuredProviders: providers,
    });
    const frameRoutes = listModelUpstreamRoutes({
      modelCode: frames.id,
      kind: "video",
      configuredProviders: providers,
    });

    expect(omniRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "minimax",
          upstreamModel: "MiniMax-H3",
          apiShape: "minimax",
        }),
        expect.objectContaining({
          providerId: "fal",
          upstreamModel: "minimax/h3/reference-to-video",
          apiShape: "fal",
          defaultParamOverrides: { duration: 5, aspect_ratio: "16:9" },
          parameterOverrides: expect.arrayContaining([
            expect.objectContaining({
              id: "aspect_ratio",
              description: expect.stringMatching(/reference/i),
            }),
          ]),
          referenceBinding: {
            type: "positional-tokens",
            modalityScopedIndexes: true,
            tokens: {
              image: "Image {n}",
              video: "Video {n}",
              audio: "Audio {n}",
            },
          },
        }),
        expect.objectContaining({
          providerId: "pika",
          upstreamModel: "minimax/h3/reference-to-video",
          apiShape: "pika",
          referenceBinding: {
            type: "positional-tokens",
            modalityScopedIndexes: true,
            tokens: {
              image: "@Image{n}",
              video: "@Video{n}",
              audio: "@Audio{n}",
            },
          },
        }),
      ]),
    );
    expect(frameRoutes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "minimax",
          upstreamModel: "MiniMax-H3",
        }),
        expect.objectContaining({
          providerId: "fal",
          upstreamModel: "minimax/h3/image-to-video",
          apiShape: "fal",
        }),
        expect.objectContaining({
          providerId: "pika",
          upstreamModel: "minimax/h3/image-to-video",
          apiShape: "pika",
        }),
      ]),
    );
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
    expect(
      model.parameters
        .find((parameter) => parameter.id === "duration")
        ?.options?.map((option) => option.value),
    ).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
    expect(
      model.parameters
        .find((parameter) => parameter.id === "aspect_ratio")
        ?.options?.map((option) => option.value),
    ).toEqual(["16:9", "9:16"]);
    expect(model.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "resolution",
          readOnly: true,
          defaultValue: "720p",
        }),
        expect.objectContaining({
          id: "frame_rate",
          readOnly: true,
          defaultValue: 24,
        }),
        expect.objectContaining({
          id: "native_audio",
          readOnly: true,
          defaultValue: true,
        }),
      ]),
    );
    expect(model.input.inputMode.videos).toBeUndefined();
    expect(model.input.inputMode.audios).toBeUndefined();

    const route = listModelUpstreamRoutes({
      modelCode: model.id,
      kind: "video",
      configuredProviders: [
        {
          providerId: "official",
          upstreamId: "google-ai-studio",
          enabled: true,
          configuredCredentials: ["serviceAccountKey"],
        },
      ],
    });
    expect(route).toEqual([
      expect.objectContaining({
        apiShape: "google-ai-studio-interactions",
        upstreamModel: "gemini-omni-flash-preview",
      }),
    ]);
  });
});
