/**
 * Canvas Types - Zod schemas for canvas nodes and edges
 * 
 * These are the canonical type definitions used across:
 * - TypeScript frontend (apps/web)
 * - TypeScript sync server (apps/loro-sync-server)
 * - Python API (via generated types)
 */

import { z } from 'zod';
import { resolveAspectRatio, type ModelCard } from './models';
import {
  validateRefs,
  partitionRefs,
  capability as capabilityFromCard,
  capabilityFromCustom,
  type Capability,
  type RefNodeLike,
  type RefPartition,
} from './model-capabilities';
import {
  composePromptWithTextRefs,
  extractPromptText,
  parsePromptParts,
} from './prompt';

// === Position ===
export const PositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof PositionSchema>;

// === ReactFlow Node Types ===
// These are the node type strings used in Loro and ReactFlow.
// Both frontend and backend must agree on these values.

/** Content node types that agents can create via create_canvas_node */
export const RF_NODE_TYPE = {
  /** Text / markdown content */
  Text: 'text',
  /** Container group */
  Group: 'group',
  /** Image asset (completed generation or upload) */
  Image: 'image',
  /** Video asset (completed generation or upload) */
  Video: 'video',
  /** Audio asset (completed generation or upload) */
  Audio: 'audio',
  /** Generation node — renders as ActionBadge */
  ActionBadge: 'action-badge',
} as const;

/** Subtypes for action-badge nodes, stored in node.data.actionType */
export const ACTION_TYPE = {
  ImageGen: 'image-gen',
  VideoGen: 'video-gen',
  AudioGen: 'audio-gen',
  TextGen: 'text-gen',
  /** Custom actions provided by local agents. Full actionType: "custom:<action-id>" */
  Custom: 'custom',
} as const;

/**
 * Edit-node ReactFlow types. Distinct from action-badge generation: these
 * carry their own UI (full-screen editor modal) and copy-on-write semantics
 * — output is always a fresh asset, source is left untouched.
 */
export const EDIT_KIND = {
  ImageEditor: 'image-editor',
  VideoClipper: 'video-clipper',
} as const;
export type EditKind = (typeof EDIT_KIND)[keyof typeof EDIT_KIND];

/** Pixel-space crop rectangle on the source asset's natural dimensions. */
export const CropRectSchema = z.object({
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type CropRect = z.infer<typeof CropRectSchema>;

/** Parameters for `image-editor`. Both fields optional → identity edit. */
export const ImageEditParamsSchema = z.object({
  crop: CropRectSchema.optional(),
  /** Clockwise degrees; only multiples of 90 are honored at apply time. */
  rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).optional(),
});
export type ImageEditParams = z.infer<typeof ImageEditParamsSchema>;

/** Parameters for `video-clipper`. */
export const VideoClipParamsSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('screenshot'),
    /** Time within the source video, in seconds. */
    frameTimeSec: z.number().nonnegative(),
  }),
  z.object({
    mode: z.literal('crop'),
    startSec: z.number().nonnegative(),
    endSec: z.number().positive(),
  }),
]);
export type VideoClipParams = z.infer<typeof VideoClipParamsSchema>;

/**
 * Map from agent-facing node type names to the ReactFlow type + actionType
 * used in Loro and the frontend.
 */
export const AGENT_NODE_TYPE_MAP = {
  text:      { rfType: RF_NODE_TYPE.Text },
  group:     { rfType: RF_NODE_TYPE.Group },
  image:     { rfType: RF_NODE_TYPE.Image },
  video:     { rfType: RF_NODE_TYPE.Video },
  audio:     { rfType: RF_NODE_TYPE.Audio },
  image_gen: { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.ImageGen },
  video_gen: { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.VideoGen },
  audio_gen: { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.AudioGen },
  text_gen:  { rfType: RF_NODE_TYPE.ActionBadge, actionType: ACTION_TYPE.TextGen },
} as const;

