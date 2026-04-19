import { z } from 'zod';

export const ModelKindSchema = z.enum(['image', 'video', 'audio']);
export type ModelKind = z.infer<typeof ModelKindSchema>;

/**
 * Nano Banana 2 aspect ratios (fal.ai)
 */
export const NANO_BANANA_ASPECT_RATIOS = [
  { label: '1:1', value: '1:1' },
  { label: '2:3', value: '2:3' },
  { label: '3:2', value: '3:2' },
  { label: '3:4', value: '3:4' },
  { label: '4:3', value: '4:3' },
  { label: '4:5', value: '4:5' },
  { label: '5:4', value: '5:4' },
  { label: '9:16', value: '9:16' },
  { label: '16:9', value: '16:9' },
  { label: '21:9', value: '21:9' },
] as const;

/**
 * Nano Banana 2 resolutions (fal.ai)
 */
export const NANO_BANANA_RESOLUTIONS = [
  { label: '0.5K (Draft)', value: '0.5K' },
  { label: '1K (Fast)', value: '1K' },
  { label: '2K (Balanced)', value: '2K' },
  { label: '4K (High Quality)', value: '4K' },
] as const;

/**
 * Sora 2 aspect ratios (fal.ai)
 */
export const SORA_ASPECT_RATIOS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
] as const;

/**
 * FLUX aspect ratios (fal.ai) — mapped to fal image_size values
 */
export const FLUX_ASPECT_RATIOS = [
  { label: '16:9', value: 'landscape_16_9' },
  { label: '9:16', value: 'portrait_16_9' },
  { label: '1:1', value: 'square_hd' },
  { label: '4:3', value: 'landscape_4_3' },
  { label: '3:4', value: 'portrait_4_3' },
] as const;

/**
 * Kling aspect ratios (fal.ai)
 */
export const KLING_ASPECT_RATIOS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
] as const;

/**
 * Veo 3 aspect ratios (fal.ai)
 */
export const VEO3_ASPECT_RATIOS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
] as const;

/**
 * Imagen 4 aspect ratios (Google native)
 */
export const IMAGEN_ASPECT_RATIOS = [
  { label: '16:9', value: '16:9' },
  { label: '9:16', value: '9:16' },
  { label: '1:1', value: '1:1' },
  { label: '4:3', value: '4:3' },
  { label: '3:4', value: '3:4' },
] as const;

/**
 * Recraft V4 aspect ratios — mapped to fal image_size values
 */
export const RECRAFT_ASPECT_RATIOS = [
  { label: '1:1 HD', value: 'square_hd' },
  { label: '1:1', value: 'square' },
  { label: '4:3', value: 'landscape_4_3' },
  { label: '16:9', value: 'landscape_16_9' },
  { label: '3:4', value: 'portrait_4_3' },
  { label: '9:16', value: 'portrait_16_9' },
] as const;

/**
 * FLUX 2 Pro aspect ratios — mapped to fal image_size values
 */
export const FLUX2_ASPECT_RATIOS = [
  { label: '1:1 HD', value: 'square_hd' },
  { label: '1:1', value: 'square' },
  { label: '4:3', value: 'landscape_4_3' },
  { label: '16:9', value: 'landscape_16_9' },
  { label: '3:4', value: 'portrait_4_3' },
  { label: '9:16', value: 'portrait_16_9' },
] as const;

/**
 * Seedance 2.0 aspect ratios — passed directly (no mapping needed).
 */
export const SEEDANCE_ASPECT_RATIOS = [
  { label: 'Auto', value: 'auto' },
  { label: '21:9', value: '21:9' },
  { label: '16:9', value: '16:9' },
  { label: '4:3', value: '4:3' },
  { label: '1:1', value: '1:1' },
  { label: '3:4', value: '3:4' },
  { label: '9:16', value: '9:16' },
] as const;

export const ModelParameterTypeSchema = z.enum(['select', 'slider', 'number', 'text', 'boolean']);
export type ModelParameterType = z.infer<typeof ModelParameterTypeSchema>;

/**
 * Provider configuration for models
 */
export const ProviderSchema = z.enum(['official', 'kie']);
export type Provider = z.infer<typeof ProviderSchema>;

