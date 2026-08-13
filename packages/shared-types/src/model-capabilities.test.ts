/**
 * Tests for the ModelCard → Capability derivation and the three composing
 * functions. The derivation is the load-bearing piece; downstream consumers
 * just read fields, so we mostly test that the derivation handles every
 * flavor of `inputMode` the schema permits.
 */
import { describe, it, expect } from "vitest";
import {
  MODEL_CARDS,
  ModelCardSchema,
  ModelInputModeSchema,
  type ModelCard,
} from "./models.js";
import * as modelCapabilities from "./model-capabilities.js";
import { capability, capabilityFromCustom, validateReferenceMedia, validateRefs, partitionRefs, pickDefaultModel } from "./model-capabilities.js";
import { CustomActionDefinitionSchema } from "./canvas.js";

// ─── Fixtures ────────────────────────────────────────────────────────────

function card(overrides: Partial<ModelCard> & { id: string; kind: ModelCard["kind"] }): ModelCard {
  const { id, kind, ...rest } = overrides;
  return {
    id,
    name: id,
    provider: "test",
    kind,
    parameters: [],
    defaultParams: {},
    defaultAspectRatio: "16:9",
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
    ...rest,
  } as ModelCard;
}

const TEXT_TO_IMAGE = card({ id: "t2i", kind: "image" });
const NANO_BANANA = card({
  id: "nano",
  kind: "image",
  input: { requiresPrompt: true, inputMode: { images: { max: 8 } }, promptModalities: ["text", "image"] },
});
const SORA = card({
  id: "sora",
  kind: "video",
  input: { requiresPrompt: true, inputMode: { images: { max: 1 } }, promptModalities: ["text", "image"] },
});
const MULTIMODAL_REFERENCE_VIDEO = card({
  id: "multimodal-reference-video",
  kind: "video",
  input: {
    requiresPrompt: true,
    inputMode: {
      images: { max: 9 },
      videos: { max: 3 },
      audios: { max: 3, requiresAnyOf: ["image", "video"] },
    },
    promptModalities: ["text", "image", "video", "audio"],
  },
});
const KLING_STARTEND = card({
  id: "kling",
  kind: "video",
  input: { requiresPrompt: true, inputMode: { startEnd: {} }, promptModalities: ["text"] },
});
const STRICT_SINGLE_IMAGE = card({
  id: "strict",
  kind: "video",
  input: { requiresPrompt: true, inputMode: { images: { min: 1, max: 1 } }, promptModalities: ["text"] },
});

// ═══════════════════════════════════════════════════════════════════════
// capability — the single derivation
// ═══════════════════════════════════════════════════════════════════════

describe("capability", () => {
  it("derives exact input bounds from an executable custom Action Card", () => {
    const action = CustomActionDefinitionSchema.parse({
      id: "image-action",
      name: "Image Action",
      outputType: "image",
      input: {
        requiresPrompt: false,
        inputMode: { images: { min: 1, max: 5 } },
        promptModalities: ["image"],
      },
    });

    const cap = capabilityFromCustom(action);

    expect(cap.requiresPrompt).toBe(false);
    expect(cap.ref.image).toMatchObject({ accepts: true, min: 1, max: 5 });
    expect(cap.ref.video.accepts).toBe(false);
  });

  it("preserves cross-modality requirements declared on a reference input", () => {
    expect(ModelInputModeSchema.parse({
      audios: { max: 3, requiresAnyOf: ["image", "video"] },
    }).audios).toMatchObject({ requiresAnyOf: ["image", "video"] });
  });

  it("text-to-image: accepts text refs, media bounds zero", () => {
    const cap = capability(TEXT_TO_IMAGE);
    expect(cap.outputKind).toBe("image");
    expect(cap.requiresPrompt).toBe(true);
    expect(cap.ref.text.accepts).toBe(true);
    expect(cap.ref.image).toEqual({ accepts: false, min: 0, max: 0 });
    expect(cap.ref.video).toEqual({ accepts: false, min: 0, max: 0 });
    expect(cap.ref.audio).toEqual({ accepts: false, min: 0, max: 0 });
  });

  it("multi-image (Nano Banana flavor): images bounds set, others zero", () => {
    const cap = capability(NANO_BANANA);
    expect(cap.ref.image).toEqual({ accepts: true, min: 0, max: 8 });
    expect(cap.ref.video.accepts).toBe(false);
    expect(cap.ref.audio.accepts).toBe(false);
  });

  it("startEnd convention: image bucket is { accepts, min:1, max:2, isStartEnd: true }", () => {
    const cap = capability(KLING_STARTEND);
    expect(cap.ref.image).toEqual({ accepts: true, min: 1, max: 2, isStartEnd: true });
    expect(cap.ref.video.accepts).toBe(false);
  });

  it("multi-modal reference model exposes independent bounds plus audio's companion requirement", () => {
    const cap = capability(MULTIMODAL_REFERENCE_VIDEO);
    expect(cap.ref.image.accepts).toBe(true);
    expect(cap.ref.image.max).toBe(9);
    expect(cap.ref.video).toEqual({ accepts: true, min: 0, max: 3 });
    expect(cap.ref.audio).toEqual({
      accepts: true,
      min: 0,
      max: 3,
      requiresAnyOf: ["image", "video"],
    });
  });

  it("required min image: bounds expose min faithfully", () => {
    const cap = capability(STRICT_SINGLE_IMAGE);
    expect(cap.ref.image).toEqual({ accepts: true, min: 1, max: 1 });
  });

  it("propagates promptModalities and outputKind", () => {
    expect(capability(MULTIMODAL_REFERENCE_VIDEO).promptModalities).toEqual(["text", "image", "video", "audio"]);
    expect(capability(NANO_BANANA).outputKind).toBe("image");
    expect(capability(SORA).outputKind).toBe("video");
  });
});

