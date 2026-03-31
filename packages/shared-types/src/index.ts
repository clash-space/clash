/**
 * @file index.ts
 * @description Main entry point for shared type definitions used across Frontend and Backend.
 * @module packages.shared-types.src
 *
 * @responsibility
 * - Exports all Zod schemas and TypeScript types used across the monorepo
 * - Acts as the Single Source of Truth for API contracts and Data Models
 * - Categorizes types into Canvas, Task, Model, and Pipeline domains
 *
 * @exports
 * - *Schema: Zod schemas for runtime validation
 * - type *: TypeScript type definitions inferred from Zod
 */

// Canvas types + constants (single source of truth)
export {
  // Schemas
  PositionSchema,
  NodeStatusSchema,
  NodeDataSchema,
  CanvasNodeSchema,
  CanvasEdgeSchema,
  LoroDocumentStateSchema,
  NodeInfoSchema,
  EdgeInfoSchema,
  ProjectContextSchema,
  // ReactFlow types
  RF_NODE_TYPE,
  ACTION_TYPE,
  AGENT_NODE_TYPE_MAP,
  // Agent-facing types
  NodeType,
  ALL_NODE_TYPES,
  CONTENT_NODE_TYPES,
  GENERATION_NODE_TYPES,
  isGenerationNodeType,
  FrontendNodeType,
  ProposalType,
  TaskStatus,
  AssetStatus,
  // Custom actions
  CustomActionParameterSchema,
  CustomActionSecretSchema,
  CustomActionDefinitionSchema,
  isCustomActionType,
  getCustomActionId,
  // Builders
  buildPendingAssetNode,
  // TypeScript types
  type Position,
  type NodeStatus,
  type NodeData,
  type CanvasNode,
  type CanvasEdge,
  type LoroDocumentState,
  type BuildPendingAssetNodeInput,
  type PendingAssetNode,
  type ContentNodeType,
  type GenerationNodeType,
  type EdgeInfo,
  type ProjectContext,
  type CustomActionDefinition,
  type CustomActionParameter,
  type CustomActionSecret,
} from './canvas';

// Task types (atomic tasks + DO state)
export {
  AtomicTaskTypeSchema,
  ImageGenParamsSchema,
  VideoGenParamsSchema,
  DescriptionParamsSchema,
  AtomicTaskRequestSchema,
  AtomicTaskResultSchema,
  DOStepStatusSchema,
  DOStateSchema,
  type AtomicTaskType,
  type ImageGenParams,
  type VideoGenParams,
  type DescriptionParams,
  type AtomicTaskRequest,
  type AtomicTaskResult,
  type DOStepStatus,
  type DOState,
} from './tasks';

// Model metadata
export {
  ModelKindSchema,
  ModelParameterTypeSchema,
  ModelParameterSchema,
  ModelInputRuleSchema,
  ModelCardSchema,
  MODEL_CARDS,
  resolveAspectRatio,
  type ModelInputRule,
  type ModelKind,
  type ModelParameterType,
  type ModelParameter,
  type ModelCard,
} from './models';

// Loro CRDT operations (runtime only — types come from ./canvas)
export {
  listNodes,
  readNode,
  insertNode,
  insertEdge,
  listEdges,
  createNode,
  searchNodes,
  findNodeByIdOrAssetId,
  getNodeStatus,
  deleteNode,
  updateNode,
  type BroadcastFn,
  type NodeInfo,
  type CreateNodeResult,
  type TaskStatusResult,
} from './loro-operations';

// Loro sync client
export { LoroSyncClient } from './loro-client';
export type { LoroSyncClientOptions } from './loro-client';

// Collaboration visibility (presence + activity)
export * from './presence';

// Pipeline types
export {
  AssetStatusSchema,
  TaskStateSchema,
  PipelineTaskDefSchema,
  SuperstepDefSchema,
  PipelineDefSchema,
  TaskRuntimeStateSchema,
  PipelineRuntimeStateSchema,
  type AssetStatus as AssetStatusType,
  type TaskState,
  type PipelineTaskDef,
  type SuperstepDef,
  type PipelineDef,
  type TaskRuntimeState,
  type PipelineRuntimeState,
} from './pipeline';