export const ModelProviderConfigSchema = z.object({
  model_id: z.string(),
  provider: ProviderSchema,
  default: z.boolean().default(false),
});
export type ModelProviderConfig = z.infer<typeof ModelProviderConfigSchema>;

export const ModelParameterSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: ModelParameterTypeSchema,
  description: z.string().optional(),
  required: z.boolean().default(false),
  options: z
    .array(
      z.object({
        label: z.string(),
        value: z.union([z.string(), z.number()]),
      })
    )
    .optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ModelParameter = z.infer<typeof ModelParameterSchema>;

/**
 * Input shape a model accepts. Each declared field is an independent input
 * "modality" with its own UI render unit + provider adapter mapping.
 * Adding a new modality is three places: schema field here, a strip component,
 * and a provider mapping. No discriminated union, no exhaustive switches.
 *
 * Examples:
 *   text-to-X                      {}
 *   single image required          { images: { max: 1, min: 1 } }
 *   multi image (Nano Banana)      { images: { max: 8 } }
 *   first/last frame (Kling 2.5)   { startEnd: {} }
 *   Seedance ref-to-video          { images:{max:9}, videos:{max:3}, audios:{max:3} }
 *   future audio-driven video      { images:{max:1, min:1}, audios:{max:1, min:1} }
 *
 * `startEnd` always means the standard convention: first frame required,
 * last frame optional. No real-world model breaks that pattern; if one
 * shows up, add a config field on the {} then.
 */
const RefSpecSchema = z.object({
  max: z.number().int().positive(),
  min: z.number().int().nonnegative().optional(),
});

export const ModelInputModeSchema = z.object({
  images: RefSpecSchema.optional(),
  videos: RefSpecSchema.optional(),
  audios: RefSpecSchema.optional(),
  startEnd: z.object({}).passthrough().optional(),
});
export type ModelInputMode = z.infer<typeof ModelInputModeSchema>;

export const ModelInputRuleSchema = z.object({
  requiresPrompt: z.boolean().default(true),
  inputMode: ModelInputModeSchema.default({}),
  /** Modalities that can be @-mentioned inline in the prompt editor.
   *  Does NOT affect form-field inputs (start/end frames, etc.) */
  promptModalities: z.array(z.enum(['text', 'image', 'video', 'audio'])).default(['text']),
});
export type ModelInputRule = z.infer<typeof ModelInputRuleSchema>;

export const ModelCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  provider: z.string(),
  kind: ModelKindSchema,
  description: z.string().optional(),
  parameters: z.array(ModelParameterSchema),
  defaultParams: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
  /**
   * Canonical default aspect ratio in our format ("4:3", "16:9", etc.).
   * Required for image and video models. Audio models use "1:1" as placeholder.
   * This is OUR representation — provider-specific values live in parameters/defaultParams.
   */
  defaultAspectRatio: z.string().default('16:9'),
  /**
   * Maps our canonical aspect ratio ("4:3") → provider-specific param value ("landscape_4_3").
   * The key of the provider param in defaultParams (e.g. "aspect_ratio" or "image_size").
   * If the provider uses the same format as ours, the mapping is identity.
   */
  aspectRatioParam: z.string().optional(),
  input: ModelInputRuleSchema.default({ requiresPrompt: true, inputMode: {}, promptModalities: ['text'] }),
  availableProviders: z.array(ProviderSchema).optional(),
  defaultProvider: ProviderSchema.optional(),
  /**
   * Upper bound (ms) for a healthy run. NodeProcessor marks a workflow Failed if
   * engine status is still "running" past this point (orphan from miniflare
   * hot-reload, hung provider, etc). Set generously above the 99th-percentile
   * run so legitimately slow jobs never get misclassified.
   */
  maxRuntimeMs: z.number().int().positive().optional(),
});
export type ModelCard = z.infer<typeof ModelCardSchema>;

/**
 * Resolve the canonical aspect ratio from model-specific params.
 * Uses the model's parameter options to reverse-map provider values to our format.
 *
 * e.g. FLUX:        image_size="landscape_4_3" → "4:3"
 *      Nano Banana:  aspect_ratio="16:9"       → "16:9"
 */
