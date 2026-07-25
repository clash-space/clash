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

import type { ModelCard } from "./models";
import { normalizePromptInput } from "./prompt";
import type { CustomActionDefinition } from "./canvas";
import {
  DirectorReferencePacketSchema,
  type DirectorReferencePacket,
} from "./director-reference";

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
  /** If this ref is present, at least one listed companion modality is required. */
  requiresAnyOf?: ReadonlyArray<Modality>;
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
  const promptModalities = (card.input.promptModalities ?? ["text"]) as Capability["promptModalities"];

  // Image bucket: startEnd takes precedence (a real model would set one or
  // the other, never both — schema doesn't enforce, so we pick a winner).
  let image: RefBound;
  if (im.startEnd) {
    image = { accepts: true, min: 1, max: 2, isStartEnd: true };
  } else if (im.images) {
    image = {
      accepts: true,
      min: im.images.min ?? 0,
      max: im.images.max,
      requiresAnyOf: im.images.requiresAnyOf,
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
      }
    : NO_BOUND;

  const audio: RefBound = im.audios
    ? {
        accepts: true,
        min: im.audios.min ?? 0,
        max: im.audios.max,
        requiresAnyOf: im.audios.requiresAnyOf,
      }
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
 * Derive a `Capability` from a custom action definition. The mapping
 * mirrors what marketplace actions actually express today:
 *
 *   - `outputKind` from `customDef.outputType` (image / video / audio / text)
 *   - `requiresPrompt` follows the declared text modality. Image-only
 *      / video-only actions can run from canvas refs and parameters
 *      without fabricating a text prompt.
 *   - `ref.X.accepts` from `customDef.promptModalities` (a custom
 *      action declares which asset kinds its prompt editor allows;
 *      same idea as the model card's `inputMode` switches)
 *   - `max` is unbounded — custom action definitions don't carry
 *      per-modality count caps today. If a specific action wants
 *      N=1 image refs, it should validate that itself; the
 *      capability layer just says "yes you can attach images".
 *
 * Keeps shape-parity with `capability(card)` so partitionRefs /
 * validateRefs / buildGenerationPayload can take either without
 * branching.
 */
export function capabilityFromCustom(def: CustomActionDefinition): Capability {
  const accepts = (m: Modality) => def.promptModalities.includes(m);
  const unboundedIf = (ok: boolean): RefBound =>
    ok ? { accepts: true, min: 0, max: Number.MAX_SAFE_INTEGER } : NO_BOUND;

  return {
    outputKind: def.outputType,
    requiresPrompt: def.promptModalities.includes("text"),
    ref: {
      text: unboundedIf(accepts("text")),
      image: unboundedIf(accepts("image")),
      video: unboundedIf(accepts("video")),
      audio: unboundedIf(accepts("audio")),
    },
    promptModalities: def.promptModalities,
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
      const requirement = required.length === 1
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
    if (enforceMinimums && vidCount < min) return `Selected model requires at least ${min} reference video(s).`;
    if (vidCount > max) {
      return `Selected model accepts at most ${max} reference video(s) (got ${vidCount}).`;
    }
  }
  if (cap.ref.audio.accepts) {
    const { min, max } = cap.ref.audio;
    if (enforceMinimums && audCount < min) return `Selected model requires at least ${min} reference audio clip(s).`;
    if (audCount > max) {
      return `Selected model accepts at most ${max} reference audio clip(s) (got ${audCount}).`;
    }
  }
  if (cap.ref.text.accepts) {
    const { min, max } = cap.ref.text;
    if (enforceMinimums && textCount < min) return `Selected model requires at least ${min} reference text node(s).`;
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
  data?: {
    content?: string;
    prompt?: string;
    label?: string;
    assetId?: string;
    outputVideoAssetId?: string;
    directorReferencePacket?: DirectorReferencePacket | unknown;
    directorShotReferencePackets?: ReadonlyArray<DirectorReferencePacket | unknown>;
  } & Record<string, unknown>;
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
 * Resolve the reference modality exposed by a Canvas node.
 *
 * Director Stage is an editor node rather than a media node, but after an
 * export its source handle represents the latest reference video. Keeping
 * that adapter here lets every generation entry point consume the same graph
 * contract without inserting a synthetic video or Timeline node.
 */
export function referenceModality(node: RefNodeLike): Modality | undefined {
  if (
    node.type === "text"
    || node.type === "image"
    || node.type === "video"
    || node.type === "audio"
  ) {
    return node.type;
  }
  if (node.type === "director-stage") return "video";
  return undefined;
}

/** Return the registered project asset carried by a reference node. */
export function referenceAssetId(node: RefNodeLike): string | undefined {
  const packet = node.type === "director-stage"
    ? directorReferencePackets(node)[0]
    : undefined;
  const value = node.type === "director-stage"
    ? packet?.referenceVideo.assetId ?? node.data?.outputVideoAssetId
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
    typeof node.data?.outputVideoAssetId === "string"
    && node.data.outputVideoAssetId.trim(),
  );
}

function selectDirectorReferenceStillAssetIds(
  packet: DirectorReferencePacket,
  maximum: number,
): string[] {
  const stills = [...packet.referenceStills].sort(
    (left, right) =>
      (left.timeSeconds ?? 0) - (right.timeSeconds ?? 0)
      || left.assetId.localeCompare(right.assetId),
  );
  if (stills.length <= maximum) return stills.map((still) => still.assetId);
  if (maximum <= 0) return [];
  if (maximum === 1) return [stills[0]!.assetId];
  const indexes = Array.from({ length: maximum }, (_, index) =>
    Math.round(index * (stills.length - 1) / (maximum - 1)),
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
      const text = normalizePromptInput(n.data?.content ?? n.data?.prompt ?? n.data?.label).trim();
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
  outputKind: "image" | "video" | "audio" | "text";
  sourceKind?: Modality | string;
  referenceCounts?: Partial<Record<Modality, number>>;
  enforceMinimums?: boolean;
  cards: ReadonlyArray<ModelCard>;
}): ModelCard[] {
  const sameKind = opts.cards.filter((card) => card.kind === opts.outputKind);
  if (opts.referenceCounts) {
    return sameKind.filter((card) => validateRefs(card, opts.referenceCounts!, {
      enforceMinimums: opts.enforceMinimums,
    }) === null);
  }
  if (!opts.sourceKind) return sameKind;
  const sourceKind = opts.sourceKind;
  if (!isReferenceModality(sourceKind)) return sameKind;
  const counts = { [sourceKind]: 1 } as Partial<Record<Modality, number>>;
  return sameKind.filter((card) => validateRefs(card, counts) === null);
}

/** Pick the first result from an injected, already-ordered candidate set. */
export function pickDefaultModel(opts: {
  outputKind: "image" | "video" | "audio" | "text";
  sourceKind?: Modality | string;
  referenceCounts?: Partial<Record<Modality, number>>;
  enforceMinimums?: boolean;
  cards: ReadonlyArray<ModelCard>;
}): ModelCard | undefined {
  return findCompatibleModels(opts)[0];
}
