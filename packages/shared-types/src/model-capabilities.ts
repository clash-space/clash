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
 * other three exports (`validateRefs`, `partitionRefs`, `pickDefaultModel`)
 * compose on top of `capability` and replace what would otherwise be a
 * sprawling utils module.
 */

import type { ModelCard } from "./models";
import { MODEL_CARDS } from "./models";
import { normalizePromptInput } from "./prompt";

export type Modality = "text" | "image" | "video" | "audio";

export function isReferenceModality(value: unknown): value is Modality {
  return value === "text" || value === "image" || value === "video" || value === "audio";
}

export interface RefBound {
  /** Model accepts this modality as a reference at all. */
  accepts: boolean;
  /** Minimum required (0 if optional). */
  min: number;
  /** Maximum allowed. */
  max: number;
  /** True iff the image bucket is satisfied via the start/end frame
   *  convention (start required, end optional). */
  isStartEnd?: boolean;
}

export interface Capability {
  /** Output modality of the model itself (kind of asset it generates). */
  outputKind: "image" | "video" | "audio" | "text";
  /** Whether a non-empty prompt is required. */
  requiresPrompt: boolean;
  /** Per-modality reference bounds. All four keys always present —
   *  unaccepted modalities have `accepts: false, min: 0, max: 0`. */
  ref: Record<Modality, RefBound>;
  /** Modalities that can be inline @-mentioned in the prompt editor. */
  promptModalities: ReadonlyArray<Modality>;
}

const NO_BOUND: RefBound = { accepts: false, min: 0, max: 0 };

/**
 * The single derivation. Cheap; safe to call in render hot paths or memoize
 * with `useMemo(() => capability(card), [card])`.
 */
export function capability(card: ModelCard): Capability {
  const im = card.input.inputMode;
  const requiresPrompt = card.input.requiresPrompt ?? true;
  const promptModalities = (card.input.promptModalities ?? ["text"]) as Capability["promptModalities"];

  // Image bucket: startEnd takes precedence (a real model would set one or
  // the other, never both — schema doesn't enforce, so we pick a winner).
  let image: RefBound;
  if (im.startEnd) {
    image = { accepts: true, min: 1, max: 2, isStartEnd: true };
  } else if (im.images) {
    image = { accepts: true, min: im.images.min ?? 0, max: im.images.max };
  } else {
    image = NO_BOUND;
  }

  const video: RefBound = im.videos
    ? { accepts: true, min: im.videos.min ?? 0, max: im.videos.max }
    : NO_BOUND;

  const audio: RefBound = im.audios
    ? { accepts: true, min: im.audios.min ?? 0, max: im.audios.max }
    : NO_BOUND;
  const text: RefBound = promptModalities.includes("text")
    ? { accepts: true, min: 0, max: Number.MAX_SAFE_INTEGER }
    : NO_BOUND;

  return {
    outputKind: card.kind as "image" | "video" | "audio" | "text",
    requiresPrompt,
    ref: { text, image, video, audio },
    promptModalities,
  };
}

/**
 * Validate ref counts (and optionally a prompt) against the model's bounds.
 * Returns the first violation message, or `null` if everything checks out.
 *
 * Replaces the inline `validateGenerationInput`. Error strings match the
 * legacy ones so tests / UI copy don't shift unexpectedly.
 */
