import { z } from 'zod';

export const ModelKindSchema = z.enum(['image', 'video', 'audio']);
export type ModelKind = z.infer<typeof ModelKindSchema>;

/**
 * Gemini ImageConfig aspect ratios
 * Reference: https://ai.google.dev/gemini-api/docs/image-generation
 */
export const GEMINI_ASPECT_RATIOS = [
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
 * Gemini ImageConfig image sizes
 * Reference: https://googleapis.github.io/python-genai/genai.html#genai.types.ImageConfig
 */
export const GEMINI_IMAGE_SIZES = [
  { label: '1K (Fast)', value: '1K' },
  { label: '2K (Balanced)', value: '2K' },
  { label: '4K (High Quality)', value: '4K' },
] as const;

export const ModelParameterTypeSchema = z.enum(['select', 'slider', 'number', 'text', 'boolean']);
export type ModelParameterType = z.infer<typeof ModelParameterTypeSchema>;

/**
 * Provider configuration for models
 * Each model can have multiple providers (e.g., ElevenLabs official API or KIE.ai)
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
  input: ModelInputRuleSchema.default({ requiresPrompt: true, referenceImage: 'optional' }),
  availableProviders: z.array(ProviderSchema).optional(),
  defaultProvider: ProviderSchema.optional(),
});
export type ModelCard = z.infer<typeof ModelCardSchema>;

export const MODEL_CARDS: ModelCard[] = [
  {
    id: 'nano-banana',
    name: 'Nano Banana',
    provider: 'Google Gemini',
    kind: 'image',
    description: 'Gemini 2.5 Flash image generation tuned for fast drafts.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: GEMINI_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'image_size',
        label: 'Image Size',
        type: 'select',
        options: GEMINI_IMAGE_SIZES.map(s => ({ label: s.label, value: s.value })),
        defaultValue: '2K',
        description: 'Higher resolution = better quality but slower generation',
      },
      {
        id: 'stylization',
        label: 'Stylization',
        type: 'slider',
        min: 0,
        max: 1000,
        step: 10,
        defaultValue: 100,
        description: 'Higher values add more model-driven styling.',
      },
      {
        id: 'weirdness',
        label: 'Weirdness',
        type: 'slider',
        min: 0,
        max: 1000,
        step: 10,
        defaultValue: 0,
        description: 'Experimentation strength for unexpected details.',
      },
      {
        id: 'diversity',
        label: 'Diversity',
        type: 'slider',
        min: 0,
        max: 1000,
        step: 10,
        defaultValue: 0,
        description: 'Encourage variety across multiple renders.',
      },
      {
        id: 'count',
        label: 'Count',
        type: 'number',
        min: 1,
        max: 8,
        step: 1,
        defaultValue: 1,
        description: 'How many candidates to request in one call.',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
      image_size: '2K',
      stylization: 100,
      weirdness: 0,
      diversity: 0,
      count: 1,
    },
    input: { requiresPrompt: true, referenceImage: 'optional', referenceMode: 'single' },
  },
  {
    id: 'nano-banana-pro',
    name: 'Nano Banana Pro',
    provider: 'Google Gemini',
    kind: 'image',
    description: 'Gemini 3.0 Pro Image Preview for higher fidelity generations.',
    parameters: [
      {
        id: 'aspect_ratio',
        label: 'Aspect Ratio',
        type: 'select',
        options: GEMINI_ASPECT_RATIOS.map(r => ({ label: r.label, value: r.value })),
        defaultValue: '16:9',
      },
      {
        id: 'image_size',
        label: 'Image Size',
        type: 'select',
        options: GEMINI_IMAGE_SIZES.map(s => ({ label: s.label, value: s.value })),
        defaultValue: '2K',
        description: 'Higher resolution = better quality but slower generation',
      },
      {
        id: 'stylization',
        label: 'Stylization',
        type: 'slider',
        min: 0,
        max: 1000,
        step: 10,
        defaultValue: 200,
      },
      {
        id: 'weirdness',
        label: 'Weirdness',
        type: 'slider',
        min: 0,
        max: 1000,
        step: 10,
        defaultValue: 0,
      },
      {
        id: 'count',
        label: 'Count',
        type: 'number',
        min: 1,
        max: 8,
        step: 1,
        defaultValue: 1,
        description: 'How many candidates to request in one call.',
      },
    ],
    defaultParams: {
      aspect_ratio: '16:9',
      image_size: '2K',
      stylization: 200,
      weirdness: 0,
      count: 1,
    },
    input: { requiresPrompt: true, referenceImage: 'optional', referenceMode: 'single' },
  },
  {
    id: 'kling-image2video',
    name: 'Kling Image2Video',
    provider: 'Kling (Beijing)',
    kind: 'video',
    description: 'Turn a single keyframe into a short cinematic clip.',
    parameters: [
      {
        id: 'duration',
        label: 'Duration',
        type: 'select',
        options: [
          { label: '5s', value: 5 },
          { label: '10s', value: 10 },
        ],
        defaultValue: 5,
      },
      {
        id: 'cfg_scale',
        label: 'CFG',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
        description: 'Higher values adhere more tightly to the prompt.',
      },
    ],
    defaultParams: {
      duration: 5,
      cfg_scale: 0.5,
    },
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'single' },
  },
  {
    id: 'kling-kie-text2video',
    name: 'Kling Text2Video Pro',
    provider: 'Kling AI (KIE)',
    kind: 'video',
    description: 'Direct text-to-video generation via Kling KIE API.',
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
        options: [
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
          { label: '1:1', value: '1:1' },
        ],
        defaultValue: '16:9',
      },
      {
        id: 'negative_prompt',
        label: 'Negative Prompt',
        type: 'text',
        placeholder: 'blur, distort, low quality',
        defaultValue: 'blur, distort, low quality',
      },
      {
        id: 'cfg_scale',
        label: 'CFG',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
      },
    ],
    defaultParams: {
      duration: '5',
      aspect_ratio: '16:9',
      negative_prompt: 'blur, distort, low quality',
      cfg_scale: 0.5,
    },
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
  {
    id: 'kling-kie-image2video',
    name: 'Kling Image2Video Pro',
    provider: 'Kling AI (KIE)',
    kind: 'video',
    description: 'Animate a still image with Kling KIE image-to-video.',
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
        options: [
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
          { label: '1:1', value: '1:1' },
        ],
        defaultValue: '16:9',
      },
      {
        id: 'negative_prompt',
        label: 'Negative Prompt',
        type: 'text',
        placeholder: 'blur, distort, low quality',
        defaultValue: 'blur, distort, low quality',
      },
      {
        id: 'cfg_scale',
        label: 'CFG',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
      },
    ],
    defaultParams: {
      duration: '5',
      aspect_ratio: '16:9',
      negative_prompt: 'blur, distort, low quality',
      cfg_scale: 0.5,
    },
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'start_end' },
  },
  {
    id: 'minimax-tts',
    name: 'MiniMax TTS',
    provider: 'MiniMax',
    kind: 'audio',
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
  {
    id: 'sora-2-pro-text-to-video',
    name: 'Sora 2 Pro (Text)',
    provider: 'KIE.ai',
    kind: 'video',
    description: 'Sora 2 Pro Text-to-Video generation.',
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
        options: [
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
          { label: '1:1', value: '1:1' },
          { label: '21:9', value: '21:9' },
        ],
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
        id: 'cfg_scale',
        label: 'CFG',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
      },
    ],
    defaultParams: {
      duration: '5',
      aspect_ratio: '16:9',
      resolution: '720p',
      cfg_scale: 0.5,
    },
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
  {
    id: 'sora-2-pro-image-to-video',
    name: 'Sora 2 Pro (Image)',
    provider: 'KIE.ai',
    kind: 'video',
    description: 'Sora 2 Pro Image-to-Video generation.',
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
        options: [
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
          { label: '1:1', value: '1:1' },
          { label: '21:9', value: '21:9' },
        ],
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
        id: 'cfg_scale',
        label: 'CFG',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
      },
    ],
    defaultParams: {
      duration: '5',
      aspect_ratio: '16:9',
      resolution: '720p',
      cfg_scale: 0.5,
    },
    input: { requiresPrompt: false, referenceImage: 'required', referenceMode: 'single' },
  },
  {
    id: 'sora-2-characters',
    name: 'Sora 2 Characters',
    provider: 'KIE.ai',
    kind: 'video',
    description: 'Sora 2 Characters generation.',
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
        options: [
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
          { label: '1:1', value: '1:1' },
          { label: '21:9', value: '21:9' },
        ],
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
        id: 'cfg_scale',
        label: 'CFG',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
      },
    ],
    defaultParams: {
      duration: '5',
      aspect_ratio: '16:9',
      resolution: '720p',
      cfg_scale: 0.5,
    },
    input: { requiresPrompt: true, referenceImage: 'required', referenceMode: 'single' },
  },
  {
    id: 'sora-2-pro-storyboard',
    name: 'Sora 2 Pro Storyboard',
    provider: 'KIE.ai',
    kind: 'video',
    description: 'Sora 2 Pro Storyboard generation.',
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
        options: [
          { label: '16:9', value: '16:9' },
          { label: '9:16', value: '9:16' },
          { label: '1:1', value: '1:1' },
          { label: '21:9', value: '21:9' },
        ],
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
        id: 'cfg_scale',
        label: 'CFG',
        type: 'slider',
        min: 0,
        max: 1,
        step: 0.05,
        defaultValue: 0.5,
      },
    ],
    defaultParams: {
      duration: '5',
      aspect_ratio: '16:9',
      resolution: '720p',
      cfg_scale: 0.5,
    },
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
  {
    id: 'remotion-mg',
    name: 'Remotion MG (Gemini)',
    provider: 'Gemini + Remotion',
    kind: 'video',
    description: 'Generate motion-graphics React components with Gemini and render via Remotion.',
    parameters: [
      {
        id: 'duration',
        label: 'Duration (s)',
        type: 'number',
        min: 1,
        max: 60,
        step: 1,
        defaultValue: 5,
      },
      {
        id: 'width',
        label: 'Width',
        type: 'number',
        min: 320,
        max: 3840,
        step: 1,
        defaultValue: 1920,
      },
      {
        id: 'height',
        label: 'Height',
        type: 'number',
        min: 320,
        max: 3840,
        step: 1,
        defaultValue: 1080,
      },
      {
        id: 'fps',
        label: 'FPS',
        type: 'number',
        min: 12,
        max: 60,
        step: 1,
        defaultValue: 30,
      },
    ],
    defaultParams: {
      duration: 5,
      width: 1920,
      height: 1080,
      fps: 30,
    },
    input: { requiresPrompt: true, referenceImage: 'forbidden', referenceMode: 'none' },
  },
] as unknown as ModelCard[];
