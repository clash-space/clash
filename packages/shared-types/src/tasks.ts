/**
 * Task Types - Zod schemas for AIGC task management
 *
 * Atomic tasks are executed via Cloudflare Workflows.
 * Orchestration (retry, sequencing) is handled by the Workflow engine.
 */

import { z } from 'zod';

// =============================================================================
// Atomic Task Types
// =============================================================================

export const AtomicTaskTypeSchema = z.enum([
  'image_gen',   // Generate image
  'video_gen',   // Generate video
  'description', // Generate description for asset
]);
export type AtomicTaskType = z.infer<typeof AtomicTaskTypeSchema>;

// === Image Generation Params ===
export const ImageGenParamsSchema = z.object({
  prompt: z.string(),
  model: z.string().default('nano-banana-pro'),
  model_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  reference_images: z.array(z.string()).optional(),
  aspect_ratio: z.string().optional(),
});
export type ImageGenParams = z.infer<typeof ImageGenParamsSchema>;

// === Video Generation Params ===
export const VideoGenParamsSchema = z.object({
  prompt: z.string(),
  image_r2_key: z.string().optional(),
  duration: z.union([z.number(), z.string()]).default(5),
  model: z.string().default('kling-image2video'),
  model_params: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  reference_images: z.array(z.string()).optional(),
  reference_mode: z.string().optional(),
  aspect_ratio: z.string().optional(),
  resolution: z.string().optional(),
  negative_prompt: z.string().optional(),
  cfg_scale: z.number().optional(),
});
export type VideoGenParams = z.infer<typeof VideoGenParamsSchema>;

// === Description Generation Params ===
export const DescriptionParamsSchema = z.object({
  r2_key: z.string(),
  mime_type: z.string(),
});
export type DescriptionParams = z.infer<typeof DescriptionParamsSchema>;

// === Discriminated Union for Atomic Task Request ===
export const AtomicTaskRequestSchema = z.discriminatedUnion('task_type', [
  z.object({ task_type: z.literal('image_gen'), params: ImageGenParamsSchema }),
  z.object({ task_type: z.literal('video_gen'), params: VideoGenParamsSchema }),
  z.object({ task_type: z.literal('description'), params: DescriptionParamsSchema }),
]);
export type AtomicTaskRequest = z.infer<typeof AtomicTaskRequestSchema>;

// === Atomic Task Result ===
export const AtomicTaskResultSchema = z.object({
  success: z.boolean(),
  r2_key: z.string().optional(),
  external_task_id: z.string().optional(),
  data: z.record(z.any()).optional(),
  error: z.string().optional(),
});
export type AtomicTaskResult = z.infer<typeof AtomicTaskResultSchema>;

// =============================================================================
// Workflow State Types
// =============================================================================

export const DOStepStatusSchema = z.enum([
  'pending',
  'running',
  'completed',
  'failed',
]);
export type DOStepStatus = z.infer<typeof DOStepStatusSchema>;

export const DOStateSchema = z.object({
  task_id: z.string(),
  project_id: z.string(),
  node_id: z.string(),
  current_step: z.string(),
  step_status: DOStepStatusSchema,
  retry_count: z.number().default(0),
  max_retries: z.number().default(3),
  results: z.record(z.any()).default({}),
  error: z.string().optional(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type DOState = z.infer<typeof DOStateSchema>;