export function resolveAspectRatio(
  modelId: string,
  modelParams: Record<string, string | number | boolean>,
): string {
  const card = MODEL_CARDS.find(c => c.id === modelId);
  if (!card) return '16:9';

  // Find the aspect ratio parameter (by aspectRatioParam or fallback to 'aspect_ratio')
  const paramId = card.aspectRatioParam || 'aspect_ratio';
  const arParam = card.parameters.find(p => p.id === paramId);
  if (!arParam) return card.defaultAspectRatio;

  // Get current value from modelParams
  const value = modelParams[paramId];
  if (!value) return card.defaultAspectRatio;

  // If value is already canonical format (N:M), return directly
  if (typeof value === 'string' && /^\d+:\d+$/.test(value)) return value;

  // Reverse-lookup: provider value → our label
  const option = arParam.options?.find(o => o.value === value);
  return option?.label ?? card.defaultAspectRatio;
}

export const MODEL_CARDS: ModelCard[] = [
  // ─── Image: Nano Banana 2 (fal.ai) ──────────────────────────
  {
    id: 'nano-banana-2',
    name: 'Nano Banana 2',
    provider: 'fal.ai',
    kind: 'image',
    defaultAspectRatio: '16:9',
    description: 'State-of-the-art fast image generation and editing.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: NANO_BANANA_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'resolution',
        label: 'Resolution',
        type: 'select',
        options: NANO_BANANA_RESOLUTIONS.map(s => ({ label: s.label, value: s.value })),
        defaultValue: '1K',
      },
      {
        id: 'count',
        label: 'Count',
        type: 'number',
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1,
        description: 'How many images to generate.',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
      resolution: '1K',
      count: 1,
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 8 } }, promptModalities: ['text', 'image'] },
  },

  // ─── Image: FLUX Schnell (fal.ai) ────────────────────────────
  {
    id: 'flux-schnell',
    name: 'FLUX Schnell',
    provider: 'fal.ai',
    kind: 'image',
    defaultAspectRatio: '16:9',
    aspectRatioParam: 'image_size',
    description: 'Ultra-fast image generation, ~1s per image.',
    parameters: [
      {
        id: 'image_size',
        label: 'Aspect Ratio',
        type: 'select',
        options: FLUX_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: 'landscape_16_9',
      },
      {
        id: 'num_inference_steps',
        label: 'Steps',
        type: 'number',
        min: 1,
        max: 12,
        step: 1,
        defaultValue: 4,
        description: 'More steps = higher quality but slower.',
      },
      {
        id: 'count',
        label: 'Count',
        type: 'number',
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1,
      },
    ],
    defaultParams: {
      image_size: 'landscape_16_9',
      num_inference_steps: 4,
      count: 1,
    },
    input: { requiresPrompt: true, inputMode: {} },
  },

  // ─── Image: FLUX Dev (fal.ai) ────────────────────────────────
  {
    id: 'flux-dev',
    name: 'FLUX Dev',
    provider: 'fal.ai',
    kind: 'image',
    defaultAspectRatio: '16:9',
    aspectRatioParam: 'image_size',
    description: 'High-quality image generation with great prompt following.',
    parameters: [
      {
        id: 'image_size',
        label: 'Aspect Ratio',
        type: 'select',
        options: FLUX_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: 'landscape_16_9',
      },
      {
        id: 'num_inference_steps',
        label: 'Steps',
        type: 'number',
        min: 1,
        max: 50,
        step: 1,
        defaultValue: 28,
        description: 'More steps = higher quality but slower.',
      },
      {
        id: 'guidance_scale',
        label: 'Guidance Scale',
        type: 'slider',
        min: 1,
        max: 20,
        step: 0.5,
        defaultValue: 3.5,
        description: 'How closely to follow the prompt.',
      },
      {
        id: 'count',
        label: 'Count',
        type: 'number',
        min: 1,
        max: 4,
        step: 1,
        defaultValue: 1,
      },
    ],
    defaultParams: {
      image_size: 'landscape_16_9',
      num_inference_steps: 28,
      guidance_scale: 3.5,
      count: 1,
    },
    input: { requiresPrompt: true, inputMode: {} },
  },

  // ─── Video: Sora 2 (fal.ai) ─────────────────────────────────
  {
    // Single card — provider auto-routes to /text-to-video or /image-to-video.
    id: 'sora-2',
    name: 'Sora 2',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'OpenAI Sora 2 — text-to-video or animate a still image.',
    parameters: [
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        options: [
          { label: '4s', value: 4 },
          { label: '8s', value: 8 },
          { label: '12s', value: 12 },
          { label: '16s', value: 16 },
          { label: '20s', value: 20 },
        ],
        defaultValue: 4,
      },
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: SORA_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'resolution',
        label: 'Resolution',
        type: 'select',
        options: [
          { label: '720p', value: '720p' },
          { label: '1080p', value: '1080p' },
        ],
        defaultValue: '720p',
      },
    ],
    defaultParams: {
      duration: 4,
      aspect_ratio: '16:9',
      resolution: '720p',
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } } },
  },

  // ─── Video: Seedance 2.0 (ByteDance via fal.ai) ────────────
  // Single card — provider (fal-video) auto-routes between `/text-to-video` and
  // `/image-to-video` based on whether a reference image is attached.
  // The `/image-to-video` endpoint also accepts an optional `end_image_url`;
  // that'll be exposed once the ModelInputMode refactor adds `first_last` UI.
  {
    id: 'seedance-2',
    name: 'Seedance 2.0',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'ByteDance Seedance 2.0 — text-to-video or animate a still image, with optional native audio.',
    parameters: [
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        options: [
          { label: 'Auto', value: 'auto' },
          { label: '4s', value: 4 },
          { label: '6s', value: 6 },
          { label: '8s', value: 8 },
          { label: '10s', value: 10 },
          { label: '15s', value: 15 },
        ],
        defaultValue: 'auto',
      },
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: SEEDANCE_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'resolution',
        label: 'Resolution',
        type: 'select',
        options: [
          { label: '480p', value: '480p' },
          { label: '720p', value: '720p' },
        ],
        defaultValue: '720p',
      },
      {
        id: 'generate_audio',
        label: 'Native audio',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    defaultParams: {
      duration: 'auto',
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } } },
  },

  // ─── Video: Kling 2.1 (fal.ai) ──────────────────────────────
  // Single card — provider auto-routes to /text-to-video or /image-to-video.
  {
    id: 'kling-2.1',
    name: 'Kling 2.1',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Kling 2.1 — fast, cinematic video generation, text or image input.',
    parameters: [
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        options: [
          { label: '5s', value: '5' },
          { label: '10s', value: '10' },
        ],
        defaultValue: '5',
      },
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: KLING_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
    ],
    defaultParams: {
      duration: '5',
      aspect_ratio: '16:9',
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } } },
  },

  // ─── Image: Recraft V4 Pro (fal.ai) ──────────────────────────
  {
    id: 'recraft-v4',
    name: 'Recraft V4',
    provider: 'fal.ai',
    kind: 'image',
    defaultAspectRatio: '16:9',
    aspectRatioParam: 'image_size',
    description: 'Designer-grade image generation with color control and text rendering.',
    parameters: [
      {
        id: 'image_size',
        label: 'Aspect Ratio',
        type: 'select',
        options: RECRAFT_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: 'square_hd',
      },
    ],
    defaultParams: {
      image_size: 'square_hd',
    },
    input: { requiresPrompt: true, inputMode: {} },
  },

  // ─── Image: FLUX 2 Pro (fal.ai) ──────────────────────────────
  {
    id: 'flux-2-pro',
    name: 'FLUX 2 Pro',
    provider: 'fal.ai',
    kind: 'image',
    defaultAspectRatio: '4:3',
    aspectRatioParam: 'image_size',
    description: 'Latest FLUX flagship — high-quality image generation.',
    parameters: [
      {
        id: 'image_size',
        label: 'Aspect Ratio',
        type: 'select',
        options: FLUX2_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: 'landscape_4_3',
      },
      {
        id: 'safety_tolerance',
        label: 'Safety Tolerance',
        type: 'select',
        options: [
          { label: 'Strict (1)', value: '1' },
          { label: 'Moderate (2)', value: '2' },
          { label: 'Balanced (3)', value: '3' },
          { label: 'Relaxed (4)', value: '4' },
          { label: 'Permissive (5)', value: '5' },
        ],
        defaultValue: '2',
      },
    ],
    defaultParams: {
      image_size: 'landscape_4_3',
      safety_tolerance: '2',
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 8 } }, promptModalities: ['text', 'image'] },
  },

  // ─── Video: Veo 3 (fal.ai) ───────────────────────────────────
  {
    // Single card — provider auto-routes to /text-to-video or /image-to-video.
    // veo3-fast stays separate (different model variant, not just a different endpoint).
    id: 'veo3',
    name: 'Veo 3',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3 — text-to-video or animate a still image, with audio.',
    parameters: [
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        options: [
          { label: '4s', value: '4s' },
          { label: '6s', value: '6s' },
          { label: '8s', value: '8s' },
        ],
        defaultValue: '8s',
      },
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: VEO3_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'resolution',
        label: 'Resolution',
        type: 'select',
        options: [
          { label: '720p', value: '720p' },
          { label: '1080p', value: '1080p' },
        ],
        defaultValue: '720p',
      },
      {
        id: 'generate_audio',
        label: 'Generate Audio',
        type: 'boolean',
        defaultValue: true,
        description: 'Include synthesized audio in the video.',
      },
    ],
    defaultParams: {
      duration: '8s',
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } } },
  },
  {
    id: 'veo3-fast-text-to-video',
    name: 'Veo 3 Fast (Text)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3 fast text-to-video — faster and more affordable.',
    parameters: [
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        options: [
          { label: '4s', value: '4s' },
          { label: '6s', value: '6s' },
          { label: '8s', value: '8s' },
        ],
        defaultValue: '8s',
      },
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: VEO3_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'resolution',
        label: 'Resolution',
        type: 'select',
        options: [
          { label: '720p', value: '720p' },
          { label: '1080p', value: '1080p' },
        ],
        defaultValue: '720p',
      },
      {
        id: 'generate_audio',
        label: 'Generate Audio',
        type: 'boolean',
        defaultValue: true,
        description: 'Include synthesized audio in the video.',
      },
    ],
    defaultParams: {
      duration: '8s',
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: {} },
  },

  // ─── Image: Gemini Image (Google Vertex) ────────────────────

  {
    id: 'gemini-flash-image',
    name: 'Gemini Flash Image',
    provider: 'Google',
    kind: 'image',
    defaultAspectRatio: '16:9',
    description: 'Gemini 2.5 Flash — fast image generation with text understanding.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: IMAGEN_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } }, promptModalities: ['text', 'image'] },
  },
  {
    id: 'gemini-flash-image-2',
    name: 'Gemini Flash Image 2',
    provider: 'Google',
    kind: 'image',
    defaultAspectRatio: '16:9',
    description: 'Gemini 3.1 Flash Image — latest fast image generation and editing.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: IMAGEN_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } }, promptModalities: ['text', 'image'] },
  },
  {
    id: 'gemini-pro-image',
    name: 'Gemini Pro Image',
    provider: 'Google',
    kind: 'image',
    defaultAspectRatio: '16:9',
    description: 'Gemini 3 Pro Image — highest quality image generation.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: IMAGEN_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
    },
    input: { requiresPrompt: true, inputMode: { images: { max: 1 } }, promptModalities: ['text', 'image'] },
  },

  // ─── Image: Imagen 4 (Google native via Vercel AI SDK) ──────

  {
    id: 'imagen-4',
    name: 'Imagen 4',
    provider: 'Google',
    kind: 'image',
    defaultAspectRatio: '16:9',
    description: 'Google Imagen 4 — high-quality image generation.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: IMAGEN_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
    },
    input: { requiresPrompt: true, inputMode: {} },
  },
  {
    id: 'imagen-4-fast',
    name: 'Imagen 4 Fast',
    provider: 'Google',
    kind: 'image',
    defaultAspectRatio: '16:9',
    description: 'Google Imagen 4 Fast — faster generation, same quality.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: IMAGEN_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
    },
    input: { requiresPrompt: true, inputMode: {} },
  },

  // ─── Video: Veo 3.1 (Google native via Vercel AI SDK) ──────

  {
    id: 'veo-3.1',
    name: 'Veo 3.1',
    provider: 'Google',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3.1 — state-of-the-art video generation with native audio.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: VEO3_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'generate_audio',
        label: 'Generate Audio',
        type: 'boolean',
        defaultValue: true,
        description: 'Include natively generated audio.',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: {} },
  },
  {
    id: 'veo-3.1-lite',
    name: 'Veo 3.1 Lite',
    provider: 'Google',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3.1 Lite — cost-effective video generation at same speed.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: VEO3_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'generate_audio',
        label: 'Generate Audio',
        type: 'boolean',
        defaultValue: true,
        description: 'Include natively generated audio.',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: {} },
  },
  {
    id: 'veo-3.1-fast',
    name: 'Veo 3.1 Fast',
    provider: 'Google',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3.1 Fast — high-speed video generation.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: VEO3_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'generate_audio',
        label: 'Generate Audio',
        type: 'boolean',
        defaultValue: true,
        description: 'Include natively generated audio.',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: {} },
  },

  // ─── Audio ───────────────────────────────────────────────────
  {
    id: 'minimax-tts',
    name: 'MiniMax TTS',
    provider: 'MiniMax',
    kind: 'audio',
    defaultAspectRatio: '1:1',
    description: 'High-quality Chinese and English text-to-speech.',
    parameters: [
      {
        id: 'voice_id',
        label: 'Voice',
        type: 'select',
        options: [
          { label: 'Female - Warm', value: 'female-warm' },
          { label: 'Female - Energetic', value: 'female-energetic' },
          { label: 'Male - Calm', value: 'male-calm' },
          { label: 'Male - Storyteller', value: 'male-storyteller' },
        ],
        defaultValue: 'female-warm',
      },
      {
        id: 'speed',
        label: 'Speed',
        type: 'slider',
        min: 0.5,
        max: 2.0,
        step: 0.1,
        defaultValue: 1.0,
        description: 'Speech speed multiplier',
      },
      {
        id: 'pitch',
        label: 'Pitch',
        type: 'slider',
        min: -12,
        max: 12,
        step: 1,
        defaultValue: 0,
        description: 'Voice pitch adjustment (semitones)',
      },
    ],
    defaultParams: {
      voice_id: 'female-warm',
      speed: 1.0,
      pitch: 0,
    },
    input: { requiresPrompt: true, inputMode: {} },
  },
  {
    id: 'elevenlabs-tts',
    name: 'ElevenLabs TTS',
    provider: 'ElevenLabs',
    kind: 'audio',
    defaultAspectRatio: '1:1',
    description: 'Ultra-realistic voice synthesis with emotional range.',
    parameters: [
      {
        id: 'voice_id',
        label: 'Voice',
        type: 'select',
        options: [
          { label: 'Rachel - Calm', value: 'rachel' },
          { label: 'Drew - Professional', value: 'drew' },
          { label: 'Clyde - Warm', value: 'clyde' },
          { label: 'Paul - Narrator', value: 'paul' },
        ],
        defaultValue: 'rachel',
      },
      {
        id: 'model_id',
        label: 'Model',
        type: 'select',
        options: [
          { label: 'Multilingual v2', value: 'eleven_multilingual_v2' },
          { label: 'English v2', value: 'eleven_monolingual_v1' },
          { label: 'Turbo v2', value: 'eleven_turbo_v2' },
        ],
        defaultValue: 'eleven_multilingual_v2',
      },
      {
        id: 'stability',
        label: 'Stability',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
        description: 'Voice consistency (0=variable, 1=stable)',
      },
      {
        id: 'similarity_boost',
        label: 'Similarity',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.75,
        description: 'How closely to match the original voice',
      },
    ],
    defaultParams: {
      voice_id: 'rachel',
      model_id: 'eleven_multilingual_v2',
      stability: 0.5,
      similarity_boost: 0.75,
    },
    input: { requiresPrompt: true, inputMode: {} },
    availableProviders: ['official', 'kie'],
    defaultProvider: 'official',
  },
] as unknown as ModelCard[];
