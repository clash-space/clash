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

export const ModelInputRuleSchema = z.object({
  requiresPrompt: z.boolean().default(true),
  referenceImage: z.enum(['required', 'optional', 'forbidden']).default('optional'),
  referenceMode: z.enum(['none', 'single', 'multi', 'start_end']).default('single'),
  /** Input modalities this model accepts inline in the prompt via @-mentions.
   *  Models with referenceMode 'start_end' should use ['text'] — their images go via form fields. */
  modalities: z.array(z.enum(['text', 'image', 'video', 'audio'])).default(['text']),
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
  input: ModelInputRuleSchema.default({ requiresPrompt: true, referenceImage: 'optional' }),
  availableProviders: z.array(ProviderSchema).optional(),
  defaultProvider: ProviderSchema.optional(),
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
    input: { requiresPrompt: true, referenceImage: 'optional', referenceMode: 'single', modalities: ['text', 'image'] },
  },
  {
    id: 'nano-banana-2-edit',
    name: 'Nano Banana 2 Edit',
    provider: 'fal.ai',
    kind: 'image',
    defaultAspectRatio: '16:9',
    description: 'Edit and composite images with text prompts.',
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
    ],
    defaultParams: {
      aspect_ratio: '16:9',
      resolution: '1K',
    },
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'multi', modalities: ['text', 'image'] },
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },

  // ─── Video: Sora 2 (fal.ai) ─────────────────────────────────
  {
    id: 'sora-2-text-to-video',
    name: 'Sora 2 (Text)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Generate video from text prompts using OpenAI Sora 2.',
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
        ],
        defaultValue: '720p',
      },
    ],
    defaultParams: {
      duration: 4,
      aspect_ratio: '16:9',
      resolution: '720p',
    },
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
  {
    id: 'sora-2-image-to-video',
    name: 'Sora 2 (Image)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Animate a still image into video using Sora 2.',
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
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'single' },
  },

  // ─── Video: Kling 2.1 (fal.ai) ──────────────────────────────
  {
    id: 'kling-2.1-text-to-video',
    name: 'Kling 2.1 (Text)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Fast, cinematic text-to-video generation.',
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
  {
    id: 'kling-2.1-image-to-video',
    name: 'Kling 2.1 (Image)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Animate a still image into cinematic video.',
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
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'single' },
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
  {
    id: 'flux-2-pro-edit',
    name: 'FLUX 2 Pro Edit',
    provider: 'fal.ai',
    kind: 'image',
    defaultAspectRatio: '4:3',
    aspectRatioParam: 'image_size',
    description: 'Edit and transform images using FLUX 2 Pro.',
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
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'multi', modalities: ['text', 'image'] },
  },

  // ─── Video: Veo 3 (fal.ai) ───────────────────────────────────
  {
    id: 'veo3-text-to-video',
    name: 'Veo 3 (Text)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3 text-to-video with audio generation.',
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
  {
    id: 'veo3-image-to-video',
    name: 'Veo 3 (Image)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3 image-to-video — animate a still image.',
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
        options: [
          { label: 'Auto', value: 'auto' },
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
        ],
        defaultValue: 'auto',
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
      aspect_ratio: 'auto',
      resolution: '720p',
      generate_audio: true,
    },
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'single' },
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
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
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
    availableProviders: ['official', 'kie'],
    defaultProvider: 'official',
  },
] as unknown as ModelCard[];
