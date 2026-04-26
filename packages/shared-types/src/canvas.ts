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
import { validateRefs } from './model-capabilities';

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
  modelCard: ModelCard;
}

/**
 * Validate generation inputs against model card requirements.
 * Returns null if valid, or an error message string if invalid.
 *
 * Thin wrapper around `validateRefs` (model-capabilities.ts) — kept for
 * backward compat with existing imports. New code should call `validateRefs`
 * directly.
 */
export function validateGenerationInput(input: ValidateGenerationInput): string | null {
  const {
    prompt,
    referenceTextSnippets = [],
    referenceImageAssetIds = [],
    referenceVideoAssetIds = [],
    referenceAudioAssetIds = [],
    modelCard,
  } = input;
  return validateRefs(
    modelCard,
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
  modelId: string;
  modelParams: Record<string, string | number | boolean>;
  actionType:
    | typeof ACTION_TYPE.ImageGen
    | typeof ACTION_TYPE.VideoGen
    | typeof ACTION_TYPE.AudioGen
    | typeof ACTION_TYPE.TextGen;
  label?: string;
  /** D1 asset IDs of image refs. Server resolves to R2 keys. */
  referenceImageAssetIds?: string[];
  referenceMode?: string;
}

export interface PendingAssetNode {
  id: string;
  type: typeof RF_NODE_TYPE.Image | typeof RF_NODE_TYPE.Video | typeof RF_NODE_TYPE.Audio | typeof RF_NODE_TYPE.Text;
  data: Record<string, unknown>;
}

/** Extract a short label from prompt text */
function extractLabelFromPrompt(promptText: string, fallback: string): string {
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
    referenceImageAssetIds, referenceMode,
  } = input;

  const isVideo = actionType === ACTION_TYPE.VideoGen;
  const isAudio = actionType === ACTION_TYPE.AudioGen;
  const isText = actionType === ACTION_TYPE.TextGen;
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

  const data: Record<string, unknown> = {
    label,
    status: 'pending',
    prompt,
    model: modelId,
    modelId,
    modelParams,
  };

  if (isText) {
    data.content = '';
  } else {
    data.aspectRatio = resolveAspectRatio(modelId, modelParams);
    data.referenceMode = referenceMode || 'none';
  }

  if (referenceImageAssetIds && referenceImageAssetIds.length > 0) {
    data.referenceImageAssetIds = referenceImageAssetIds;
  }

  if (isVideo) {
    const dur = modelParams.duration ?? 5;
    data.duration = typeof dur === 'string' ? parseInt(dur, 10) : Number(dur) || 5;
  }

  return { id: nodeId, type: rfType, data };
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

export const CustomActionDefinitionSchema = z.object({
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
  secrets: z.array(CustomActionSecretSchema).optional(),
  /** Discovery tags */
  tags: z.array(z.string()).optional(),
  /** Modalities that can be @-mentioned inline in the prompt editor */
  promptModalities: z.array(z.enum(['text', 'image', 'video', 'audio'])).default(['text']),
});
export type CustomActionDefinition = z.infer<typeof CustomActionDefinitionSchema>;

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
