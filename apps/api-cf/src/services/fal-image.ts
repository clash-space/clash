/**
 * Image generation via fal.ai.
 *
 * Supported models:
 *   - fal-ai/nano-banana-2       (text-to-image)
 *   - fal-ai/nano-banana-2/edit  (image editing, accepts image_urls[])
 *   - fal-ai/flux/schnell        (ultra-fast text-to-image)
 *   - fal-ai/flux/dev            (high-quality text-to-image)
 */
import { fal } from "@fal-ai/client";
import {
  gptImageSizeForRatio,
  parseAspectRatio,
  resolveGptImageSize,
} from "@clash/shared-types";

interface ImageGenParams {
  text: string;
  systemPrompt?: string;
  /** URLs of reference images (fal CDN or any public URL) */
  referenceImageUrls?: string[];
  aspectRatio?: string;
  modelName?: string;
  /** Exact endpoint selected by the model-provider route. */
  modelEndpoint?: string;
  modelParams?: Record<string, unknown>;
  /** Called when fal enqueues the request */
  onEnqueue?: (requestId: string) => void;
  /** Called on each fal queue status poll */
  onQueueUpdate?: (status: { status: string; position?: number }) => void;
}

type FalImageContract = {
  generate: string;
  edit?: string;
};

/** Exact endpoint pairs for each public card. There is deliberately no default. */
const FAL_IMAGE_MODELS: Record<string, FalImageContract> = {
  'flux-schnell': { generate: 'fal-ai/flux/schnell' },
  'flux-dev': { generate: 'fal-ai/flux/dev' },
  'nano-banana-2': {
    generate: 'fal-ai/nano-banana-2',
    edit: 'fal-ai/nano-banana-2/edit',
  },
  'gpt-image-2': {
    generate: 'openai/gpt-image-2',
    edit: 'openai/gpt-image-2/edit',
  },
  'seedream-4.5': {
    generate: 'fal-ai/bytedance/seedream/v4.5/text-to-image',
    edit: 'fal-ai/bytedance/seedream/v4.5/edit',
  },
  'recraft-v4': { generate: 'fal-ai/recraft/v4/pro/text-to-image' },
  'flux-2-pro': {
    generate: 'fal-ai/flux-2-pro',
    edit: 'fal-ai/flux-2-pro/edit',
  },
};

/**
 * Convert a generic aspect-ratio string (e.g. "16:9") to a fal.ai image_size value.
 */
function aspectRatioToImageSize(ar: string): string | { width: number; height: number } {
  const map: Record<string, string> = {
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '1:1': 'square_hd',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3',
    '2:3': 'portrait_4_3',
    '3:2': 'landscape_4_3',
    '4:5': 'portrait_4_3',
    '5:4': 'landscape_4_3',
  };
  const named = map[ar];
  if (named) return named;
  // fal's named presets only cover a handful of ratios, so anything else has to be
  // sent as explicit dimensions. Falling back to landscape_16_9 silently rewrote
  // the caller's request: a 2:1 equirectangular panorama came back as 16:9, and the
  // client then rejected it for not being exactly 2:1.
  const ratio = parseAspectRatio(ar);
  if (ratio !== undefined) return gptImageSizeForRatio(ar, '2K');
  return 'landscape_16_9';
}

/**
 * Translate the product's canonical ratio into fal's `image_size`.
 *
 * Model cards declare ratios; this is the only place fal's spelling exists. An
 * explicit `image_size` still wins, so a caller that genuinely needs a fal preset
 * or exact dimensions can say so.
 */
function falImageSize(
  params: Record<string, unknown>,
  aspectRatio: string | undefined,
  fallbackRatio: string,
): string | { width: number; height: number } {
  const explicit = params.image_size;
  if (
    explicit &&
    (typeof explicit === 'string' ||
      (typeof explicit === 'object' && !Array.isArray(explicit)))
  ) {
    return explicit as string | { width: number; height: number };
  }
  const declared =
    typeof params.aspect_ratio === 'string' ? params.aspect_ratio : aspectRatio;
  if (!declared || declared === 'auto') return aspectRatioToImageSize(fallbackRatio);
  return aspectRatioToImageSize(declared);
}

function gptImageSize(
  params: Record<string, unknown>,
  aspectRatio: string | undefined,
): string | { width: number; height: number } {
  if (params.image_size && (
    typeof params.image_size === "string" ||
    (typeof params.image_size === "object" && !Array.isArray(params.image_size))
  )) {
    return params.image_size as string | { width: number; height: number };
  }
  // gpt-image-2 accepts any resolution within its documented constraints, so the
  // declared ratio and resolution tier are resolved into a concrete size by the
  // shared helper rather than squeezed through a fixed preset list.
  return resolveGptImageSize(params, aspectRatio);
}

