/**
 * Tests for the ModelCard → Capability derivation and the three composing
 * functions. The derivation is the load-bearing piece; downstream consumers
 * just read fields, so we mostly test that the derivation handles every
 * flavor of `inputMode` the schema permits.
 */
import { describe, it, expect } from "vitest";
import { MODEL_CARDS, type ModelCard } from "./models";
import { capability, validateRefs, partitionRefs, pickDefaultModel } from "./model-capabilities";

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
const SEEDANCE_REF = card({
  id: "seedance-ref",
  kind: "video",
  input: {
    requiresPrompt: true,
    inputMode: { images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } },
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

  it("multi-modal (Seedance ref): all three modalities accepted independently", () => {
    const cap = capability(SEEDANCE_REF);
    expect(cap.ref.image.accepts).toBe(true);
    expect(cap.ref.image.max).toBe(9);
    expect(cap.ref.video).toEqual({ accepts: true, min: 0, max: 3 });
    expect(cap.ref.audio).toEqual({ accepts: true, min: 0, max: 3 });
  });

  it("required min image: bounds expose min faithfully", () => {
    const cap = capability(STRICT_SINGLE_IMAGE);
    expect(cap.ref.image).toEqual({ accepts: true, min: 1, max: 1 });
  });

  it("propagates promptModalities and outputKind", () => {
    expect(capability(SEEDANCE_REF).promptModalities).toEqual(["text", "image", "video", "audio"]);
    expect(capability(NANO_BANANA).outputKind).toBe("image");
    expect(capability(SORA).outputKind).toBe("video");
  });
});

// ═══════════════════════════════════════════════════════════════════════
// validateRefs — preserves legacy error messages
// ═══════════════════════════════════════════════════════════════════════

describe("validateRefs", () => {
  it("returns null when everything fits", () => {
    expect(validateRefs(NANO_BANANA, { image: 2 }, { prompt: "go" })).toBeNull();
    expect(validateRefs(SEEDANCE_REF, { image: 1, video: 1, audio: 1 }, { prompt: "go" })).toBeNull();
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
    const out = partitionRefs(refs, SEEDANCE_REF);
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
  const cards = [TEXT_TO_IMAGE, NANO_BANANA, SORA, SEEDANCE_REF];

  it("returns first model of outputKind when no sourceKind given", () => {
    expect(pickDefaultModel({ outputKind: "image", cards })?.id).toBe("t2i");
    expect(pickDefaultModel({ outputKind: "video", cards })?.id).toBe("sora");
  });

  it("video output + video source → seedance-ref (only one that accepts video)", () => {
    expect(pickDefaultModel({ outputKind: "video", sourceKind: "video", cards })?.id).toBe("seedance-ref");
  });

  it("video output + image source → first that accepts image (sora)", () => {
    expect(pickDefaultModel({ outputKind: "video", sourceKind: "image", cards })?.id).toBe("sora");
  });

  it("falls back to first matching outputKind when nothing accepts the source", () => {
    // Image output, but no image model in this list accepts video → fall back to t2i
    expect(pickDefaultModel({ outputKind: "image", sourceKind: "video", cards })?.id).toBe("t2i");
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
