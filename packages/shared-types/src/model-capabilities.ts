/**
 * Model capability — single derivation, all consumers read fields.
 *
 * Before this module, every consumer reached into `card.input.inputMode` and
 * decided things like "does this accept video?" or "what's the image limit?"
 * inline, with subtle drift across files (startEnd → image, min defaulting,
 * count limits). Each new feature added another inline expression.
 *
 * Now: one function `capability(card)` produces a normalized profile. Every
 * consumer reads `cap.ref.video.accepts` / `cap.ref.image.max` directly. The
 * other exports (`validateRefs`, `partitionRefs`, `findCompatibleModels`,
 * `pickDefaultModel`)
 * compose on top of `capability` and replace what would otherwise be a
 * sprawling utils module.
 */

import type { AigcActionKind } from "./actions.js";
import type { ModelCard, ModelInputMode } from "./models.js";
import { normalizePromptInput } from "./prompt.js";
import type { CustomActionDefinition } from "./canvas.js";
import {
  DirectorReferencePacketSchema,
  type DirectorReferencePacket,
} from "./director-reference.js";

/**
 * The single hand-authored runtime registry for every non-text reference
 * modality. Adding a modality (image / video / audio / model today) means
 * adding exactly **one** entry to this array — nothing else. `Modality`,
 * `MediaReferenceModality`, `MEDIA_REFERENCE_MODALITIES`, `RefPartition`'s
 * bucket fields, and every loop in this module that iterates modalities all
 * derive their shape and values from this one array's entries instead of
 * repeating the modality list by hand a second time.
 */
export interface MediaReferenceFieldDescriptor<
  Modality extends string = string,
  PartitionField extends string = string,
> {
  modality: Modality;
  /** Field on Canvas node `data` / `BuildPendingAssetNodeInput` carrying this
   *  modality's Project Asset ids, e.g. `referenceModelAssetIds`. */
  pendingField: `reference${string}AssetIds`;
  /** Field on `RefPartition` carrying this modality's Project Asset ids,
   *  e.g. `modelAssetIds`. */
  partitionField: PartitionField;
  /** Stable human label used in `validateReferenceMedia` error messages,
   *  e.g. "Reference image". */
  label: string;
  /** Plain plural noun for "Selected model does not accept reference ___."
   *  These are irregular by design (English is irregular) — "audio" has no
   *  plural, the rest do. */
  pluralNoun: string;
  /** Count-sensitive noun for "requires at least N ___" / "accepts at most
   *  N ___ (got X)". Distinct from `pluralNoun` because English pluralizes
   *  these differently in a counted phrase ("video(s)", "audio clip(s)",
   *  "model(s)") than in the plain "does not accept" phrasing. */
  countNoun: string;
}

/**
 * The registry. This `as const` array literal is the *only* hand-authored
 * list of media reference modalities in this module — `MediaReferenceModality`,
 * `MEDIA_REFERENCE_MODALITIES`, and `RefPartition`'s bucket fields are all
 * type-level or value-level derivations of it below, so a new modality is a
 * one-entry addition here rather than a change in two (or more) places. This
 * is exactly the gap that let `referenceModelAssetIds` silently go missing
 * from `validateGenerationInput` / `buildPendingAssetNode` /
 * `buildGenerationPayload` while `RefPartition.modelAssetIds` already
 * existed — every helper that iterates the registry (`validateRefs`,
 * `partitionRefs`, `referenceModality`, `mediaReferencePendingFields`,
 * `mediaReferenceCounts`) now picks a new entry up automatically.
 */
export const MEDIA_REFERENCE_FIELDS = [
  {
    modality: "image",
    pendingField: "referenceImageAssetIds",
    partitionField: "imageAssetIds",
    label: "Reference image",
    pluralNoun: "images",
    countNoun: "images",
  },
  {
    modality: "video",
    pendingField: "referenceVideoAssetIds",
    partitionField: "videoAssetIds",
    label: "Reference video",
    pluralNoun: "videos",
    countNoun: "video(s)",
  },
  {
    modality: "audio",
    pendingField: "referenceAudioAssetIds",
    partitionField: "audioAssetIds",
    label: "Reference audio",
    pluralNoun: "audio",
    countNoun: "audio clip(s)",
  },
  {
    modality: "model",
    pendingField: "referenceModelAssetIds",
    partitionField: "modelAssetIds",
    label: "Reference model",
    pluralNoun: "models",
    countNoun: "model(s)",
  },
] as const satisfies readonly MediaReferenceFieldDescriptor[];