describe("Director shot reference selection", () => {
  it("prefers revision-pinned per-Shot packets over the sequence preview packet", () => {
    const packet = {
      schemaVersion: 1,
      stageId: "stage-a",
      stageRevisionId: "revision-a",
      exportedAt: "2026-07-24T00:00:00.000Z",
      aspectRatio: "16:9",
      durationSeconds: 2,
      fps: 30,
      cameraIds: ["camera-a"],
      referenceVideo: { assetId: "sequence-video", mimeType: "video/webm" },
      referenceStills: [],
      shotSpec: { shots: [] },
    };
    const shotPacket = {
      ...packet,
      scope: { kind: "shot", selectedShotIds: ["shot-a"] },
      referenceVideo: { assetId: "shot-video", mimeType: "video/webm" },
    };
    const packets = (modelCapabilities as any).directorReferencePackets({
      type: "director-stage",
      data: {
        directorReferencePacket: packet,
        directorShotReferencePackets: [shotPacket],
      },
    });

    expect(packets).toEqual([shotPacket]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// validateRefs — preserves legacy error messages
// ═══════════════════════════════════════════════════════════════════════

describe("validateRefs", () => {
  it("enforces a model-level one-of requirement across reference modalities", () => {
    const omniReference = card({
      id: "omni-reference",
      kind: "video",
      input: {
        requiresPrompt: true,
        inputMode: {
          images: { max: 9 },
          videos: { max: 3 },
          audios: { max: 3, requiresAnyOf: ["image", "video"] },
          requiresAnyOf: ["image", "video"],
        },
        promptModalities: ["text", "image", "video", "audio"],
      },
    } as never);

    expect(validateRefs(omniReference, {}, { prompt: "go" })).toMatch(
      /requires at least one reference image or video/i,
    );
    expect(validateRefs(omniReference, { image: 1 }, { prompt: "go" })).toBeNull();
    expect(validateRefs(omniReference, { video: 1 }, { prompt: "go" })).toBeNull();
  });

  it("rejects constrained reference audio unless a declared companion is attached", () => {
    expect(validateRefs(MULTIMODAL_REFERENCE_VIDEO, { audio: 1 }, { prompt: "go" })).toMatch(
      /requires at least one reference image or video/i,
    );
    expect(validateRefs(MULTIMODAL_REFERENCE_VIDEO, { audio: 1, image: 1 }, { prompt: "go" })).toBeNull();
    expect(validateRefs(MULTIMODAL_REFERENCE_VIDEO, { audio: 1, video: 1 }, { prompt: "go" })).toBeNull();
  });

  it("returns null when everything fits", () => {
    expect(validateRefs(NANO_BANANA, { image: 2 }, { prompt: "go" })).toBeNull();
    expect(validateRefs(MULTIMODAL_REFERENCE_VIDEO, { image: 1, video: 1, audio: 1 }, { prompt: "go" })).toBeNull();
  });

  it("fails empty prompt only when prompt is provided in opts", () => {
    expect(validateRefs(NANO_BANANA, { image: 1 }, { prompt: "  " })).toMatch(/No prompt/);
    // Without opts.prompt, prompt validation is skipped (caller may handle separately).
    expect(validateRefs(NANO_BANANA, { image: 1 })).toBeNull();
  });

  it("rejects refs of an unaccepted modality", () => {
    expect(validateRefs(SORA, { video: 1 }, { prompt: "go" })).toMatch(
      /does not accept reference videos/,
    );
    expect(validateRefs(NANO_BANANA, { audio: 1 }, { prompt: "go" })).toMatch(
      /does not accept reference audio/,
    );
  });

  it("accepts text refs for prompt-capable models", () => {
    expect(validateRefs(TEXT_TO_IMAGE, { text: 1 }, { prompt: "go" })).toBeNull();
  });

  it("startEnd: requires at least 1, allows up to 2", () => {
    expect(validateRefs(KLING_STARTEND, { image: 0 }, { prompt: "go" })).toMatch(/start frame/);
    expect(validateRefs(KLING_STARTEND, { image: 3 }, { prompt: "go" })).toMatch(/at most two/);
    expect(validateRefs(KLING_STARTEND, { image: 1 }, { prompt: "go" })).toBeNull();
    expect(validateRefs(KLING_STARTEND, { image: 2 }, { prompt: "go" })).toBeNull();
  });

  it("min=1: 'requires a reference image' wording for single-required path", () => {
    expect(validateRefs(STRICT_SINGLE_IMAGE, { image: 0 }, { prompt: "go" })).toMatch(
      /requires a reference image/,
    );
  });

  it("max overflow: surfaces the actual got count", () => {
    expect(validateRefs(NANO_BANANA, { image: 12 }, { prompt: "go" })).toMatch(
      /at most 8 reference images \(got 12\)/,
    );
  });

  it("video min/max", () => {
    const v = card({
      id: "v2v-strict",
      kind: "video",
      input: { requiresPrompt: true, inputMode: { videos: { min: 1, max: 2 } }, promptModalities: ["text"] },
    });
    expect(validateRefs(v, { video: 0 }, { prompt: "go" })).toMatch(/at least 1 reference video/);
    expect(validateRefs(v, { video: 5 }, { prompt: "go" })).toMatch(/at most 2 reference video/);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// partitionRefs — drops unaccepted modalities and missing src
// ═══════════════════════════════════════════════════════════════════════

describe("partitionRefs", () => {
  const refs = [
    { type: "image", data: { assetId: "i1" } },
    { type: "image", data: { assetId: "i2" } },
    { type: "video", data: { assetId: "v1" } },
    { type: "audio", data: { assetId: "a1" } },
    { type: "image", data: { assetId: undefined } }, // dropped: no assetId
    { type: "text", data: { content: "story beat" } },
  ];

  it("drops modalities the model doesn't accept", () => {
    const out = partitionRefs(refs, NANO_BANANA);
    expect(out.imageAssetIds).toEqual(["i1", "i2"]);
    expect(out.texts).toEqual(["story beat"]);
    expect(out.videoAssetIds).toEqual([]);
    expect(out.audioAssetIds).toEqual([]);
  });

  it("keeps all accepted modalities", () => {
    const out = partitionRefs(refs, MULTIMODAL_REFERENCE_VIDEO);
    expect(out.imageAssetIds).toEqual(["i1", "i2"]);
    expect(out.texts).toEqual(["story beat"]);
    expect(out.videoAssetIds).toEqual(["v1"]);
    expect(out.audioAssetIds).toEqual(["a1"]);
  });

  it("preserves order within bucket", () => {
    const ordered = [
      { type: "image", data: { assetId: "z" } },
      { type: "image", data: { assetId: "a" } },
      { type: "image", data: { assetId: "m" } },
    ];
    expect(partitionRefs(ordered, NANO_BANANA).imageAssetIds).toEqual(["z", "a", "m"]);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// pickDefaultModel — source-aware default selection
// ═══════════════════════════════════════════════════════════════════════

describe("pickDefaultModel", () => {
  const cards = [TEXT_TO_IMAGE, NANO_BANANA, SORA, MULTIMODAL_REFERENCE_VIDEO];

  it("returns first model of outputKind when no sourceKind given", () => {
    expect(pickDefaultModel({ outputKind: "image", cards })?.id).toBe("t2i");
    expect(pickDefaultModel({ outputKind: "video", cards })?.id).toBe("sora");
  });

  it("video output + video source picks the first compatible injected candidate", () => {
    expect(pickDefaultModel({ outputKind: "video", sourceKind: "video", cards })?.id).toBe("multimodal-reference-video");
  });

  it("video output + image source → first that accepts image (sora)", () => {
    expect(pickDefaultModel({ outputKind: "video", sourceKind: "image", cards })?.id).toBe("sora");
  });

  it("does not pick a model whose audio input requires another missing modality", () => {
    expect(pickDefaultModel({ outputKind: "video", sourceKind: "audio", cards })).toBeUndefined();
  });

  it("returns undefined when no output model accepts the source", () => {
    expect(pickDefaultModel({ outputKind: "image", sourceKind: "video", cards })).toBeUndefined();
  });

  it("text output source is a valid reference source for prompt-capable models", () => {
    expect(pickDefaultModel({ outputKind: "image", sourceKind: "text", cards })?.id).toBe("t2i");
  });

  it("returns undefined when no card matches outputKind at all", () => {
    expect(pickDefaultModel({ outputKind: "audio", cards })).toBeUndefined();
  });

  it("uses Google Gemini TTS as the built-in default audio model", () => {
    const model = pickDefaultModel({ outputKind: "audio", cards: MODEL_CARDS });
    expect(model?.id).toBe("gemini-3.1-flash-tts");
    expect(model?.provider).toBe("Google");
  });
});

describe("compatible model discovery", () => {
  it("returns every compatible candidate from an injected future-model catalog", () => {
    const findCompatibleModels = (modelCapabilities as Record<string, unknown>).findCompatibleModels;
    expect(findCompatibleModels).toBeTypeOf("function");

    const base = TEXT_TO_IMAGE;
    const futureAudioVideoA: ModelCard = {
      ...base,
      id: "future-audio-video-a",
      name: "Future Audio Video A",
      kind: "video",
      input: {
        requiresPrompt: true,
        inputMode: { audios: { max: 1 } },
        promptModalities: ["text", "audio"],
      },
    };
    const futureAudioVideoB: ModelCard = {
      ...futureAudioVideoA,
      id: "future-audio-video-b",
      name: "Future Audio Video B",
    };
    const incompatibleVideo: ModelCard = {
      ...futureAudioVideoA,
      id: "future-image-video",
      name: "Future Image Video",
      input: {
        requiresPrompt: true,
        inputMode: { images: { max: 1 } },
        promptModalities: ["text", "image"],
      },
    };

    const matches = (findCompatibleModels as (opts: unknown) => ModelCard[])({
      outputKind: "video",
      sourceKind: "audio",
      cards: [futureAudioVideoA, incompatibleVideo, futureAudioVideoB, base],
    });

    expect(matches.map((card) => card.id)).toEqual([
      "future-audio-video-a",
      "future-audio-video-b",
    ]);
  });
});

describe("reference media constraints", () => {
  const h3 = MODEL_CARDS.find((candidate) => candidate.id === "minimax-h3")!;

  it("applies parameter-conditioned bounds and media constraints", () => {
    const editCard = ModelCardSchema.parse({
      id: "conditional-video-edit",
      name: "Conditional Video Edit",
      provider: "test",
      kind: "video",
      parameters: [
        {
          id: "edit_mode",
          label: "Edit referenced video",
          type: "boolean",
          defaultValue: false,
        },
      ],
      defaultParams: { edit_mode: false },
      input: {
        inputMode: {
          videos: {
            max: 1,
            constraints: { minDurationMs: 2_000 },
            conditional: [
              {
                when: [{ field: "modelParams.edit_mode", equals: true }],
                min: 1,
                constraints: {
                  minDurationMs: 4_000,
                  minPixels: 407_696,
                },
              },
            ],
          },
        },
      },
    });
    const shortReference = {
      modality: "video" as const,
      contentType: "video/mp4",
      durationMs: 3_000,
      width: 640,
      height: 638,
    };

    expect(
      validateReferenceMedia(editCard, [shortReference], {
        modelParams: { edit_mode: false },
      }),
    ).toBeNull();
    expect(
      validateRefs(
        editCard,
        { video: 0 },
        {
          modelParams: { edit_mode: true },
        },
      ),
    ).toMatch(/at least 1 reference video/i);
    expect(
      validateReferenceMedia(editCard, [shortReference], {
        modelParams: { edit_mode: true },
      }),
    ).toMatch(/at least 4 seconds/i);
    expect(
      validateReferenceMedia(
        editCard,
        [
          {
            ...shortReference,
            durationMs: 4_000,
            width: 640,
            height: 637,
          },
        ],
        { modelParams: { edit_mode: true } },
      ),
    ).toMatch(/407,696 total pixels/i);
    expect(
      validateReferenceMedia(
        editCard,
        [{ ...shortReference, durationMs: 4_000 }],
        { modelParams: { edit_mode: true } },
      ),
    ).toBeNull();
  });

  it("keeps MiniMax H3 media limits in the unified Model Card", () => {
    const parsed = ModelInputModeSchema.parse(h3.input.inputMode);
    expect(parsed.maxTotalReferences).toBe(12);
    expect(parsed.maxEmbeddedRequestBytes).toBe(64 * 1024 * 1024);
    expect(parsed.images?.constraints).toMatchObject({
      maxBytes: 30 * 1024 * 1024,
      minWidth: 256,
      maxWidth: 5760,
      minAspectRatio: 0.4,
      maxAspectRatio: 2.5,
    });
    expect(parsed.videos?.constraints).toMatchObject({
      maxBytes: 50 * 1024 * 1024,
      minDurationMs: 2_000,
      maxDurationMs: 15_000,
      minFrameRate: 23.976,
      maxFrameRate: 60,
    });
    expect(parsed.videos?.maxTotalDurationMs).toBe(15_000);
    expect(parsed.audios?.maxTotalDurationMs).toBe(15_000);
    expect(validateRefs(h3, { image: 9, video: 3, audio: 1 })).toMatch(/at most 12 total references/i);
  });

  it("validates known per-file and aggregate metadata without rejecting unknown metadata", () => {
    expect(validateReferenceMedia(h3, [
      { modality: "image", contentType: "image/gif", bytes: 100, width: 512, height: 512 },
    ])).toMatch(/format/i);
    expect(validateReferenceMedia(h3, [
      { modality: "video", contentType: "video/mp4", durationMs: 16_000, width: 1920, height: 1080, frameRate: 30 },
    ])).toMatch(/15 seconds/i);
    expect(validateReferenceMedia(h3, [
      { modality: "video", contentType: "video/mp4", durationMs: 8_000 },
      { modality: "video", contentType: "video/quicktime", durationMs: 8_000 },
    ])).toMatch(/total duration/i);
    // Spell the mime the way the Card accepts it: this case exercises the byte ceiling,
    // and using a rejected format would report a format error and never reach it.
    expect(validateReferenceMedia(h3, [
      { modality: "audio", contentType: "audio/mp3", bytes: 50 * 1024 * 1024, embedded: true },
    ])).toMatch(/15 MB/i);
    expect(validateReferenceMedia(h3, [
      { modality: "image" },
    ])).toBeNull();
  });

  it("enforces H3 reference-audio formats, duration, and visual companion", () => {
    expect(validateRefs(h3, { audio: 1 }, { prompt: "go" })).toMatch(
      /requires at least one reference image or video/i,
    );
    expect(validateRefs(h3, { image: 1, audio: 1 }, { prompt: "go" })).toBeNull();

    expect(validateReferenceMedia(h3, [{
      modality: "audio",
      contentType: "audio/wav",
      durationMs: 2_000,
    }])).toBeNull();
    expect(validateReferenceMedia(h3, [{
      modality: "audio",
      contentType: "audio/mpeg",
      durationMs: 15_000,
    }])).toBeNull();
    expect(validateReferenceMedia(h3, [{
      modality: "audio",
      contentType: "audio/mp4",
      durationMs: 2_000,
    }])).toMatch(/format/i);
    expect(validateReferenceMedia(h3, [{
      modality: "audio",
      contentType: "audio/wav",
      durationMs: 1_999,
    }])).toMatch(/at least 2 seconds/i);
    expect(validateReferenceMedia(h3, [{
      modality: "audio",
      contentType: "audio/wav",
      durationMs: 15_001,
    }])).toMatch(/at most 15 seconds/i);
  });
});
