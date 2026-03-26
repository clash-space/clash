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

interface ImageGenParams {
  text: string;
  systemPrompt?: string;
  base64Images?: string[];
  aspectRatio?: string;
  modelName?: string;
  /** Model-specific extra params (e.g. num_inference_steps, guidance_scale). */
  modelParams?: Record<string, unknown>;
}

/** Map from shared model card IDs to fal.ai model endpoints. */
const FAL_IMAGE_MODEL_IDS: Record<string, string> = {
  'flux-schnell': 'fal-ai/flux/schnell',
  'flux-dev': 'fal-ai/flux/dev',
  'nano-banana-2': 'fal-ai/nano-banana-2',
  'nano-banana-2-edit': 'fal-ai/nano-banana-2/edit',
};

/**
 * Convert a generic aspect-ratio string (e.g. "16:9") to a fal.ai image_size value.
 * Used by FLUX models which accept named sizes instead of aspect_ratio.
 */
function aspectRatioToImageSize(ar: string): string {
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
  return map[ar] || 'landscape_16_9';
}

function stripDataUrl(base64Str: string): string {
  const idx = base64Str.indexOf("base64,");
  return idx >= 0 ? base64Str.slice(idx + 7) : base64Str;
}

/**
 * Generate an image using fal.ai.
 * Returns raw base64 image data (no data: prefix).
 */
export async function generateImage(
  falApiKey: string,
  params: ImageGenParams,
): Promise<string> {
  console.log(`[image-gen] Starting: key=${falApiKey.slice(0, 8)}... prompt="${params.text.slice(0, 50)}..."`);
  fal.config({ credentials: falApiKey });

  const hasRefImages = !!params.base64Images?.length;
  const modelId = resolveModelId(params.modelName, hasRefImages);
  console.log(`[image-gen] Model: ${modelId}, aspect=${params.aspectRatio || "1:1"}, refs=${params.base64Images?.length ?? 0}`);

  let prompt = params.text;
  if (params.systemPrompt) {
    prompt = `${params.systemPrompt}\n\n${prompt}`;
  }

  let input: Record<string, unknown>;
  const extraParams = params.modelParams ?? {};

  if (modelId === 'fal-ai/flux/schnell' || modelId === 'fal-ai/flux/dev') {
    // FLUX models use image_size instead of aspect_ratio
    const imageSize = (extraParams.image_size as string) || aspectRatioToImageSize(params.aspectRatio || '16:9');
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
      input.image_urls = params.base64Images!.map(
        (img) => `data:image/jpeg;base64,${stripDataUrl(img)}`
      );
    }
  }

  console.log(`[image-gen] Calling fal.subscribe("${modelId}")...`);
  const result = await fal.subscribe(modelId, { input });
  console.log(`[image-gen] fal responded, requestId=${result.requestId}`);
  const data = result.data as {
    images?: Array<{ url: string; width?: number; height?: number }>;
  };

  if (!data.images?.length) {
    throw new Error("No images in fal.ai response");
  }

  // fal returns a URL — fetch and convert to base64
  const imageResp = await fetch(data.images[0].url);
  if (!imageResp.ok) {
    throw new Error(`Failed to fetch generated image: ${imageResp.status}`);
  }

  const buffer = await imageResp.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function resolveModelId(modelName: string | undefined, hasRefImages: boolean): string {
  if (modelName && FAL_IMAGE_MODEL_IDS[modelName]) {
    return FAL_IMAGE_MODEL_IDS[modelName];
  }
  // Default: nano-banana-2 (with edit variant when ref images present)
  return hasRefImages ? "fal-ai/nano-banana-2/edit" : "fal-ai/nano-banana-2";
}