/** Reference asset id fields (`referenceImageAssetIds`, etc.), derived from
 *  the registry's `pendingField` values rather than declared by hand.
 *  Consumers (`ValidateGenerationInput`, `BuildPendingAssetNodeInput`)
 *  extend this instead of repeating one optional `string[]` property per
 *  modality — a new registry entry adds its field to both automatically. */
export type MediaReferencePendingFields = {
  [Field in (typeof MEDIA_REFERENCE_FIELDS)[number] as Field["pendingField"]]?: string[];
};

/** Every non-text reference modality, derived from the registry's `modality`
 *  values — not declared as a second list. */
export type MediaReferenceModality =
  (typeof MEDIA_REFERENCE_FIELDS)[number]["modality"];

export type Modality = "text" | MediaReferenceModality;

/** Value-level modality list, derived by mapping the registry rather than
 *  declared by hand. */
export const MEDIA_REFERENCE_MODALITIES: readonly MediaReferenceModality[] =
  MEDIA_REFERENCE_FIELDS.map((field) => field.modality);

function isMediaReferenceModality(
  value: unknown,
): value is MediaReferenceModality {
  return (MEDIA_REFERENCE_MODALITIES as readonly unknown[]).includes(value);
}

export function isReferenceModality(value: unknown): value is Modality {
  return value === "text" || isMediaReferenceModality(value);
}

/** `RefPartition`'s media buckets are a mapped type over the registry's
 *  `partitionField` values (`imageAssetIds`, `videoAssetIds`,
 *  `audioAssetIds`, `modelAssetIds` today), so a new registry entry adds its
 *  bucket field here automatically instead of needing a matching hand-written
 *  property. */
export type RefPartition = {
  /** Text refs: full content strings, inlined into the prompt. */
  texts: string[];
} & {
  /** Media refs (image / video / audio / model): stable Project Asset ids,
   *  one bucket per registered modality. The Host resolves Resource
   *  projections. */
  [Field in (typeof MEDIA_REFERENCE_FIELDS)[number]["partitionField"]]: string[];
};

/** Concrete instantiation of `MediaReferenceFieldDescriptor` used by every
 *  registry consumer in this module. */
export type MediaReferenceField = MediaReferenceFieldDescriptor<
  MediaReferenceModality,
  keyof Omit<RefPartition, "texts">
>;

export interface RefBound {
  /** Model accepts this modality as a reference at all. */
  accepts: boolean;
  /** Minimum required (0 if optional). */
  min: number;
  /** Maximum allowed. */
  max: number;
  /** If this ref is present, at least one listed companion modality is required. */
  requiresAnyOf?: ReadonlyArray<Modality>;
  constraints?: ReferenceMediaConstraints;
  conditional?: ReadonlyArray<ConditionalReferenceRule>;
  maxTotalDurationMs?: number;
  /** True iff the image bucket is satisfied via the start/end frame
   *  convention (start required, end optional). */
  isStartEnd?: boolean;
}

export interface Capability {
  /** Output modality of the model itself (kind of asset it generates). */
  outputKind: AigcActionKind;
  /** Whether a non-empty prompt is required. */
  requiresPrompt: boolean;
  /** Per-modality reference bounds. All five keys always present —
   *  unaccepted modalities have `accepts: false, min: 0, max: 0`. */
  ref: Record<Modality, RefBound>;
  /** At least one reference from these modalities must be attached. */
  requiresAnyReferenceOf?: ReadonlyArray<Exclude<Modality, "text">>;
  maxTotalReferences?: number;
  maxEmbeddedRequestBytes?: number;
  /** Modalities that can be inline @-mentioned in the prompt editor. */
  promptModalities: ReadonlyArray<Modality>;
  /** Provider binding used when serializing inline references. */
  referenceBinding?: ModelCard["input"]["referenceBinding"];
  /** Parameter defaults used when evaluating conditional input rules. */
  defaultModelParams?: Readonly<Record<string, string | number | boolean>>;
}

export type ReferenceMediaConstraints = NonNullable<
  NonNullable<ModelInputMode["images"]>["constraints"]
>;

export type ConditionalReferenceRule = NonNullable<
  NonNullable<ModelInputMode["images"]>["conditional"]
>[number];

export interface ReferenceMediaMetadata {
  modality: Exclude<Modality, "text">;
  contentType?: string;
  fileName?: string;
  bytes?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  frameRate?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** True when the adapter will embed this file as a Base64 Data URI. */
  embedded?: boolean;
}

const NO_BOUND: RefBound = { accepts: false, min: 0, max: 0 };

/** Video, audio, and model buckets share one shape (only `image` has the
 *  start/end-frame exception), so their `RefBound` is built once here
 *  instead of three near-identical object literals in `capability()`. */
