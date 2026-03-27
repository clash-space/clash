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

// Canvas types
export {
  PositionSchema,
  NodeStatusSchema,
  NodeDataSchema,
  CanvasNodeSchema,
  CanvasEdgeSchema,
  LoroDocumentStateSchema,
  RF_NODE_TYPE,
  ACTION_TYPE,
  AGENT_NODE_TYPE_MAP,
  buildPendingAssetNode,
  type Position,
  type NodeStatus,
  type NodeData,
  type CanvasNode,
  type CanvasEdge,
  type LoroDocumentState,
  type BuildPendingAssetNodeInput,
  type PendingAssetNode,
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

// Pipeline types
export {
  AssetStatusSchema,
  TaskStateSchema,
  PipelineTaskDefSchema,
  SuperstepDefSchema,
  PipelineDefSchema,
  TaskRuntimeStateSchema,
  PipelineRuntimeStateSchema,
  type AssetStatus,
  type TaskState,
  type PipelineTaskDef,
  type SuperstepDef,
  type PipelineDef,
  type TaskRuntimeState,
  type PipelineRuntimeState,
} from './pipeline';