export function validateRefs(
  card: ModelCard,
  counts: { text?: number; image?: number; video?: number; audio?: number },
  opts: { prompt?: string } = {},
): string | null {
  const cap = capability(card);

  if (cap.requiresPrompt && opts.prompt !== undefined) {
    if (!opts.prompt || !opts.prompt.trim()) return "No prompt provided.";
  }

  const imgCount = counts.image ?? 0;
  const vidCount = counts.video ?? 0;
  const audCount = counts.audio ?? 0;
  const textCount = counts.text ?? 0;

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

  if (cap.ref.image.isStartEnd) {
    if (imgCount < 1) {
      return "Selected model needs a start frame. Attach one via @-mention in the prompt.";
    }
    if (imgCount > 2) {
      return "Selected model uses at most two frames (start + optional end).";
    }
  } else if (cap.ref.image.accepts) {
    const { min, max } = cap.ref.image;
    if (imgCount < min) {
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
    if (vidCount < min) return `Selected model requires at least ${min} reference video(s).`;
    if (vidCount > max) {
      return `Selected model accepts at most ${max} reference video(s) (got ${vidCount}).`;
    }
  }
  if (cap.ref.audio.accepts) {
    const { min, max } = cap.ref.audio;
    if (audCount < min) return `Selected model requires at least ${min} reference audio clip(s).`;
    if (audCount > max) {
      return `Selected model accepts at most ${max} reference audio clip(s) (got ${audCount}).`;
    }
  }
  if (cap.ref.text.accepts) {
    const { min, max } = cap.ref.text;
    if (textCount < min) return `Selected model requires at least ${min} reference text node(s).`;
    if (textCount > max) {
      return `Selected model accepts at most ${max} reference text node(s) (got ${textCount}).`;
    }
  }

  return null;
}

/**
 * Canvas node shape consumed by partitionRefs. Image / video / audio refs
 * are identified by `data.assetId` (the D1 asset row); text refs read
 * inlined content. Note: `data.src` is intentionally NOT in this contract —
 * the asset row is the source of truth and the server resolves R2 keys.
 */
export interface RefNodeLike {
  type?: string;
  data?: { content?: string; prompt?: string; label?: string; assetId?: string } & Record<string, unknown>;
}

export interface RefPartition {
  /** Text refs: full content strings, inlined into the prompt. */
  texts: string[];
  /** Image refs: D1 asset IDs. Server resolves to R2 keys. */
  imageAssetIds: string[];
  /** Video refs: D1 asset IDs. */
  videoAssetIds: string[];
  /** Audio refs: D1 asset IDs. */
  audioAssetIds: string[];
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
  card: ModelCard,
): RefPartition {
  const cap = capability(card);
  const out: RefPartition = {
    texts: [],
    imageAssetIds: [],
    videoAssetIds: [],
    audioAssetIds: [],
  };
  for (const n of refs) {
    if (n.type === "text" && cap.ref.text.accepts) {
      const text = normalizePromptInput(n.data?.content ?? n.data?.prompt ?? n.data?.label).trim();
      if (text) out.texts.push(text);
      continue;
    }
    const aid = typeof n.data?.assetId === 'string' ? n.data.assetId : undefined;
    if (!aid) continue;
    if (n.type === "image" && cap.ref.image.accepts) {
      out.imageAssetIds.push(aid);
    } else if (n.type === "video" && cap.ref.video.accepts) {
      out.videoAssetIds.push(aid);
    } else if (n.type === "audio" && cap.ref.audio.accepts) {
      out.audioAssetIds.push(aid);
    }
  }
  return out;
}

/**
 * Pick a sensible default model for a "spawn downstream action" gesture.
 * If `sourceKind` is given, prefers a model that can also consume that
 * modality as a reference (so the spawn doesn't immediately produce a
 * silently-dropped ref edge).
 *
 * Falls back to the first model of the right `outputKind` if no candidate
 * accepts the source — better to spawn something the user can fix than to
 * spawn nothing.
 */
export function pickDefaultModel(opts: {
  outputKind: "image" | "video" | "audio" | "text";
  sourceKind?: Modality | string;
  cards?: ReadonlyArray<ModelCard>;
}): ModelCard | undefined {
  const cards = opts.cards ?? MODEL_CARDS;
  const sameKind = cards.filter((c) => c.kind === opts.outputKind);
  if (sameKind.length === 0) return undefined;
  if (!opts.sourceKind) return sameKind[0];
  const sourceKind = opts.sourceKind;
  if (!isReferenceModality(sourceKind)) return sameKind[0];
  return sameKind.find((c) => capability(c).ref[sourceKind].accepts) ?? sameKind[0];
}
