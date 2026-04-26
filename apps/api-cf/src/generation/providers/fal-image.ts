/**
 * fal.ai image generation (nano-banana-2, flux, etc.). Reference images go
 * through fal.storage first. Supports both flat `referenceImageR2Keys` and ordered
 * `promptParts` (asset_ref parts interleaved with text).
 */
import { fal } from "@fal-ai/client";
import { log } from "../../logger";
import { generateImage as generateFalImage } from "../../services/fal-image";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

async function uploadR2ToFal(bucket: R2Bucket, key: string, falApiKey: string): Promise<string> {
  fal.config({ credentials: falApiKey });
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  const buf = await obj.arrayBuffer();
  const ct = obj.httpMetadata?.contentType || "image/png";
  return fal.storage.upload(new Blob([buf], { type: ct }));
}

export const falImageProvider: GenerationProvider = {
  name: "fal-image",

  async execute(ctx) {
    const { params, env } = ctx;
    const falKey = env.FAL_API_KEY ?? "";

    const referenceImageUrls = await ctx.step(
      "resolve-references",
      { retries: { limit: 2, delay: "2 seconds" }, timeout: "3 minutes" },
      async () => {
        // referenceImageR2Keys is the single source of truth. promptParts
        // asset_refs are guaranteed to also be in this list (frontend
        // contract); promptParts only carries position info, which fal
        // image-out endpoints don't consume.
        const r2Keys = params.referenceImageR2Keys ?? [];
        if (!r2Keys.length) return undefined;
        const urls: string[] = [];
        for (const k of r2Keys) urls.push(await uploadR2ToFal(env.R2_BUCKET, k, falKey));
        return urls;
      },
    );

    const storageKey = await ctx.step(
      "fal-image-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("fal-image generate started", { ...ctx.tag, model: params.modelName, refs: referenceImageUrls?.length ?? 0 });
        const result = await generateFalImage(falKey, {
          text: params.prompt ?? "",
          systemPrompt: params.systemPrompt,
          referenceImageUrls,
          aspectRatio: params.aspectRatio,
          modelName: params.modelName,
          modelParams: params.modelParams,
        });
        log.info("fal-image generated", { ...ctx.tag, model: result.model });
        return ctx.uploadFromUrl(result.url, "image/png");
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