// === Node Status ===
export const NodeStatusSchema = z.enum([
  'idle',
  'pending',
  'generating',
  'completed',
  'failed',
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

// === Node Data ===
export const NodeDataSchema = z.object({
  label: z.string().optional(),
  content: z.string().optional(),
  description: z.string().optional(),
  prompt: z.string().optional(),
  src: z.string().optional(),
  url: z.string().optional(),
  thumbnail: z.string().optional(),
  poster: z.string().optional(),
  status: NodeStatusSchema.optional(),
  assetId: z.string().optional(),
  taskId: z.string().optional(),
  actionType: z.string().optional(),
  upstreamNodeIds: z.array(z.string()).optional(),
  duration: z.number().optional(),
  model: z.string().optional(),
  modelId: z.string().optional(),
  modelParams: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  referenceImageUrls: z.array(z.string()).optional(),
  error: z.string().optional(),
  sourceNodeId: z.string().optional(),
  /** Custom action ID (e.g. "style-transfer") for custom:* action types */
  customActionId: z.string().optional(),
  /** User-configured parameters for custom actions */
  customActionParams: z.record(z.unknown()).optional(),
  // ─── Actor attribution (Phase 0 multi-actor billing) ────────
  // Stamped by the creation site (web UI / ACP tool / CLI). For
  // legacy nodes created before this rollout these are absent —
  // NodeProcessor surfaces missing attribution as a clear node
  // failure rather than silently falling back to the project owner.
  /** 'user' or 'agent' — who placed this node on the canvas. */
  actorType: z.enum(['user', 'agent']).optional(),
  /** The accountable human user id. Always set for new nodes; for
   *  actorType='agent' this is the agent's owner / claimer. */
  actorUserId: z.string().optional(),
  /** crew_member.id when actorType='agent'. */
  actorAgentId: z.string().optional(),
  /** Structured understanding results (ASR transcription, visual analysis, etc.).
   *  Keys are overwritten, not merged — each key is independently owned. */
  understanding: z.object({
    transcription: z.object({
      text: z.string(),
      segments: z.array(z.object({
        start: z.number(),
        end: z.number(),
        text: z.string(),
      })),
    }).optional(),
    visual: z.object({
      description: z.string().optional(),
      shots: z.array(z.object({
        start: z.number(),
        end: z.number(),
        description: z.string(),
      })).optional(),
      tags: z.array(z.string()).optional(),
    }).optional(),
  }).passthrough().optional(),
}).passthrough(); // Allow additional fields

export type NodeData = z.infer<typeof NodeDataSchema>;

// === Canvas Node ===
export const CanvasNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: PositionSchema,
  data: NodeDataSchema,
  parentId: z.string().optional(),
  extent: z.literal('parent').optional(),
});
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;

// === Canvas Edge ===
export const CanvasEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: z.string().default('default'),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
});
export type CanvasEdge = z.infer<typeof CanvasEdgeSchema>;

// === Loro Document State ===
export const LoroDocumentStateSchema = z.object({
  nodes: z.record(z.string(), CanvasNodeSchema),
  edges: z.record(z.string(), CanvasEdgeSchema),
  tasks: z.record(z.string(), z.any()),
});
export type LoroDocumentState = z.infer<typeof LoroDocumentStateSchema>;

// === Generation Pre-validation ===

export interface ValidateGenerationInput {
  prompt: string;
  referenceTextSnippets?: string[];
  /** D1 asset IDs of image refs (parallel to partitionRefs output). */
  referenceImageAssetIds?: string[];
  referenceVideoAssetIds?: string[];
  referenceAudioAssetIds?: string[];
  /** Either supply the raw ModelCard (legacy) or a pre-derived
   *  Capability (the new unified path that covers custom actions too). */
  modelCard?: ModelCard;
  capability?: import("./model-capabilities").Capability;
}

/**
 * Validate generation inputs against the bound's capability. Returns
 * null if valid, or an error message string if invalid.
 *
 * Thin wrapper around `validateRefs` (model-capabilities.ts). Pre-
 * computed `capability` wins over `modelCard` so the same call works
 * for model-backed and custom-action gens.
 */
export function validateGenerationInput(input: ValidateGenerationInput): string | null {
  const {
    prompt,
    referenceTextSnippets = [],
    referenceImageAssetIds = [],
    referenceVideoAssetIds = [],
    referenceAudioAssetIds = [],
    modelCard,
    capability,
  } = input;
  const cardOrCap = capability ?? modelCard;
  if (!cardOrCap) return null;
  return validateRefs(
    cardOrCap,
    {
      text: referenceTextSnippets.length,
      image: referenceImageAssetIds.length,
      video: referenceVideoAssetIds.length,
      audio: referenceAudioAssetIds.length,
    },
    { prompt },
  );
}

// === Pending Asset Node Builder ===
// Shared logic for creating a pending image/video node from generation params.
// Used by both frontend (ActionBadge) and backend (run_generation_node tool).

