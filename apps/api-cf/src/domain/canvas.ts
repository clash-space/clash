import { z } from "zod";

// ─── Node Types ────────────────────────────────────────────

/** Canvas node types (user-facing content nodes). */
export const NodeType = {
  Text: "text",
  Prompt: "prompt",
  Group: "group",
  Image: "image",
  Video: "video",
  /** Image generation action node. */
  ImageGen: "image_gen",
  /** Video generation action node. */
  VideoGen: "video_gen",
} as const;

export type NodeType = (typeof NodeType)[keyof typeof NodeType];

/** All node type values as an array — useful for Zod enums. */
export const ALL_NODE_TYPES = Object.values(NodeType) as [NodeType, ...NodeType[]];

/** Non-generative node types (manually created by agents). */
export const CONTENT_NODE_TYPES = [NodeType.Text, NodeType.Prompt, NodeType.Group] as const;
export type ContentNodeType = (typeof CONTENT_NODE_TYPES)[number];

/** Generation node types. */
export const GENERATION_NODE_TYPES = [NodeType.ImageGen, NodeType.VideoGen] as const;
export type GenerationNodeType = (typeof GENERATION_NODE_TYPES)[number];

export function isGenerationNodeType(t: string): t is GenerationNodeType {
  return (GENERATION_NODE_TYPES as readonly string[]).includes(t);
}

// ─── Frontend Node Types (proposal mapping) ────────────────

export const FrontendNodeType = {
  ImageGen: "action-badge-image",
  VideoGen: "action-badge-video",
} as const;

// ─── Proposal Types ────────────────────────────────────────

export const ProposalType = {
  Simple: "simple",
  Generative: "generative",
  Group: "group",
} as const;

export type ProposalType = (typeof ProposalType)[keyof typeof ProposalType];

// ─── Unified Status ─────────────────────────────────────────
//
// Single status enum used across D1 and Loro layers.
// D1 subset:  Pending → Generating → Completed / Failed
// Loro subset: Generating → Completed / Failed
//

export const Status = {
  Pending: "pending",
  Generating: "generating",
  Completed: "completed",
  Failed: "failed",
  NodeNotFound: "node_not_found",
} as const;

export type Status = (typeof Status)[keyof typeof Status];

// ─── Schemas ───────────────────────────────────────────────

export const NodeInfoSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.record(z.unknown()),
  parent_id: z.string().nullish(),
});
export type NodeInfo = z.infer<typeof NodeInfoSchema>;

export const EdgeInfoSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  source_handle: z.string().nullish(),
  target_handle: z.string().nullish(),
});
export type EdgeInfo = z.infer<typeof EdgeInfoSchema>;

export interface CreateNodeResult {
  node_id: string | null;
  error: string | null;
  proposal: Record<string, unknown> | null;
  asset_id: string | null;
}

export interface TaskStatusResult {
  status: Status;
  output?: Record<string, unknown>;
  error?: string;
}

export const ProjectContextSchema = z.object({
  nodes: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      data: z.record(z.unknown()),
      position: z.object({ x: z.number().default(0), y: z.number().default(0) }),
      parentId: z.string().nullish(),
    })
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      type: z.string().nullish(),
    })
  ),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
