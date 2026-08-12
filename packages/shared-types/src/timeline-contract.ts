/**
 * Side-effect-free public entrypoint for Timeline DSL discovery and validation.
 *
 * Keep this boundary independent from Loro/project persistence so standalone
 * CLI and MCP bundles can embed the contract without loading CRDT/WASM code.
 */
export * from "./timeline-field-annotations.js";
export * from "./timeline-operation-annotations.js";
export * from "./timeline-keyframes.js";
export * from "./timeline-mask.js";
export * from "./timeline-from-expression.js";
export {
  TIMELINE_DSL_DEFINITION,
  TIMELINE_DSL_SEMANTIC_RULES,
  TIMELINE_MASK_KEYFRAMES_DSL_EXAMPLE,
  TimelineDslItemSchema,
  TimelineDslSchema,
  TimelineDslTrackSchema,
  timelineMaskKeyframeSemanticIssues,
  validateTimelineDsl,
  type TimelineDslDefinition,
  type TimelineDslValidationIssue,
  type TimelineDslValidationResult,
  type TimelineMaskKeyframeSemanticIssue,
} from "./timeline-dsl-schema.js";
export {
  TIMELINE_DSL_GLOBAL_SEMANTIC_RULES,
  timelineDslSemanticIssues,
  type TimelineDslSemanticIssue,
} from "./timeline-dsl-semantics.js";