export interface BuildPendingAssetNodeInput {
  nodeId: string;
  prompt: string;
  /** For built-in models: the modelId (`gemini-flash-image`, etc.).
   *  For custom actions: empty string (the action id lives in
   *  `customActionId` instead). NodeProcessor switches by
   *  `actionType.startsWith('custom:')`. */
  modelId: string;
  modelParams: Record<string, string | number | boolean>;
  /** Either a built-in actionType or `custom:<id>`. NodeProcessor
   *  uses this discriminator to pick the dispatch path. */
  actionType:
    | typeof ACTION_TYPE.ImageGen
    | typeof ACTION_TYPE.VideoGen
    | typeof ACTION_TYPE.AudioGen
    | typeof ACTION_TYPE.TextGen
    | `custom:${string}`;
  label?: string;
  /** D1 asset IDs of image refs. Server resolves to R2 keys. */
  referenceImageAssetIds?: string[];
  /** D1 asset IDs of video refs. Only consumed by video-gen / text-gen
   *  pending nodes (image-gen / audio-gen ignore them per partitionRefs). */
  referenceVideoAssetIds?: string[];
  /** D1 asset IDs of audio refs. Only consumed by video-gen / text-gen
   *  pending nodes. */
  referenceAudioAssetIds?: string[];
  referenceMode?: string;
  /** Pipeline status to stamp on the node. The default `'pending'`
   *  fits the executor / Run flow (NodeProcessor picks these up). The
   *  web's lazy-draft path stamps `'draft'` instead — a placeholder
   *  slot the user can fill before submit. */
  status?: 'pending' | 'draft';
  /** Custom-action only: the marketplace action id. NodeProcessor
   *  reads this to fetch the runtime / workerUrl manifest. */
  customActionId?: string;
  /** Custom-action only: the declarative param values from the form
   *  the user filled in. Forwarded verbatim to the action runtime. */
  customActionParams?: Record<string, string | number | boolean>;
  /** Custom-action only: the action's declared output modality
   *  (image / video / audio / text). Overrides what we'd otherwise
   *  derive from actionType. */
  outputType?: 'image' | 'video' | 'audio' | 'text';
}

export interface PendingAssetNode {
  id: string;
  type: typeof RF_NODE_TYPE.Image | typeof RF_NODE_TYPE.Video | typeof RF_NODE_TYPE.Audio | typeof RF_NODE_TYPE.Text;
  data: Record<string, unknown>;
}

/** Extract a short label from prompt text. Skips markdown heading
 *  prefixes and trims to 60 chars so it fits on the node chip. Shared
 *  between server `executeGeneration` and web `useSpawnPendingAsset`
 *  so both paths produce the same label. */
