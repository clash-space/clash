/**
 * GenerationParams — discriminated by `type`. The workflow dispatcher reads
 * `type` + `modelName` to pick a provider; the provider reads only the fields
 * it actually needs.
 */

export interface GenerationParams {
  taskId: string;
  nodeId: string;
  projectId: string;
  type:
    | "image_gen"
    | "video_gen"
    | "audio_gen"
    | "text_gen"
    | "video_render"
    | "image_desc"
    | "video_desc"
    | "custom_action"
    | "understand";

  prompt?: string;
  systemPrompt?: string;
  aspectRatio?: string;
  modelName?: string;
  modelParams?: Record<string, unknown>;

  /** Ordered prompt parts preserving text + image_ref interleaving. */
  promptParts?: Array<{ type: string; text?: string; nodeId?: string; r2Key?: string }>;

  /** Reference images (flat list, used when promptParts isn't provided). */
  referenceR2Keys?: string[];

  /** video_gen: first frame for image-to-video / startEnd.first */
  imageR2Key?: string;
  /** video_gen: last frame for startEnd models */
  tailImageR2Key?: string;
  /** video_gen: multi-modal reference bundle (Seedance ref-to-video etc.) */
  referenceVideoR2Keys?: string[];
  referenceAudioR2Keys?: string[];
  duration?: number;
  cfgScale?: number;
  /** Deprecated alias kept for wire-compat; readers should fall back to modelName. */
  videoModel?: string;

  /** describe / understand */
  r2Key?: string;
  mimeType?: string;
  language?: string;

  /** video_render */
  timelineDsl?: Record<string, unknown>;

  /** custom_action */
  customActionId?: string;
  customActionParams?: Record<string, unknown>;
  workerUrl?: string;
}
