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
  EDIT_KIND,
  AGENT_NODE_TYPE_MAP,
  // Edit-node param schemas
  CropRectSchema,
  ImageEditParamsSchema,
  VideoClipParamsSchema,
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
  // Validation & Builders
  validateGenerationInput,
  buildPendingAssetNode,
  // TypeScript types
  type Position,
  type NodeStatus,
  type NodeData,
  type CanvasNode,
  type CanvasEdge,
  type LoroDocumentState,
  type ValidateGenerationInput,
  type BuildPendingAssetNodeInput,
  type PendingAssetNode,
  type ContentNodeType,
  type GenerationNodeType,
  type EditKind,
  type CropRect,
  type ImageEditParams,
  type VideoClipParams,
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
  UnderstandParamsSchema,
  AtomicTaskRequestSchema,
  AtomicTaskResultSchema,
  DOStepStatusSchema,
  DOStateSchema,
  type AtomicTaskType,
  type ImageGenParams,
  type VideoGenParams,
  type DescriptionParams,
  type UnderstandParams,
  type AtomicTaskRequest,
  type AtomicTaskResult,
  type DOStepStatus,
  type DOState,
} from './tasks';

// Model capability — single derivation, all consumers read fields off the
// returned profile. See model-capabilities.ts for the rationale.
export {
  capability,
  validateRefs,
  partitionRefs,
  pickDefaultModel,
  type Modality,
  type RefBound,
  type Capability,
  type RefNodeLike,
  type RefPartition,
} from './model-capabilities';

// Model metadata
export {
  ModelKindSchema,
  ModelParameterTypeSchema,
  ModelParameterSchema,
  ModelInputModeSchema,
  ModelInputRuleSchema,
  ModelCardSchema,
  MODEL_CARDS,
  resolveAspectRatio,
  snapAspectRatio,
  type ModelInputMode,
  type ModelInputRule,
  type ModelKind,
  type ModelParameterType,
  type ModelParameter,
  type ModelCard,
} from './models';

// Canvas operations class
export { Canvas } from './canvas-ops';
export type {
  ExecuteGenerationResult,
} from './canvas-ops';

// Re-export types from Canvas for convenience
export type {
  BroadcastFn,
  NodeInfo,
  CreateNodeResult,
  CreateLinkedNodeResult,
  TaskStatusResult,
} from './canvas-ops';

// Loro sync client
export { LoroSyncClient } from './loro-client';
export type { LoroSyncClientOptions } from './loro-client';

// Prompt parsing (mixed-modality @-mentions)
export {
  parsePromptParts,
  extractPromptText,
  normalizePromptInput,
  composePromptWithTextRefs,
  extractAssetRefs,
  buildMention,
  hasAssetMentions,
  type PromptPart,
  type AssetRef,
} from './prompt';

// Collaboration visibility (presence + activity)
export * from './presence';

// Timeline YAML projection (agent-facing surface)
export {
  timelineDslToYaml,
  timelineDslFromYaml,
  timelineDslHash,
  parseFromExpression,
  resolveFromExpression,
} from './timeline-yaml';
export type {
  ResolvedTimelineDsl,
  ResolvedItem,
  ResolvedTrack,
  FromExpression,
  FromYamlResult,
} from './timeline-yaml';

// Asset metadata (D1 assets + asset_refs tables)
export {
  AssetKindSchema,
  AssetMetadataSchema,
  AssetSourceSchema,
  AssetSchema,
  AssetRefRowSchema,
  type AssetKind,
  type AssetMetadata,
  type AssetSource,
  type Asset,
  type AssetRefRow,
} from './assets';

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