export function extractLabelFromPrompt(promptText: string, fallback: string): string {
  if (!promptText || promptText.trim() === '') return fallback;
  const lines = promptText.split('\n').map(l => l.replace(/^#+\s*/, '').trim()).filter(Boolean);
  const first = lines[0] || fallback;
  return first.length > 60 ? first.slice(0, 57) + '...' : first;
}

/**
 * Build a pending asset node ready to be inserted into Loro.
 * NodeProcessor picks up `status:"pending"` (no src field — assets live on
 * D1, server resolves via assetId).
 */
export function buildPendingAssetNode(input: BuildPendingAssetNodeInput): PendingAssetNode {
  const {
    nodeId, prompt, modelId, modelParams, actionType,
    referenceImageAssetIds, referenceVideoAssetIds, referenceAudioAssetIds,
    referenceMode, customActionId, customActionParams, outputType,
  } = input;

  // Custom-action flag drives a few small divergences: we don't pin
  // `count: 1`, we carry customActionId + customActionParams as the
  // dispatch payload, and the output modality comes from the action's
  // declared `outputType` rather than the built-in actionType enum.
  const isCustom = typeof actionType === 'string' && actionType.startsWith('custom:');
  const effectiveOutputKind: 'image' | 'video' | 'audio' | 'text' = isCustom
    ? (outputType ?? 'image')
    : actionType === ACTION_TYPE.VideoGen
      ? 'video'
      : actionType === ACTION_TYPE.AudioGen
        ? 'audio'
        : actionType === ACTION_TYPE.TextGen
          ? 'text'
          : 'image';

  const isImage = effectiveOutputKind === 'image';
  const isVideo = effectiveOutputKind === 'video';
  const isAudio = effectiveOutputKind === 'audio';
  const isText = effectiveOutputKind === 'text';
  const rfType = isVideo
    ? RF_NODE_TYPE.Video
    : isAudio
      ? RF_NODE_TYPE.Audio
      : isText
        ? RF_NODE_TYPE.Text
        : RF_NODE_TYPE.Image;
  const defaultLabel = isVideo
    ? 'Generated Video'
    : isAudio
      ? 'Generated Audio'
      : isText
        ? 'Generated Text'
        : 'Generated Image';
  const label = input.label || extractLabelFromPrompt(prompt, defaultLabel);

  // image-gen (built-in only) pins `count: 1` on its modelParams the
  // way the web's useSpawnPendingAsset does so downstream batch-size
  // logic doesn't assume a missing count means "use the action-badge's
  // count". Custom actions follow their own param schema.
  const effectiveModelParams: Record<string, string | number | boolean> = isImage && !isCustom
    ? { ...modelParams, count: 1 }
    : modelParams;

  const data: Record<string, unknown> = {
    label,
    status: input.status ?? 'pending',
    prompt,
    actionType,
  };

  if (isCustom) {
    if (customActionId) data.customActionId = customActionId;
    if (customActionParams) data.customActionParams = customActionParams;
    if (outputType) data.outputType = outputType;
  } else {
    data.model = modelId;
    data.modelId = modelId;
    data.modelParams = effectiveModelParams;
  }

  if (isText) {
    data.content = '';
  } else {
    if (!isCustom) data.aspectRatio = resolveAspectRatio(modelId, modelParams);
    data.referenceMode = referenceMode || 'none';
  }

  // Ref arrays. The pending child carries whichever buckets came out
  // of partitionRefs — for custom this fixes the pre-unification bug
  // where the manifest's `promptModalities` declared (say) image
  // input but the pending node dropped all refs, leaving the action
  // unable to consume canvas assets.
  if (referenceImageAssetIds && referenceImageAssetIds.length > 0 && !isAudio) {
    data.referenceImageAssetIds = referenceImageAssetIds;
  }
  if ((isVideo || isText || isCustom) && referenceVideoAssetIds && referenceVideoAssetIds.length > 0) {
    data.referenceVideoAssetIds = referenceVideoAssetIds;
  }
  if ((isVideo || isText || isCustom) && referenceAudioAssetIds && referenceAudioAssetIds.length > 0) {
    data.referenceAudioAssetIds = referenceAudioAssetIds;
  }

  if (isVideo && !isCustom) {
    const dur = modelParams.duration ?? 5;
    data.duration = typeof dur === 'string' ? parseInt(dur, 10) : Number(dur) || 5;
  }

  return { id: nodeId, type: rfType, data };
}

// === Unified generation payload pipeline ===
//
// `buildGenerationPayload` is the single staging step that turns the
// raw inputs an action-badge carries (a markdown prompt with
// `@[Label](node:id)` mentions, a list of attached ref nodes, the
// chosen model card, and modelParams) into the validated, normalized
// shape the executor feeds to `buildPendingAssetNode`.
//
// Two call sites: the web UI's `useSpawnPendingAsset.buildShape`
// (browser side, executes when the user clicks Run on an
// action-badge) and the server-side `Canvas.executeGeneration` (used
// by `clash canvas execute`, agent tools, automation). Before this
// helper they re-implemented overlapping logic in parallel and
// diverged on three things:
//   1. partitionRefs / model-card filtering (web honored max +
//      modality, executor ignored both)
//   2. composing text-ref content into the prompt
//   3. stripping `@[Label](node:id)` markdown back to plain text
//      before sending it to the model
// Pulling them into one helper means new modalities / new model
// constraints land in exactly one place.

/**
 * Either a built-in model (`{ modelCard, modelParams }`) or a
 * marketplace custom action (`{ customDef, customActionParams }`).
 * Both flow through the same payload builder — they're two surfaces
 * for the same concept: declarative generation config + per-modality
 * ref capability.
 */
export type GenerationConfig =
  | {
      kind: 'model';
      modelCard?: ModelCard;
      modelParams: Record<string, string | number | boolean>;
    }
  | {
      kind: 'custom';
      customDef: CustomActionDefinition;
      customActionParams: Record<string, string | number | boolean>;
    };

export interface BuildGenerationPayloadInput {
  /** Raw prompt as the user typed it (with `@[Label](node:id)` mentions). */
  prompt: string;
  /** All canvas nodes the action-badge has incoming edges from. The
   *  helper does NOT walk edges itself — the caller supplies the
   *  resolved nodes (web reads from React Flow state, server from
   *  Canvas's edges + node lookup). */
  refNodes: ReadonlyArray<RefNodeLike>;
  /** Stable id of the gen config (modelId for built-in, customActionId
   *  for custom). The pending child node persists it so the executor
   *  / NodeProcessor knows what to dispatch to. */
  configId: string;
  /** The full gen config — `kind` discriminates which set of params is
   *  authoritative. The helper uses this to derive a Capability so
   *  partitionRefs / validateRefs / extractPromptText all work the
   *  same way regardless of model vs custom. */
  config: GenerationConfig;
  /** Output modality of the gen. Required for custom (the action
   *  declares it on the def); for built-in models it must match the
   *  card's `kind`. */
  actionType:
    | typeof ACTION_TYPE.ImageGen
    | typeof ACTION_TYPE.VideoGen
    | typeof ACTION_TYPE.AudioGen
    | typeof ACTION_TYPE.TextGen
    | `custom:${string}`;
  label?: string;
  referenceMode?: string;
}

export interface BuildGenerationPayloadResult {
  /** Ready-to-feed input for `buildPendingAssetNode`. The `nodeId`
   *  field is left empty so the caller can mint it however it wants
   *  (generateSemanticId on the web, Canvas.generateId on the
   *  server). */
  pendingInput: BuildPendingAssetNodeInput;
  /** First validation error against the model card, or null when the
   *  payload is acceptable / no model card supplied. Caller decides
   *  whether to throw, surface the message, or fall through. */
  validationError: string | null;
  /** The partition that was computed, kept for callers that want to
   *  log "wired 2 image refs / 1 video ref" without re-walking the
   *  buckets themselves. */
  partition: RefPartition;
  /** The cleaned, plain-text prompt that ends up in
   *  `pendingInput.prompt` — exposed separately for callers that want
   *  to compute a label from the cleaned prompt. */
  cleanedPrompt: string;
}

export function buildGenerationPayload(input: BuildGenerationPayloadInput): BuildGenerationPayloadResult {
  // 1. Derive the Capability from whichever config the caller passed.
  //    Both built-in models and custom actions go through the same
  //    `Capability` shape so partitionRefs / validateRefs / the
  //    helpers downstream don't branch on config kind.
  const cap: Capability | undefined =
    input.config.kind === 'model'
      ? input.config.modelCard
        ? capabilityFromCard(input.config.modelCard)
        : undefined
      : capabilityFromCustom(input.config.customDef);

  // 2. Partition refs by modality. Without a capability the caller is
  //    deliberately running unconstrained (e.g. a model card hasn't
  //    loaded yet, or a custom def is mid-install) — bucket nothing.
  const partition: RefPartition = cap
    ? partitionRefs(input.refNodes, cap)
    : { texts: [], imageAssetIds: [], videoAssetIds: [], audioAssetIds: [] };

  // 3. Text refs fold into the prompt (`# Heading\n\nbody\n\n# …`).
  //    The text bucket is consumed here and never reaches the
  //    pending-asset data — that's intentional.
  const composedPrompt = composePromptWithTextRefs(input.prompt, partition.texts);

  // 4. Strip the `@[Label](node:id)` markdown markers and replace with
  //    just the label. Models don't speak our mention syntax; sending
  //    them the raw markdown confuses prompt adherence ("the user
  //    mentioned @[..] is that important?").
  const cleanedPrompt = extractPromptText(parsePromptParts(composedPrompt));

  // 5. Validate against the capability. Skipped when we don't have
  //    one (custom mid-install / model card not loaded).
  const validationError = cap
    ? validateGenerationInput({
        prompt: cleanedPrompt,
        referenceTextSnippets: partition.texts,
        referenceImageAssetIds: partition.imageAssetIds,
        referenceVideoAssetIds: partition.videoAssetIds,
        referenceAudioAssetIds: partition.audioAssetIds,
        capability: cap,
      })
    : null;

  const totalAssetRefs =
    partition.imageAssetIds.length + partition.videoAssetIds.length + partition.audioAssetIds.length;

  // 6. Pending-asset input. Both branches write the SAME ref fields —
  //    custom actions previously dropped them (so a marketplace
  //    action couldn't consume canvas assets even though its manifest
  //    declared it could); writing them here fixes that.
  const pendingInput: BuildPendingAssetNodeInput =
    input.config.kind === 'model'
      ? {
          nodeId: '', // caller fills in
          prompt: cleanedPrompt,
          modelId: input.configId,
          modelParams: input.config.modelParams,
          actionType: input.actionType as
            | typeof ACTION_TYPE.ImageGen
            | typeof ACTION_TYPE.VideoGen
            | typeof ACTION_TYPE.AudioGen
            | typeof ACTION_TYPE.TextGen,
          label: input.label,
          referenceImageAssetIds: partition.imageAssetIds.length > 0 ? partition.imageAssetIds : undefined,
          referenceVideoAssetIds: partition.videoAssetIds.length > 0 ? partition.videoAssetIds : undefined,
          referenceAudioAssetIds: partition.audioAssetIds.length > 0 ? partition.audioAssetIds : undefined,
          referenceMode:
            input.referenceMode ?? (totalAssetRefs > 0 ? 'image-and-prompt' : undefined),
        }
      : {
          nodeId: '',
          prompt: cleanedPrompt,
          // Custom actions don't have a modelId, but the pending node
          // schema still needs *something* to disambiguate the
          // dispatch path. We stash `custom:<actionId>` in the modelId
          // field (mirrors what NodeProcessor already reads via
          // `innerData.actionType.startsWith('custom:')`) and also
          // expose customActionId + customActionParams via the
          // pending input's extra fields below.
          modelId: '',
          modelParams: {},
          actionType: input.actionType as `custom:${string}`,
          label: input.label,
          customActionId: input.config.customDef.id,
          customActionParams: input.config.customActionParams,
          referenceImageAssetIds: partition.imageAssetIds.length > 0 ? partition.imageAssetIds : undefined,
          referenceVideoAssetIds: partition.videoAssetIds.length > 0 ? partition.videoAssetIds : undefined,
          referenceAudioAssetIds: partition.audioAssetIds.length > 0 ? partition.audioAssetIds : undefined,
          referenceMode:
            input.referenceMode ?? (totalAssetRefs > 0 ? 'image-and-prompt' : undefined),
          outputType: input.config.customDef.outputType,
        };

  return { pendingInput, validationError, partition, cleanedPrompt };
}

// ─── Legacy / Agent-facing Constants ──────────────────────
// Used by agents, CLI, and backend code that speaks in "image_gen"/"video_gen"
// style names rather than ReactFlow action-badge types.
// rather than the ReactFlow types above.

/** Agent-facing node type names */
export const NodeType = {
  Text: "text",
  Group: "group",
  Image: "image",
  Video: "video",
  Audio: "audio",
  ImageGen: "image_gen",
  VideoGen: "video_gen",
  AudioGen: "audio_gen",
  TextGen: "text_gen",
} as const;

export const ALL_NODE_TYPES = Object.values(NodeType) as [string, ...string[]];
export const CONTENT_NODE_TYPES = [NodeType.Text, NodeType.Group] as const;
export type ContentNodeType = (typeof CONTENT_NODE_TYPES)[number];
export const GENERATION_NODE_TYPES = [NodeType.ImageGen, NodeType.VideoGen, NodeType.AudioGen, NodeType.TextGen] as const;
export type GenerationNodeType = (typeof GENERATION_NODE_TYPES)[number];

export function isGenerationNodeType(t: string): boolean {
  return (GENERATION_NODE_TYPES as readonly string[]).includes(t);
}

/** @deprecated Use RF_NODE_TYPE.ActionBadge + ACTION_TYPE */
export const FrontendNodeType = {
  ImageGen: "action-badge",
  VideoGen: "action-badge",
  AudioGen: "action-badge",
  TextGen: "action-badge",
} as const;

export const ProposalType = {
  Simple: "simple",
  Generative: "generative",
  Group: "group",
} as const;

/** Node lifecycle status — matches NodeStatusSchema values */
export const TaskStatus = {
  Idle: "idle",
  Pending: "pending",
  Generating: "generating",
  Completed: "completed",
  Failed: "failed",
  NodeNotFound: "node_not_found",
} as const;

export const AssetStatus = {
  Pending: "pending",
  Processing: "processing",
  Completed: "completed",
  Failed: "failed",
} as const;

// ─── Custom Action Definitions ───────────────────────────
// Used by local agents (Python SDK) and deployed workers (CF Workers)
// to register custom actions on the canvas.

export const CustomActionParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'slider', 'select', 'boolean']),
  description: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
  options: z.array(z.object({
    label: z.string(),
    value: z.union([z.string(), z.number()]),
  })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
});
export type CustomActionParameter = z.infer<typeof CustomActionParameterSchema>;

