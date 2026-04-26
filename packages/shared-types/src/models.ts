import { z } from 'zod';

export const ModelKindSchema = z.enum(['image', 'video', 'audio', 'text']);
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

export const GEMINI_TTS_VOICES = [
  { label: 'Zephyr - Bright', value: 'Zephyr' },
  { label: 'Puck - Upbeat', value: 'Puck' },
  { label: 'Charon - Informative', value: 'Charon' },
  { label: 'Kore - Firm', value: 'Kore' },
  { label: 'Fenrir - Excitable', value: 'Fenrir' },
  { label: 'Leda - Youthful', value: 'Leda' },
  { label: 'Orus - Firm', value: 'Orus' },
  { label: 'Aoede - Breezy', value: 'Aoede' },
  { label: 'Callirrhoe - Easy-going', value: 'Callirrhoe' },
  { label: 'Autonoe - Bright', value: 'Autonoe' },
  { label: 'Enceladus - Breathy', value: 'Enceladus' },
  { label: 'Iapetus - Clear', value: 'Iapetus' },
  { label: 'Umbriel - Easy-going', value: 'Umbriel' },
  { label: 'Algieba - Smooth', value: 'Algieba' },
  { label: 'Despina - Smooth', value: 'Despina' },
  { label: 'Erinome - Clear', value: 'Erinome' },
  { label: 'Algenib - Gravelly', value: 'Algenib' },
  { label: 'Rasalgethi - Informative', value: 'Rasalgethi' },
  { label: 'Laomedeia - Upbeat', value: 'Laomedeia' },
  { label: 'Achernar - Soft', value: 'Achernar' },
  { label: 'Alnilam - Firm', value: 'Alnilam' },
  { label: 'Schedar - Even', value: 'Schedar' },
  { label: 'Gacrux - Mature', value: 'Gacrux' },
  { label: 'Pulcherrima - Forward', value: 'Pulcherrima' },
  { label: 'Achird - Friendly', value: 'Achird' },
  { label: 'Zubenelgenubi - Casual', value: 'Zubenelgenubi' },
  { label: 'Vindemiatrix - Gentle', value: 'Vindemiatrix' },
  { label: 'Sadachbia - Lively', value: 'Sadachbia' },
  { label: 'Sadaltager - Knowledgeable', value: 'Sadaltager' },
  { label: 'Sulafat - Warm', value: 'Sulafat' },
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
  /** First / last frame reference pair. Start frame is required, end frame optional. */
  startEnd: z.object({}).optional(),
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

/**
 * Snap raw width/height to the closest aspect-ratio option the given model card
 * exposes. Returns the provider-facing option `value` (what goes into modelParams)
 * or null when the card has no aspect-ratio selector or no usable options.
 *
 * Used to default a generation node's ratio from its start reference frame —
 * Kling / Seedance i2v all derive output ratio from the source image, so letting
 * the UI preselect the nearest match keeps the pending-node placeholder honest.
 */
export function snapAspectRatio(
  modelId: string,
  width: number,
  height: number,
): { paramId: string; value: string | number; canonical: string } | null {
  if (!width || !height) return null;
  const card = MODEL_CARDS.find(c => c.id === modelId);
  if (!card) return null;
  const paramId = card.aspectRatioParam || 'aspect_ratio';
  const arParam = card.parameters.find(p => p.id === paramId);
  if (!arParam?.options?.length) return null;

  const ratio = width / height;
  let best: { option: (typeof arParam.options)[number]; canonical: string } | null = null;
  let bestDiff = Infinity;
  for (const opt of arParam.options) {
    // Parse canonical ratio from the option's label (preferred) or value.
    const candidates = [opt.label, typeof opt.value === 'string' ? opt.value : ''];
    let canonical: string | null = null;
    for (const s of candidates) {
      const m = /^(\d+):(\d+)$/.exec(s);
      if (m) { canonical = `${m[1]}:${m[2]}`; break; }
    }
    if (!canonical) continue;
    const [a, b] = canonical.split(':').map(Number);
    const diff = Math.abs(Math.log(ratio / (a / b)));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = { option: opt, canonical };
    }
  }
  return best ? { paramId, value: best.option.value, canonical: best.canonical } : null;
}

