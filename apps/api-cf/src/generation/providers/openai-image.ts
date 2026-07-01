import { log } from "../../logger";
import { generateOpenAIImage, type OpenAIInlineImage } from "../../services/openai-image";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";
import { credentialsForProvider } from "./provider-credentials";

async function loadInlineFromR2(bucket: R2Bucket, key: string): Promise<OpenAIInlineImage | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  return {
    data: new Uint8Array(buf),
    mimeType: obj.httpMetadata?.contentType ?? "image/png",
  };
}

export const openaiImageProvider: GenerationProvider = {
  name: "openai-image",

  async execute(ctx) {
    const { params, env } = ctx;

    const storageKey = await ctx.step(
      "openai-image-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "3 minutes" },
      async () => {
        const r2Keys = params.referenceImageR2Keys ?? [];
        const referenceImages: OpenAIInlineImage[] = [];
        for (const key of r2Keys) {
          const inline = await loadInlineFromR2(env.R2_BUCKET, key);
          if (inline) referenceImages.push(inline);
        }

        log.info("OpenAI image generate started", {
          ...ctx.tag,
          model: params.modelName,
          refs: referenceImages.length,
        });
        const credentials = await credentialsForProvider(ctx, "official", ["apiKey"], {
          upstreamId: "openai",
          region: "global",
          modelCode: params.modelName ?? "gpt-image-2",
        });
        const result = await generateOpenAIImage({
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          prompt: params.prompt ?? "",
          modelName: params.modelName ?? "gpt-image-2",
          modelParams: params.modelParams,
          referenceImages: referenceImages.length ? referenceImages : undefined,
        });
        log.info("OpenAI image generated", { ...ctx.tag, model: result.model, bytes: result.data.byteLength });
        return ctx.uploadBytes(result.data, result.mediaType);
      },
    );

    const probe = await ctx.step(
      "probe-image",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "1 minute" },
      async () => ctx.probe("image", storageKey),
    );

    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () =>
        ctx.createAsset({
          kind: "image",
          srcR2Key: storageKey,
          metadata: probe.metadata,
          sourceModel: params.modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