export const CustomActionSecretSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().default(true),
});
export type CustomActionSecret = z.infer<typeof CustomActionSecretSchema>;

export const ACTION_PROVIDER_IDS = [
  'fal',
  'replicate',
  'kie',
  'official',
  'openai',
  'google',
  'anthropic',
  'elevenlabs',
] as const;
export type ActionProviderId = (typeof ACTION_PROVIDER_IDS)[number];

const ACTION_PROVIDER_ALIASES: Record<string, ActionProviderId> = {
  fal: 'fal',
  'fal.ai': 'fal',
  falai: 'fal',
  replicate: 'replicate',
  replica: 'replicate',
  'replicate.com': 'replicate',
  kie: 'kie',
  'kie.ai': 'kie',
  official: 'official',
  native: 'official',
  openai: 'openai',
  'openai.com': 'openai',
  google: 'google',
  gemini: 'google',
  'ai.google.dev': 'google',
  anthropic: 'anthropic',
  claude: 'anthropic',
  elevenlabs: 'elevenlabs',
  'eleven-labs': 'elevenlabs',
  'elevenlabs.io': 'elevenlabs',
};

export interface ActionProviderPreset {
  id: ActionProviderId;
  label: string;
  defaultSecretId: string;
  secretLabel: string;
  secretDescription: string;
  docsUrl?: string;
}