const GEMINI_TTS_PARAMETERS: ModelParameter[] = [
  {
    id: 'voice_name',
    label: 'Voice',
    type: 'select',
    options: [...GEMINI_TTS_VOICES],
    required: false,
    defaultValue: 'Kore',
    description: 'Google Gemini TTS prebuilt voice.',
  },
];

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

  // ─── Video: Seedance 2.0 text-to-video ─────────────────────
  // Pure t2v (separate fal endpoint with separate pricing). Stays split from
  // the i2v variant so UI/pricing stays honest per card.
  {
    id: 'seedance-2-text',
    name: 'Seedance 2.0 (Text)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'ByteDance Seedance 2.0 — text-to-video with native audio.',
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
    input: { requiresPrompt: true, inputMode: {} },
  },

  // ─── Video: Seedance 2.0 image-to-video ────────────────────
  // Start frame required, end frame optional — the native shape of
  // bytedance/seedance-2.0/image-to-video (a single image is just the start
  // slot; optional end slot constrains the final frame).
  {
    id: 'seedance-2-startend',
    name: 'Seedance 2.0 (Start/End)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Seedance 2.0 — animate from a start frame, optionally constrained to a target end frame.',
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
      resolution: '720p',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: { startEnd: {} } },
  },

  // ─── Video: Seedance 2.0 reference-to-video ────────────────
  // Separate endpoint with multi-modal refs. Up to 12 total files across
  // images (≤9), videos (≤3), audios (≤3). Positional prompt references
  // (@Image1, @Video2, @Audio1).
  {
    id: 'seedance-2-ref',
    name: 'Seedance 2.0 (Reference)',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Seedance 2.0 — multi-modal reference-to-video (images + videos + audios).',
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
        defaultValue: 'auto',
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
      aspect_ratio: 'auto',
      resolution: '720p',
      generate_audio: true,
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 9 }, videos: { max: 3 }, audios: { max: 3 } },
      promptModalities: ['text', 'image', 'video', 'audio'],
    },
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

  // ─── Video: Kling 3 Pro (fal.ai) — first frame + optional end frame ────
  {
    id: 'kling-3',
    name: 'Kling 3 Pro',
    provider: 'fal.ai',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Kling 3 Pro — first + optional end frame, with native audio.',
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
        id: 'generate_audio',
        label: 'Native audio',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    defaultParams: {
      duration: '5',
      generate_audio: true,
    },
    input: { requiresPrompt: true, inputMode: { startEnd: {} } },
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
    input: { requiresPrompt: true, inputMode: { images: { max: 8 } }, promptModalities: ['text', 'image'] },
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
    input: { requiresPrompt: true, inputMode: { images: { max: 8 } }, promptModalities: ['text', 'image'] },
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
    input: { requiresPrompt: true, inputMode: { images: { max: 8 } }, promptModalities: ['text', 'image'] },
  },

  // ─── Video: Veo 3.1 (Google native via Vercel AI SDK) ──────
  //
  // Veo 3.1 Vertex pricing is identical across input modes (only variant +
  // audio on/off differ), so we only split cards where the input *contract*
  // conflicts. Specifically:
  //   - text-only + reference-image workflows share one card, since the
  //     reference-image rule (`images.max: 3`) already covers "zero refs" as
  //     the text-only case.
  //   - startEnd (first frame required, last optional) is a separate card
  //     because the `startEnd` contract has a required slot that can't
  //     coexist with optional ref images in the same UI.
  //
  // Lite variant is text-only: at this preview stage it doesn't support
  // reference asset images, so the reference card is omitted to avoid
  // runtime 4xx. startEnd is also preview on Lite — kept off for stability.

  {
    id: 'veo-3.1',
    name: 'Veo 3.1',
    provider: 'Google',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3.1 — text-to-video, optionally with 1–3 reference subject images.',
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
    input: { requiresPrompt: true, inputMode: { images: { max: 3 } } },
  },
  {
    id: 'veo-3.1-startend',
    name: 'Veo 3.1 (Start/End)',
    provider: 'Google',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3.1 — first-and-last-frame interpolation between two key frames.',
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
    input: { requiresPrompt: true, inputMode: { startEnd: {} } },
  },
  {
    id: 'veo-3.1-lite',
    name: 'Veo 3.1 Lite',
    provider: 'Google',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3.1 Lite — cheapest tier, text-to-video only.',
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
    description: 'Google Veo 3.1 Fast — text-to-video, optionally with 1–3 reference subject images.',
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
    input: { requiresPrompt: true, inputMode: { images: { max: 3 } } },
  },
  {
    id: 'veo-3.1-fast-startend',
    name: 'Veo 3.1 Fast (Start/End)',
    provider: 'Google',
    kind: 'video',
    defaultAspectRatio: '16:9',
    description: 'Google Veo 3.1 Fast — first-and-last-frame interpolation between two key frames.',
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
    input: { requiresPrompt: true, inputMode: { startEnd: {} } },
  },

  // ─── Text ────────────────────────────────────────────────────
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4 Text',
    provider: 'OpenAI',
    kind: 'text',
    defaultAspectRatio: '1:1',
    description: 'General-purpose text generation. Accepts image context alongside the prompt (vision).',
    parameters: [
      {
        id: 'system_prompt',
        label: 'System prompt',
        type: 'text',
        placeholder: 'Optional instructions for tone, format, or role',
        defaultValue: '',
      },
    ],
    defaultParams: {
      system_prompt: '',
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 10 } },
      promptModalities: ['text', 'image'],
    },
    maxRuntimeMs: 5 * 60 * 1000,
  },
  {
    id: 'gemini-3.1-pro',
    name: 'Gemini 3.1 Pro',
    provider: 'Google',
    kind: 'text',
    defaultAspectRatio: '1:1',
    description: 'Google Gemini 3.1 Pro — flagship multimodal reasoning across text, image, video, and audio inputs.',
    parameters: [
      {
        id: 'system_prompt',
        label: 'System prompt',
        type: 'text',
        placeholder: 'Optional instructions for tone, format, or role',
        defaultValue: '',
      },
    ],
    defaultParams: {
      system_prompt: '',
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 16 }, videos: { max: 1 }, audios: { max: 1 } },
      promptModalities: ['text', 'image', 'video', 'audio'],
    },
    maxRuntimeMs: 5 * 60 * 1000,
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    provider: 'Google',
    kind: 'text',
    defaultAspectRatio: '1:1',
    description: 'Faster, cheaper Gemini 3 Flash — multimodal across text, image, video, and audio inputs.',
    parameters: [
      {
        id: 'system_prompt',
        label: 'System prompt',
        type: 'text',
        placeholder: 'Optional instructions for tone, format, or role',
        defaultValue: '',
      },
    ],
    defaultParams: {
      system_prompt: '',
    },
    input: {
      requiresPrompt: true,
      inputMode: { images: { max: 16 }, videos: { max: 1 }, audios: { max: 1 } },
      promptModalities: ['text', 'image', 'video', 'audio'],
    },
    maxRuntimeMs: 5 * 60 * 1000,
  },

  // ─── Audio ───────────────────────────────────────────────────
  {
    id: 'gemini-3.1-flash-tts',
    name: 'Gemini 3.1 Flash TTS',
    provider: 'Google',
    kind: 'audio',
    defaultAspectRatio: '1:1',
    description: 'Google Gemini TTS preview for low-latency controllable single-speaker audio.',
    parameters: GEMINI_TTS_PARAMETERS,
    defaultParams: {
      voice_name: 'Kore',
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ['text'] },
    maxRuntimeMs: 5 * 60 * 1000,
  },
  {
    id: 'gemini-2.5-flash-tts',
    name: 'Gemini 2.5 Flash TTS',
    provider: 'Google',
    kind: 'audio',
    defaultAspectRatio: '1:1',
    description: 'Google Gemini TTS for cost-efficient controllable speech generation.',
    parameters: GEMINI_TTS_PARAMETERS,
    defaultParams: {
      voice_name: 'Kore',
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ['text'] },
    maxRuntimeMs: 5 * 60 * 1000,
  },
  {
    id: 'gemini-2.5-pro-tts',
    name: 'Gemini 2.5 Pro TTS',
    provider: 'Google',
    kind: 'audio',
    defaultAspectRatio: '1:1',
    description: 'Google Gemini TTS with higher control for scripts, narration, and structured speech.',
    parameters: GEMINI_TTS_PARAMETERS,
    defaultParams: {
      voice_name: 'Kore',
    },
    input: { requiresPrompt: true, inputMode: {}, promptModalities: ['text'] },
    maxRuntimeMs: 5 * 60 * 1000,
  },
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
