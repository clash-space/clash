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

  // ─── Input resources (4 orthogonal categories) ────────────────────
  // NodeProcessor maps Loro node ref arrays into these slots based purely
  // on inputMode shape (startEnd vs images vs videos vs audios). Providers
  // own the wire mapping — e.g. Veo decides whether referenceImageR2Keys[0]
  // becomes Vertex `inst.image` (i2v anchor) or `inst.referenceImages[]`
  // (multi-subject) based on its model id.

  /** startEnd: first frame anchor */
  startFrameR2Key?: string;
  /** startEnd: last frame anchor */
  endFrameR2Key?: string;
  /** Flat list of reference images. Used when promptParts isn't provided. */
  referenceImageR2Keys?: string[];
  /** Flat list of reference videos. */
  referenceVideoR2Keys?: string[];
  /** Flat list of reference audios. */
  referenceAudioR2Keys?: string[];

  // ─── Other generation params ──────────────────────────────────────
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

  /**
   * Lineage — pre-built `assets.sources` rows describing which upstream
   * assets contributed to this generation. The workflow forwards this to
   * `createAsset` on success, so old assets without lineage stay null.
   *
   * NodeProcessor builds it from the Loro pending node's `referenceImageAssetIds`
   * etc. fields (parallel to the URL arrays). Frontend-direct callers
   * (legacy /api/generate/*) currently leave it undefined.
   */
  sources?: Array<{
    assetId: string;
    role: 'primary' | 'reference' | 'edit-source';
  }>;
}