function refBoundFromSpec(
  spec: NonNullable<ModelInputMode["videos" | "audios" | "models"]> | undefined,
): RefBound {
  return spec
    ? {
        accepts: true,
        min: spec.min ?? 0,
        max: spec.max,
        requiresAnyOf: spec.requiresAnyOf,
        constraints: spec.constraints,
        conditional: spec.conditional,
        maxTotalDurationMs: spec.maxTotalDurationMs,
      }
    : NO_BOUND;
}

/**
 * The single derivation for built-in models. Cheap; safe to call in
 * render hot paths or memoize with `useMemo(() => capability(card), [card])`.
 *
 * For custom (marketplace) actions, use `capabilityFromCustom(def)` —
 * both produce the same `Capability` shape so downstream helpers
 * (`partitionRefs`, `validateRefs`, `buildGenerationPayload`,
 * `useSpawnPendingAsset`) operate uniformly on either config kind.
 */
export function capability(card: ModelCard): Capability {
  const im = card.input.inputMode;
  const requiresPrompt = card.input.requiresPrompt ?? true;
  const promptModalities = (card.input.promptModalities ?? [
    "text",
  ]) as Capability["promptModalities"];

  // Image bucket: startEnd takes precedence (a real model would set one or
  // the other, never both — schema doesn't enforce, so we pick a winner).
  let image: RefBound;
  if (im.startEnd) {
    image = {
      accepts: true,
      min: 1,
      max: 2,
      isStartEnd: true,
      constraints: im.startEnd.constraints,
    };
  } else if (im.images) {
    image = {
      accepts: true,
      min: im.images.min ?? 0,
      max: im.images.max,
      requiresAnyOf: im.images.requiresAnyOf,
      constraints: im.images.constraints,
      conditional: im.images.conditional,
      maxTotalDurationMs: im.images.maxTotalDurationMs,
    };
  } else {
    image = NO_BOUND;
  }

  const video: RefBound = refBoundFromSpec(im.videos);
  const audio: RefBound = refBoundFromSpec(im.audios);
  const model: RefBound = refBoundFromSpec(im.models);
  const text: RefBound = promptModalities.includes("text")
    ? { accepts: true, min: 0, max: Number.MAX_SAFE_INTEGER }
    : NO_BOUND;

  return {
    outputKind: card.kind,
    requiresPrompt,
    ref: { text, image, video, audio, model },
    requiresAnyReferenceOf: im.requiresAnyOf,
    maxTotalReferences: im.maxTotalReferences,
    maxEmbeddedRequestBytes: im.maxEmbeddedRequestBytes,
    promptModalities,
    referenceBinding: card.input.referenceBinding,
    defaultModelParams: card.defaultParams,
  };
}

export interface ReferenceValidationOptions {
  modelParams?: Readonly<Record<string, string | number | boolean | undefined>>;
}

function conditionalRuleApplies(
  cap: Capability,
  rule: ConditionalReferenceRule,
  modelParams: ReferenceValidationOptions["modelParams"],
): boolean {
  return rule.when.every((condition) => {
    const parameterId = condition.field.slice("modelParams.".length);
    const value =
      modelParams?.[parameterId] ?? cap.defaultModelParams?.[parameterId];
    return value === condition.equals;
  });
}

function effectiveRefBound(
  cap: Capability,
  modality: Modality,
  modelParams: ReferenceValidationOptions["modelParams"],
): RefBound {
  const base = cap.ref[modality];
  let min = base.min;
  let max = base.max;
  let constraints = base.constraints;
  for (const rule of base.conditional ?? []) {
    if (!conditionalRuleApplies(cap, rule, modelParams)) continue;
    min = rule.min ?? min;
    max = rule.max ?? max;
    if (rule.constraints) {
      constraints = { ...constraints, ...rule.constraints };
    }
  }
  return { ...base, min, max, constraints };
}

const MEDIA_REFERENCE_FIELD_BY_MODALITY: Readonly<
  Record<MediaReferenceModality, MediaReferenceField>
> = Object.fromEntries(
  MEDIA_REFERENCE_FIELDS.map(
    (field): [MediaReferenceModality, MediaReferenceField] => [
      field.modality,
      field,
    ],
  ),
) as Record<MediaReferenceModality, MediaReferenceField>;

