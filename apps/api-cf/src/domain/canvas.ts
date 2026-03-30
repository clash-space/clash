/**
 * Re-export all domain types from @clash/shared-types.
 * This file is kept for backward compatibility with existing imports.
 */
export {
  NodeType,
  ALL_NODE_TYPES,
  CONTENT_NODE_TYPES,
  GENERATION_NODE_TYPES,
  isGenerationNodeType,
  FrontendNodeType,
  ProposalType,
  TaskStatus,
  NodeInfoSchema,
  EdgeInfoSchema,
  ProjectContextSchema,
} from "@clash/shared-types";

// AssetStatus as const object (pipeline exports it as Zod type)
export const AssetStatus = {
  Pending: "pending",
  Processing: "processing",
  Completed: "completed",
  Failed: "failed",
} as const;

export type {
  NodeType as NodeTypeType,
  ContentNodeType,
  GenerationNodeType,
  ProposalType as ProposalTypeType,
  TaskStatus as TaskStatusType,
  NodeInfo,
  EdgeInfo,
  CreateNodeResult,
  TaskStatusResult,
  ProjectContext,
} from "@clash/shared-types";

// Backward-compat alias: older code uses `Status` instead of `TaskStatus`
export { TaskStatus as Status } from "@clash/shared-types";

// Re-export from shared-types for convenience (used by agents/tools)
export { RF_NODE_TYPE, ACTION_TYPE, AGENT_NODE_TYPE_MAP } from "@clash/shared-types";

import { RF_NODE_TYPE, ACTION_TYPE } from "@clash/shared-types";

/**
 * Check if a Loro node is a generation node.
 * Loro stores type as "action-badge" with actionType in data.
 */
export function isGenerationNode(node: { type: string; data?: Record<string, unknown> }): boolean {
  if (node.type === RF_NODE_TYPE.ActionBadge) {
    const at = node.data?.actionType as string | undefined;
    return at === ACTION_TYPE.ImageGen || at === ACTION_TYPE.VideoGen;
  }
  return false;
}
