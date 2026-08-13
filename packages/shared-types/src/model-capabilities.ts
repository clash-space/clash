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

export type Modality = "text" | "image" | "video" | "audio";

export function isReferenceModality(value: unknown): value is Modality {
  return (
    value === "text" ||
    value === "image" ||
    value === "video" ||
    value === "audio"
  );
}

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
  /** Per-modality reference bounds. All four keys always present —
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
}

export type ReferenceMediaConstraints = NonNullable<
  NonNullable<ModelInputMode["images"]>["constraints"]
>;

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
      maxTotalDurationMs: im.images.maxTotalDurationMs,
    };
  } else {
    image = NO_BOUND;
  }

  const video: RefBound = im.videos
    ? {
        accepts: true,
        min: im.videos.min ?? 0,
        max: im.videos.max,
        requiresAnyOf: im.videos.requiresAnyOf,
        constraints: im.videos.constraints,
        maxTotalDurationMs: im.videos.maxTotalDurationMs,
      }
    : NO_BOUND;

  const audio: RefBound = im.audios
    ? {
        accepts: true,
        min: im.audios.min ?? 0,
        max: im.audios.max,
        requiresAnyOf: im.audios.requiresAnyOf,
        constraints: im.audios.constraints,
        maxTotalDurationMs: im.audios.maxTotalDurationMs,
      }
    : NO_BOUND;
  const text: RefBound = promptModalities.includes("text")
    ? { accepts: true, min: 0, max: Number.MAX_SAFE_INTEGER }
    : NO_BOUND;

  return {
    outputKind: card.kind as "image" | "video" | "audio" | "text",
    requiresPrompt,
    ref: { text, image, video, audio },
    requiresAnyReferenceOf: im.requiresAnyOf,
    maxTotalReferences: im.maxTotalReferences,
    maxEmbeddedRequestBytes: im.maxEmbeddedRequestBytes,
    promptModalities,
    referenceBinding: card.input.referenceBinding,
  };
}

function mediaLabel(modality: ReferenceMediaMetadata["modality"]): string {
  return `Reference ${modality}`;
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
): string | null {
  const cap: Capability =
    typeof (cardOrCap as Capability).requiresPrompt === "boolean"
      ? (cardOrCap as Capability)
      : capability(cardOrCap as ModelCard);

  for (const reference of references) {
    const constraints = cap.ref[reference.modality].constraints;
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

  for (const modality of ["image", "video", "audio"] as const) {
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
  return capability({ kind: def.outputType, input } as ModelCard);
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
  counts: { text?: number; image?: number; video?: number; audio?: number },
  opts: { prompt?: string; enforceMinimums?: boolean } = {},
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

  const imgCount = counts.image ?? 0;
  const vidCount = counts.video ?? 0;
  const audCount = counts.audio ?? 0;
  const textCount = counts.text ?? 0;
  const countsByModality: Record<Modality, number> = {
    text: textCount,
    image: imgCount,
    video: vidCount,
    audio: audCount,
  };

  const totalMediaReferences = imgCount + vidCount + audCount;
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

  if (textCount > 0 && !cap.ref.text.accepts) {
    return "Selected model does not accept reference text.";
  }
  if (imgCount > 0 && !cap.ref.image.accepts) {
    return "Selected model does not accept reference images.";
  }
  if (vidCount > 0 && !cap.ref.video.accepts) {
    return "Selected model does not accept reference videos.";
  }
  if (audCount > 0 && !cap.ref.audio.accepts) {
    return "Selected model does not accept reference audio.";
  }

  for (const modality of ["image", "video", "audio"] as const) {
    const required = cap.ref[modality].requiresAnyOf;
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

  if (cap.ref.image.isStartEnd) {
    if (enforceMinimums && imgCount < 1) {
      return "Selected model needs a start frame. Attach one via @-mention in the prompt.";
    }
    if (imgCount > 2) {
      return "Selected model uses at most two frames (start + optional end).";
    }
  } else if (cap.ref.image.accepts) {
    const { min, max } = cap.ref.image;
    if (enforceMinimums && imgCount < min) {
      return min === 1
        ? "Selected model requires a reference image. Attach one via @-mention in the prompt."
        : `Selected model requires at least ${min} reference images.`;
    }
    if (imgCount > max) {
      return `Selected model accepts at most ${max} reference images (got ${imgCount}).`;
    }
  }

  if (cap.ref.video.accepts) {
    const { min, max } = cap.ref.video;
    if (enforceMinimums && vidCount < min)
      return `Selected model requires at least ${min} reference video(s).`;
    if (vidCount > max) {
      return `Selected model accepts at most ${max} reference video(s) (got ${vidCount}).`;
    }
  }
  if (cap.ref.audio.accepts) {
    const { min, max } = cap.ref.audio;
    if (enforceMinimums && audCount < min)
      return `Selected model requires at least ${min} reference audio clip(s).`;
    if (audCount > max) {
      return `Selected model accepts at most ${max} reference audio clip(s) (got ${audCount}).`;
    }
  }
  if (cap.ref.text.accepts) {
    const { min, max } = cap.ref.text;
    if (enforceMinimums && textCount < min)
      return `Selected model requires at least ${min} reference text node(s).`;
    if (textCount > max) {
      return `Selected model accepts at most ${max} reference text node(s) (got ${textCount}).`;
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

export interface RefPartition {
  /** Text refs: full content strings, inlined into the prompt. */
  texts: string[];
  /** Image refs: stable Project Asset ids. The Host resolves Resource projections. */
  imageAssetIds: string[];
  /** Video refs: stable Project Asset ids. */
  videoAssetIds: string[];
  /** Audio refs: stable Project Asset ids. */
  audioAssetIds: string[];
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
    node.type === "image" ||
    node.type === "video" ||
    node.type === "audio"
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
  if (node.type !== "director-stage") return [];
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
  };
  for (const n of refs) {
    if (n.type === "director-stage") {
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
    if (modality === "image" && cap.ref.image.accepts) {
      out.imageAssetIds.push(aid);
    } else if (modality === "video" && cap.ref.video.accepts) {
      out.videoAssetIds.push(aid);
    } else if (modality === "audio" && cap.ref.audio.accepts) {
      out.audioAssetIds.push(aid);
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