export const ACTION_PROVIDER_PRESETS: Record<ActionProviderId, ActionProviderPreset> = {
  fal: {
    id: 'fal',
    label: 'fal.ai',
    defaultSecretId: 'FAL_API_KEY',
    secretLabel: 'fal.ai API key',
    secretDescription: 'API key used to call the fal.ai model provider.',
    docsUrl: 'https://fal.ai/dashboard/keys',
  },
  replicate: {
    id: 'replicate',
    label: 'Replicate',
    defaultSecretId: 'REPLICATE_API_TOKEN',
    secretLabel: 'Replicate API token',
    secretDescription: 'API key used to call the Replicate model provider.',
    docsUrl: 'https://replicate.com/account/api-tokens',
  },
  kie: {
    id: 'kie',
    label: 'Kie.ai',
    defaultSecretId: 'KIE_API_KEY',
    secretLabel: 'Kie.ai API key',
    secretDescription: 'API key used to call the Kie.ai model provider.',
  },
  official: {
    id: 'official',
    label: 'Official API',
    defaultSecretId: 'OFFICIAL_API_KEY',
    secretLabel: 'Official provider API key',
    secretDescription: 'API key used to call the official model provider.',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    defaultSecretId: 'OPENAI_API_KEY',
    secretLabel: 'OpenAI API key',
    secretDescription: 'API key used to call the official OpenAI API.',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  google: {
    id: 'google',
    label: 'Google AI',
    defaultSecretId: 'GOOGLE_API_KEY',
    secretLabel: 'Google API key',
    secretDescription: 'API key used to call the official Google AI API.',
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic',
    defaultSecretId: 'ANTHROPIC_API_KEY',
    secretLabel: 'Anthropic API key',
    secretDescription: 'API key used to call the official Anthropic API.',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  elevenlabs: {
    id: 'elevenlabs',
    label: 'ElevenLabs',
    defaultSecretId: 'ELEVENLABS_API_KEY',
    secretLabel: 'ElevenLabs API key',
    secretDescription: 'API key used to call the official ElevenLabs API.',
    docsUrl: 'https://elevenlabs.io/app/settings/api-keys',
  },
};

export function normalizeActionProviderId(value: unknown): ActionProviderId | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase().replace(/^@/, '');
  return ACTION_PROVIDER_ALIASES[key] ?? null;
}

export const ActionProviderIdSchema = z.preprocess(
  (value) => normalizeActionProviderId(value) ?? value,
  z.enum(ACTION_PROVIDER_IDS),
);

export const CustomActionModelSchema = z.object({
  /** Provider-facing model id, e.g. `fal-ai/flux-pro` or `gpt-image-1`. */
  id: z.string(),
  /** Common MaaS / official provider preset. Aliases like `replica` normalize to `replicate`. */
  provider: ActionProviderIdSchema,
  /** Optional display name when the provider id is too terse. */
  name: z.string().optional(),
  /** Override the provider preset key name, e.g. `OPENAI_API_KEY` for provider=`official`. */
  secretId: z.string().optional(),
  /** Optional provider base URL for action handlers that support configurable endpoints. */
  baseUrl: z.string().optional(),
  /** Optional provider endpoint/path for action handlers that route multiple models. */
  endpoint: z.string().optional(),
}).passthrough();
export type CustomActionModel = z.infer<typeof CustomActionModelSchema>;

export function mergeActionProviderSecrets<T extends { model?: CustomActionModel; secrets?: CustomActionSecret[] }>(
  def: T,
): T & { secrets: CustomActionSecret[] } {
  const secrets = [...(def.secrets ?? [])];
  const provider = def.model?.provider;
  if (provider) {
    const preset = ACTION_PROVIDER_PRESETS[provider];
    const id = def.model?.secretId || preset.defaultSecretId;
    if (!secrets.some((secret) => secret.id === id)) {
      secrets.push({
        id,
        label: preset.secretLabel,
        description: preset.secretDescription,
        required: true,
      });
    }
  }
  return { ...def, secrets };
}

const CustomActionDefinitionBaseSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  parameters: z.array(CustomActionParameterSchema).default([]),
  outputType: z.enum(['image', 'video', 'audio', 'text']),
  icon: z.string().optional(),
  color: z.string().optional(),
  /** Execution runtime: 'local' = Python SDK via WebSocket, 'worker' = deployed CF Worker via HTTP */
  runtime: z.enum(['local', 'worker']).default('local'),
  /** Semver version */
  version: z.string().optional(),
  /** Action author name */
  author: z.string().optional(),
  /** Source repository (e.g. "github:user/repo") */
  repository: z.string().optional(),
  /** CF Worker URL for runtime='worker' actions */
  workerUrl: z.string().optional(),
  /** User variables this action needs (e.g. API keys). Platform injects at runtime. */
  secrets: z.array(CustomActionSecretSchema).default([]),
  /** Provider/model binding used by MaaS-compatible actions. */
  model: CustomActionModelSchema.optional(),
  /** Discovery tags */
  tags: z.array(z.string()).optional(),
  /** Modalities that can be @-mentioned inline in the prompt editor */
  promptModalities: z.array(z.enum(['text', 'image', 'video', 'audio'])).default(['text']),
  /**
   * runtime_id of the local runtime that registered this action. The server
   * stamps this from the connecting WS client's `x-runtime-id` header, which
   * the python SDK forwards from the CLASH_RUNTIME_ID env var (set by the
   * bridge daemon when it spawns each action subprocess).
   *
   * Custom actions are a property of THE USER'S MACHINE — when the runtime
   * is offline, NodeProcessor refuses to dispatch the action and the node
   * lands in `status: failed` with a clear error. This field is the link
   * back to the runtime row that the deriveRuntimeStatus check consults.
   */
  registeredByRuntime: z.string().optional(),
  /**
   * Project ids this action attaches to. `"*"` (the default) means every
   * project the user is in. This declaration lives in the manifest so the
   * install endpoint can echo the user's intent forward and the bridge can
   * spawn one subprocess per attached project.
   *
   * NOTE: As of this change the bridge still spawns a single subprocess per
   * action (no `CLASH_PROJECT_ID` pinning). The field is reserved — it will
   * be honored on the next bridge restart in a future change that wires
   * per-project spawning.
   */
  attachedProjects: z.array(z.string()).default(["*"]),
});
export const CustomActionDefinitionSchema = CustomActionDefinitionBaseSchema.transform((def) =>
  mergeActionProviderSecrets(def),
);
export type CustomActionDefinition = z.output<typeof CustomActionDefinitionSchema>;

/** Check if an actionType string represents a custom (local) action */
export function isCustomActionType(actionType: string): boolean {
  return actionType.startsWith('custom:');
}

/** Extract the action ID from a custom actionType string */
export function getCustomActionId(actionType: string): string {
  return actionType.replace('custom:', '');
}

// ─── Loro-compatible Schemas ──────────────────────────────

export const NodeInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()),
  parent_id: z.string().nullish(),
});

export const EdgeInfoSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  source_handle: z.string().nullish(),
  target_handle: z.string().nullish(),
});
export type EdgeInfo = z.infer<typeof EdgeInfoSchema>;

export const ProjectContextSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(),
    type: z.string(),
    data: z.record(z.unknown()),
    position: z.object({ x: z.number().default(0), y: z.number().default(0) }),
    parentId: z.string().nullish(),
  })),
  edges: z.array(z.object({
    id: z.string(),
    source: z.string(),
    target: z.string(),
    type: z.string().nullish(),
  })),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