/**
 * Generate an image using fal.ai.
 * Returns the generated image URL (on fal's CDN).
 */
export async function generateImage(
  falApiKey: string,
  params: ImageGenParams,
): Promise<{ url: string; requestId: string; model: string }> {
  fal.config({ credentials: falApiKey });

  const hasRefImages = !!params.referenceImageUrls?.length;
  const modelId = resolveModelId(params.modelEndpoint ?? params.modelName, hasRefImages);

  let prompt = params.text;
  if (params.systemPrompt) {
    prompt = `${params.systemPrompt}\n\n${prompt}`;
  }

  let input: Record<string, unknown>;
  const extraParams = params.modelParams ?? {};

  if (modelId === 'openai/gpt-image-2' || modelId === 'openai/gpt-image-2/edit') {
    input = {
      prompt,
      image_size: gptImageSize(extraParams, params.aspectRatio),
      quality: (extraParams.quality as string) || 'high',
      num_images: (extraParams.count as number) ?? 1,
      output_format: (extraParams.output_format as string) || 'png',
    };
    if (hasRefImages) {
      input.image_urls = params.referenceImageUrls;
    }
  } else if (
    modelId === 'fal-ai/bytedance/seedream/v4.5/text-to-image' ||
    modelId === 'fal-ai/bytedance/seedream/v4.5/edit'
  ) {
    input = {
      prompt,
      // Seedream's tier only applies when the ratio is auto; a named preset already
      // fixes the size.
      image_size:
        typeof params.aspectRatio === 'string' && params.aspectRatio !== 'auto'
          ? falImageSize(extraParams, params.aspectRatio, '1:1')
          : (extraParams.image_size as string) ||
            `auto_${(extraParams.resolution as string) || '2K'}`,
      num_images: (extraParams.count as number) ?? 1,
      max_images: (extraParams.max_images as number) ?? 1,
      enable_safety_checker: extraParams.enable_safety_checker ?? true,
    };
    if (hasRefImages) {
      input.image_urls = params.referenceImageUrls;
    }
  } else if (modelId === 'fal-ai/recraft/v4/pro/text-to-image') {
    input = {
      prompt,
      image_size: falImageSize(extraParams, params.aspectRatio, '1:1'),
      enable_safety_checker: false,
    };
  } else if (modelId === 'fal-ai/flux-2-pro' || modelId === 'fal-ai/flux-2-pro/edit') {
    input = {
      prompt,
      image_size: falImageSize(extraParams, params.aspectRatio, '4:3'),
      output_format: 'png',
      safety_tolerance: (extraParams.safety_tolerance as string) || '2',
      enable_safety_checker: false,
    };
    if (hasRefImages) {
      input.image_urls = params.referenceImageUrls;
    }
  } else if (modelId === 'fal-ai/flux/schnell' || modelId === 'fal-ai/flux/dev') {
    const imageSize = falImageSize(extraParams, params.aspectRatio, '16:9');
    input = {
      prompt,
      image_size: imageSize,
      num_images: (extraParams.count as number) ?? 1,
      output_format: 'png',
      enable_safety_checker: false,
    };
    if (extraParams.num_inference_steps != null) {
      input.num_inference_steps = extraParams.num_inference_steps;
    }
    if (modelId === 'fal-ai/flux/dev' && extraParams.guidance_scale != null) {
      input.guidance_scale = extraParams.guidance_scale;
    }
  } else {
    // nano-banana-2 / nano-banana-2/edit
    input = {
      prompt,
      aspect_ratio: params.aspectRatio || "1:1",
      num_images: 1,
      output_format: "png",
    };
    if (hasRefImages) {
      input.image_urls = params.referenceImageUrls;
    }
  }

  const result = await fal.subscribe(modelId, {
    input,
    timeout: 4 * 60 * 1000,
    onEnqueue: params.onEnqueue,
    onQueueUpdate: params.onQueueUpdate as any,
  });
  const data = result.data as {
    images?: Array<{ url: string; width?: number; height?: number }>;
  };

  if (!data.images?.length) {
    throw new Error("No images in fal.ai response");
  }

  return { url: data.images[0].url, requestId: result.requestId, model: modelId };
}

function resolveModelId(modelName: string | undefined, hasRefImages: boolean): string {
  const requested = modelName?.trim();
  if (!requested) {
    throw new Error("Unsupported fal image model: no model-provider endpoint was selected");
  }
  const contract = FAL_IMAGE_MODELS[requested] ?? Object.values(FAL_IMAGE_MODELS)
    .find((candidate) => candidate.generate === requested || candidate.edit === requested);
  if (!contract) {
    throw new Error(`Unsupported fal image model: ${requested}`);
  }
  if (!hasRefImages) return contract.generate;
  if (!contract.edit) {
    throw new Error(`fal image model does not support editing: ${requested}`);
  }
  return contract.edit;
}