function mediaLabel(modality: ReferenceMediaMetadata["modality"]): string {
  return MEDIA_REFERENCE_FIELD_BY_MODALITY[modality].label;
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function normalizedExtension(fileName: string | undefined): string | undefined {
  const match = fileName?.toLowerCase().match(/\.([a-z0-9]+)(?:[?#].*)?$/);
  return match?.[1];
}

/** Validate metadata that is already known. Missing probe fields are left to
 * the provider, so legacy/public-URL references remain usable. */
export function validateReferenceMedia(
  cardOrCap: ModelCard | Capability,
  references: ReadonlyArray<ReferenceMediaMetadata>,
  options: ReferenceValidationOptions = {},
): string | null {
  const cap: Capability =
    typeof (cardOrCap as Capability).requiresPrompt === "boolean"
      ? (cardOrCap as Capability)
      : capability(cardOrCap as ModelCard);

  for (const reference of references) {
    const constraints = effectiveRefBound(
      cap,
      reference.modality,
      options.modelParams,
    ).constraints;
    if (!constraints) continue;
    const label = mediaLabel(reference.modality);
    const contentType = reference.contentType
      ?.toLowerCase()
      .split(";", 1)[0]
      ?.trim();
    const extension = normalizedExtension(reference.fileName);
    const hasFormatEvidence = !!contentType || !!extension;
    const mimeMatches =
      !!contentType && !!constraints.mimeTypes?.includes(contentType);
    const extensionMatches =
      !!extension && !!constraints.fileExtensions?.includes(extension);
    if (
      hasFormatEvidence &&
      (constraints.mimeTypes?.length || constraints.fileExtensions?.length) &&
      !mimeMatches &&
      !extensionMatches
    ) {
      return `${label} format is not supported by the selected model.`;
    }
    if (
      reference.bytes != null &&
      constraints.maxBytes != null &&
      reference.bytes > constraints.maxBytes
    ) {
      return `${label} must be no larger than ${megabytes(constraints.maxBytes)}.`;
    }
    if (
      reference.width != null &&
      constraints.minWidth != null &&
      reference.width < constraints.minWidth
    ) {
      return `${label} width must be at least ${constraints.minWidth}px.`;
    }
    if (
      reference.width != null &&
      constraints.maxWidth != null &&
      reference.width > constraints.maxWidth
    ) {
      return `${label} width must be at most ${constraints.maxWidth}px.`;
    }
    if (
      reference.height != null &&
      constraints.minHeight != null &&
      reference.height < constraints.minHeight
    ) {
      return `${label} height must be at least ${constraints.minHeight}px.`;
    }
    if (
      reference.height != null &&
      constraints.maxHeight != null &&
      reference.height > constraints.maxHeight
    ) {
      return `${label} height must be at most ${constraints.maxHeight}px.`;
    }
    if (reference.width != null && reference.height != null) {
      const pixels = reference.width * reference.height;
      if (constraints.minPixels != null && pixels < constraints.minPixels) {
        return `${label} must contain at least ${constraints.minPixels.toLocaleString("en-US")} total pixels (width × height).`;
      }
      if (constraints.maxPixels != null && pixels > constraints.maxPixels) {
        return `${label} must contain at most ${constraints.maxPixels.toLocaleString("en-US")} total pixels (width × height).`;
      }
    }
    if (
      reference.width != null &&
      reference.height != null &&
      reference.height > 0
    ) {
      const ratio = reference.width / reference.height;
      if (
        constraints.minAspectRatio != null &&
        ratio < constraints.minAspectRatio
      ) {
        return `${label} aspect ratio must be at least ${constraints.minAspectRatio}.`;
      }
      if (
        constraints.maxAspectRatio != null &&
        ratio > constraints.maxAspectRatio
      ) {
        return `${label} aspect ratio must be at most ${constraints.maxAspectRatio}.`;
      }
    }
    if (
      reference.durationMs != null &&
      constraints.minDurationMs != null &&
      reference.durationMs < constraints.minDurationMs
    ) {
      return `${label} duration must be at least ${constraints.minDurationMs / 1000} seconds.`;
    }
    if (
      reference.durationMs != null &&
      constraints.maxDurationMs != null &&
      reference.durationMs > constraints.maxDurationMs
    ) {
      return `${label} duration must be at most ${constraints.maxDurationMs / 1000} seconds.`;
    }
    if (
      reference.frameRate != null &&
      constraints.minFrameRate != null &&
      reference.frameRate < constraints.minFrameRate
    ) {
      return `${label} frame rate must be at least ${constraints.minFrameRate} fps.`;
    }
    if (
      reference.frameRate != null &&
      constraints.maxFrameRate != null &&
      reference.frameRate > constraints.maxFrameRate
    ) {
      return `${label} frame rate must be at most ${constraints.maxFrameRate} fps.`;
    }
    const videoCodec = reference.videoCodec?.toLowerCase();
    if (
      videoCodec &&
      constraints.videoCodecs?.length &&
      !constraints.videoCodecs.includes(videoCodec)
    ) {
      return `${label} video codec is not supported by the selected model.`;
    }
    const audioCodec = reference.audioCodec?.toLowerCase();
    if (
      audioCodec &&
      constraints.audioCodecs?.length &&
      !constraints.audioCodecs.includes(audioCodec)
    ) {
      return `${label} audio codec is not supported by the selected model.`;
    }
  }

  for (const modality of MEDIA_REFERENCE_MODALITIES) {
    const maxTotalDurationMs = cap.ref[modality].maxTotalDurationMs;
    if (maxTotalDurationMs == null) continue;
    const knownTotal = references
      .filter((reference) => reference.modality === modality)
      .reduce((total, reference) => total + (reference.durationMs ?? 0), 0);
    if (knownTotal > maxTotalDurationMs) {
      return `Reference ${modality} total duration must be at most ${maxTotalDurationMs / 1000} seconds.`;
    }
  }

  if (cap.maxEmbeddedRequestBytes != null) {
    const embeddedBytes = references.reduce((total, reference) => {
      if (!reference.embedded || reference.bytes == null) return total;
      return total + Math.ceil(reference.bytes / 3) * 4;
    }, 0);
    if (embeddedBytes > cap.maxEmbeddedRequestBytes) {
      return `Embedded reference media must keep the request body within ${megabytes(cap.maxEmbeddedRequestBytes)}.`;
    }
  }
  return null;
}

/**
 * Action Cards reuse the Model Card input contract, so custom actions derive
 * their capability through the exact same normalization path and preserve
 * counts, start/end semantics, media constraints, and reference binding.
 */
export function capabilityFromCustom(def: CustomActionDefinition): Capability {
  // Canvas documents created before Action Cards adopted the full Model Card
  // input contract can still contain the legacy promptModalities-only shape.
  // Normalize it at the read boundary so old projects keep executing while
  // newly installed actions retain their exact declared bounds.
  const promptModalities = def.input?.promptModalities ??
    def.promptModalities ?? ["text"];
  const input = def.input ?? {
    requiresPrompt: promptModalities.includes("text"),
    // Legacy custom actions predate the `model` modality, so this fallback
    // deliberately stays scoped to image/video/audio rather than iterating
    // `MEDIA_REFERENCE_MODALITIES` — a marketplace action manifest has never
    // been able to declare `promptModalities: ['model']` through this path.
    inputMode: Object.fromEntries(
      (["image", "video", "audio"] as const)
        .filter((modality) => promptModalities.includes(modality))
        .map((modality) => [
          modality === "image"
            ? "images"
            : modality === "video"
              ? "videos"
              : "audios",
          { max: Number.MAX_SAFE_INTEGER },
        ]),
    ),
    promptModalities,
  };
  const defaultModelParams = Object.fromEntries(
    def.parameters.flatMap((parameter) =>
      parameter.defaultValue === undefined
        ? []
        : [[parameter.id, parameter.defaultValue]],
    ),
  );
  return capability({
    kind: def.outputType,
    input,
    defaultParams: defaultModelParams,
  } as ModelCard);
}

/** Plain plural noun for "Selected model does not accept reference ___." and
 *  count-sensitive noun for "requires at least N ___" / "accepts at most N
 *  ___ (got X)" — both derived from the single `MEDIA_REFERENCE_FIELDS`
 *  registry entry per modality rather than authored as separate lookup
 *  tables. */
const MEDIA_REFERENCE_PLURAL_NOUN: Record<MediaReferenceModality, string> =
  Object.fromEntries(
    MEDIA_REFERENCE_FIELDS.map((field) => [field.modality, field.pluralNoun]),
  ) as Record<MediaReferenceModality, string>;

const MEDIA_REFERENCE_COUNT_NOUN: Record<MediaReferenceModality, string> =
  Object.fromEntries(
    MEDIA_REFERENCE_FIELDS.map((field) => [field.modality, field.countNoun]),
  ) as Record<MediaReferenceModality, string>;

/** Shared min/max bound check for one media modality, used by every modality
 *  except `image` when it is in its start/end-frame form (that variant has
 *  its own distinct copy and is validated separately in `validateRefs`).
 *  `image`'s ordinary (non start/end) case still special-cases `min === 1`
 *  to keep the "Attach one via @-mention" copy the image affordance has
 *  always had. */
function mediaBoundError(
  modality: MediaReferenceModality,
  bound: RefBound,
  count: number,
  enforceMinimums: boolean,
): string | null {
  if (!bound.accepts) return null;
  const { min, max } = bound;
  if (enforceMinimums && count < min) {
    if (modality === "image" && min === 1) {
      return "Selected model requires a reference image. Attach one via @-mention in the prompt.";
    }
    return `Selected model requires at least ${min} reference ${MEDIA_REFERENCE_COUNT_NOUN[modality]}.`;
  }
  if (count > max) {
    return `Selected model accepts at most ${max} reference ${MEDIA_REFERENCE_COUNT_NOUN[modality]} (got ${count}).`;
  }
  return null;
}

/**
 * Validate ref counts (and optionally a prompt) against the model's bounds.
 * Returns the first violation message, or `null` if everything checks out.
 *
 * Replaces the inline `validateGenerationInput`. Error strings match the
 * legacy ones so tests / UI copy don't shift unexpectedly.
 */
export function validateRefs(
  cardOrCap: ModelCard | Capability,
  counts: Partial<Record<Modality, number>>,
  opts: {
    prompt?: string;
    enforceMinimums?: boolean;
    modelParams?: ReferenceValidationOptions["modelParams"];
  } = {},
): string | null {
  // Accept either a card (legacy callers) or a pre-derived capability
  // (the new path for custom actions). Detection: capabilities have a
  // `requiresPrompt` boolean at the root; ModelCards don't.
  const cap: Capability =
    typeof (cardOrCap as Capability).requiresPrompt === "boolean"
      ? (cardOrCap as Capability)
      : capability(cardOrCap as ModelCard);

  if (cap.requiresPrompt && opts.prompt !== undefined) {
    if (!opts.prompt || !opts.prompt.trim()) return "No prompt provided.";
  }

  const countsByModality: Record<Modality, number> = {
    text: counts.text ?? 0,
    ...(Object.fromEntries(
      MEDIA_REFERENCE_MODALITIES.map((modality) => [modality, counts[modality] ?? 0]),
    ) as Record<MediaReferenceModality, number>),
  };
  const ref: Record<Modality, RefBound> = {
    text: effectiveRefBound(cap, "text", opts.modelParams),
    ...(Object.fromEntries(
      MEDIA_REFERENCE_MODALITIES.map((modality) => [
        modality,
        effectiveRefBound(cap, modality, opts.modelParams),
      ]),
    ) as Record<MediaReferenceModality, RefBound>),
  };

  const totalMediaReferences = MEDIA_REFERENCE_MODALITIES.reduce(
    (total, modality) => total + countsByModality[modality],
    0,
  );
  if (
    cap.maxTotalReferences != null &&
    totalMediaReferences > cap.maxTotalReferences
  ) {
    return `Selected model accepts at most ${cap.maxTotalReferences} total references (got ${totalMediaReferences}).`;
  }

  const requiredReferenceModalities = cap.requiresAnyReferenceOf;
  if (
    requiredReferenceModalities?.length &&
    !requiredReferenceModalities.some(
      (modality) => countsByModality[modality] > 0,
    )
  ) {
    const requirement =
      requiredReferenceModalities.length === 1
        ? `reference ${requiredReferenceModalities[0]}`
        : `reference ${requiredReferenceModalities.slice(0, -1).join(", ")} or ${requiredReferenceModalities[requiredReferenceModalities.length - 1]}`;
    return `Selected model requires at least one ${requirement}.`;
  }

  if (countsByModality.text > 0 && !ref.text.accepts) {
    return "Selected model does not accept reference text.";
  }
  for (const modality of MEDIA_REFERENCE_MODALITIES) {
    if (countsByModality[modality] > 0 && !ref[modality].accepts) {
      return `Selected model does not accept reference ${MEDIA_REFERENCE_PLURAL_NOUN[modality]}.`;
    }
  }

  for (const modality of MEDIA_REFERENCE_MODALITIES) {
    const required = ref[modality].requiresAnyOf;
    if (countsByModality[modality] === 0 || !required?.length) continue;
    if (!required.some((companion) => countsByModality[companion] > 0)) {
      const requirement =
        required.length === 1
          ? `reference ${required[0]}`
          : `reference ${required.slice(0, -1).join(", ")} or ${required[required.length - 1]}`;
      return `Selected model requires at least one ${requirement} when reference ${modality} is attached.`;
    }
  }

  const enforceMinimums = opts.enforceMinimums ?? true;

  // Image is the one modality with a structural exception (the start/end
  // frame convention), so it is validated on its own before the generic
  // min/max loop runs for every other media modality.
  if (ref.image.isStartEnd) {
    if (enforceMinimums && countsByModality.image < 1) {
      return "Selected model needs a start frame. Attach one via @-mention in the prompt.";
    }
    if (countsByModality.image > 2) {
      return "Selected model uses at most two frames (start + optional end).";
    }
  } else {
    const imageError = mediaBoundError(
      "image",
      ref.image,
      countsByModality.image,
      enforceMinimums,
    );
    if (imageError) return imageError;
  }

  for (const modality of MEDIA_REFERENCE_MODALITIES) {
    if (modality === "image") continue; // handled above
    const error = mediaBoundError(
      modality,
      ref[modality],
      countsByModality[modality],
      enforceMinimums,
    );
    if (error) return error;
  }

  if (ref.text.accepts) {
    const { min, max } = ref.text;
    if (enforceMinimums && countsByModality.text < min)
      return `Selected model requires at least ${min} reference text node(s).`;
    if (countsByModality.text > max) {
      return `Selected model accepts at most ${max} reference text node(s) (got ${countsByModality.text}).`;
    }
  }

  return null;
}

/**
 * Canvas node shape consumed by partitionRefs. Image / video / audio refs
 * are identified by `data.assetId` (the stable Project Asset id); text refs read
 * inlined content. Note: `data.src` is intentionally NOT in this contract —
 * Project Asset identity is the source of truth and the Host resolves Resources.
 */
export interface RefNodeLike {
  type?: string;
  data?: {
    content?: string;
    prompt?: string;
    label?: string;
    assetId?: string;
    outputVideoAssetId?: string;
    directorReferencePacket?: DirectorReferencePacket | unknown;
    directorShotReferencePackets?: ReadonlyArray<
      DirectorReferencePacket | unknown
    >;
  } & Record<string, unknown>;
}

/** Read every modality's asset ids off a `RefPartition` as `[pendingField, ids]`
 *  pairs, skipping empty buckets. Shared by `buildGenerationPayload` (writes
 *  `BuildPendingAssetNodeInput`) and `validateGenerationInput` callers that
 *  want counts instead — use `mediaReferenceCounts` for that. */
export function mediaReferencePendingFields(
  partition: RefPartition,
): Partial<Record<MediaReferenceField["pendingField"], string[]>> {
  const out: Partial<Record<MediaReferenceField["pendingField"], string[]>> = {};
  for (const field of MEDIA_REFERENCE_FIELDS) {
    const ids = partition[field.partitionField];
    if (ids.length > 0) out[field.pendingField] = ids;
  }
  return out;
}

/** Read every modality's reference count off a `RefPartition`, keyed by
 *  modality (`image`, `video`, `audio`, `model`) for `validateRefs`. */
export function mediaReferenceCounts(
  partition: RefPartition,
): Record<MediaReferenceModality, number> {
  const out = {} as Record<MediaReferenceModality, number>;
  for (const field of MEDIA_REFERENCE_FIELDS) {
    out[field.modality] = partition[field.partitionField].length;
  }
  return out;
}

/**
 * Resolve the reference modality exposed by a Canvas node.
 *
 * Director Stage is an editor node rather than a media node, but after an
 * export its source handle represents the latest reference video. Keeping
 * that adapter here lets every generation entry point consume the same graph
 * contract without inserting a synthetic video or Timeline node.
 */
export function referenceModality(node: RefNodeLike): Modality | undefined {
  if (
    node.type === "text" ||
    isMediaReferenceModality(node.type)
  ) {
    return node.type;
  }
  if (node.type === "director-stage") return "video";
  return undefined;
}

/** Return the registered project asset carried by a reference node. */
export function referenceAssetId(node: RefNodeLike): string | undefined {
  const packet =
    node.type === "director-stage"
      ? directorReferencePackets(node)[0]
      : undefined;
  const value =
    node.type === "director-stage"
      ? (packet?.referenceVideo.assetId ?? node.data?.outputVideoAssetId)
      : node.data?.assetId;
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function directorReferencePacket(
  node: RefNodeLike,
): DirectorReferencePacket | undefined {
  return directorReferencePackets(node)[0];
}

export function directorReferencePackets(
  node: RefNodeLike,
): DirectorReferencePacket[] {
  if (node.type !== "director-stage" && node.type !== "video") return [];
  const shotPackets = Array.isArray(node.data?.directorShotReferencePackets)
    ? node.data.directorShotReferencePackets.flatMap((packet) => {
        const parsed = DirectorReferencePacketSchema.safeParse(packet);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  if (shotPackets.length > 0) return shotPackets;
  const parsed = DirectorReferencePacketSchema.safeParse(
    node.data?.directorReferencePacket,
  );
  return parsed.success ? [parsed.data] : [];
}

export function hasDirectorReferenceOutput(node: RefNodeLike): boolean {
  if (node.type !== "director-stage") return false;
  const packet = directorReferencePacket(node);
  if (packet?.referenceVideo.assetId) return true;
  return Boolean(
    typeof node.data?.outputVideoAssetId === "string" &&
    node.data.outputVideoAssetId.trim(),
  );
}

function selectDirectorReferenceStillAssetIds(
  packet: DirectorReferencePacket,
  maximum: number,
): string[] {
  const stills = [...packet.referenceStills].sort(
    (left, right) =>
      (left.timeSeconds ?? 0) - (right.timeSeconds ?? 0) ||
      left.assetId.localeCompare(right.assetId),
  );
  if (stills.length <= maximum) return stills.map((still) => still.assetId);
  if (maximum <= 0) return [];
  if (maximum === 1) return [stills[0]!.assetId];
  const indexes = Array.from({ length: maximum }, (_, index) =>
    Math.round((index * (stills.length - 1)) / (maximum - 1)),
  );
  return [...new Set(indexes.map((index) => stills[index]!.assetId))];
}

/**
 * Split a list of ref nodes into modality buckets the model accepts.
 * Drops nodes whose modality isn't accepted, and image/video/audio nodes
 * without an assetId (drafts / orphans — backend can't resolve them).
 *
 * Order is preserved within each bucket — callers expecting positional
 * semantics (e.g. start/end frames) should pre-sort the input.
 */
export function partitionRefs(
  refs: ReadonlyArray<RefNodeLike>,
  cardOrCap: ModelCard | Capability,
): RefPartition {
  const cap: Capability =
    typeof (cardOrCap as Capability).requiresPrompt === "boolean"
      ? (cardOrCap as Capability)
      : capability(cardOrCap as ModelCard);
  const out: RefPartition = {
    texts: [],
    imageAssetIds: [],
    videoAssetIds: [],
    audioAssetIds: [],
    modelAssetIds: [],
  };
  for (const n of refs) {
    const packet = directorReferencePacket(n);
    if (packet) {
      if (cap.ref.video.accepts) {
        out.videoAssetIds.push(packet.referenceVideo.assetId);
      } else if (cap.ref.image.accepts) {
        out.imageAssetIds.push(
          ...selectDirectorReferenceStillAssetIds(packet, cap.ref.image.max),
        );
      }
      continue;
    }
    const modality = referenceModality(n);
    if (modality === "text" && cap.ref.text.accepts) {
      const text = normalizePromptInput(
        n.data?.content ?? n.data?.prompt ?? n.data?.label,
      ).trim();
      if (text) out.texts.push(text);
      continue;
    }
    const aid = referenceAssetId(n);
    if (!aid) continue;
    const field = MEDIA_REFERENCE_FIELD_BY_MODALITY[modality as MediaReferenceModality];
    if (field && cap.ref[field.modality].accepts) {
      out[field.partitionField].push(aid);
    }
  }
  return out;
}

/**
 * Find every candidate that satisfies a downstream generation request.
 * The candidate set is injected deliberately: capability policy is a pure
 * domain rule and must not import the provider/model registry.
 *
 * Returns undefined when no model can consume the source by itself. This
 * keeps downstream menus from creating actions whose only incoming ref is
 * invalid or would be silently discarded.
 */
export function findCompatibleModels(opts: {
  outputKind: AigcActionKind;
  sourceKind?: Modality | string;
  referenceCounts?: Partial<Record<Modality, number>>;
  enforceMinimums?: boolean;
  cards: ReadonlyArray<ModelCard>;
}): ModelCard[] {
  const sameKind = opts.cards.filter((card) => card.kind === opts.outputKind);
  if (opts.referenceCounts) {
    return sameKind.filter(
      (card) =>
        validateRefs(card, opts.referenceCounts!, {
          enforceMinimums: opts.enforceMinimums,
        }) === null,
    );
  }
  if (!opts.sourceKind) return sameKind;
  const sourceKind = opts.sourceKind;
  if (!isReferenceModality(sourceKind)) return sameKind;
  const counts = { [sourceKind]: 1 } as Partial<Record<Modality, number>>;
  return sameKind.filter((card) => validateRefs(card, counts) === null);
}

/** Pick the first result from an injected, already-ordered candidate set. */
export function pickDefaultModel(opts: {
  outputKind: AigcActionKind;
  sourceKind?: Modality | string;
  referenceCounts?: Partial<Record<Modality, number>>;
  enforceMinimums?: boolean;
  cards: ReadonlyArray<ModelCard>;
}): ModelCard | undefined {
  const compatible = findCompatibleModels(opts);

  // An official provider first, whatever the output kind. This used to be an audio-only branch that
  // filtered on `card.task === "text-to-speech"`, from when speech and music were treated as
  // separate actions. They are one action -- producing one class of output is one action, and the
  // difference between speaking and composing is parameters -- so the filter went, and what it was
  // really expressing, a preference for a provider we run ourselves, stayed and now applies
  // everywhere rather than to audio alone.
  return (
    compatible.find((card) => card.availableProviders?.includes("official")) ??
    compatible[0]
  );
}
