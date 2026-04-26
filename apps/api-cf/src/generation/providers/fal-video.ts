/**
 * fal.ai video generation (sora-2, kling-2.1, kling-3, seedance-2, veo3 via fal).
 * Sources → fal.storage.upload → CDN URLs → model API.
 */
import { fal } from "@fal-ai/client";
import { log } from "../../logger";
import { generateFalVideo } from "../../services/fal-video";
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

export const falVideoProvider: GenerationProvider = {
  name: "fal-video",

  async execute(ctx) {
    const { params, env } = ctx;
    const falKey = env.FAL_API_KEY ?? "";

    // Cached in Workflow DO state → on generate retry we don't re-upload.
    const sources = await ctx.step(
      "resolve-sources",
      { retries: { limit: 2, delay: "2 seconds" }, timeout: "3 minutes" },
      async () => {
        const one = (k?: string) =>
          k ? uploadR2ToFal(env.R2_BUCKET, k, falKey) : Promise.resolve(undefined);
        const many = async (keys?: string[]) => {
          if (!keys?.length) return undefined;
          const out: string[] = [];
          for (const k of keys) out.push(await uploadR2ToFal(env.R2_BUCKET, k, falKey));
          return out;
        };
        const [startFrameUrl, endFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls] =
          await Promise.all([
            one(params.startFrameR2Key),
            one(params.endFrameR2Key),
            many(params.referenceImageR2Keys),
            many(params.referenceVideoR2Keys),
            many(params.referenceAudioR2Keys),
          ]);
        return { startFrameUrl, endFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls };
      },
    );

    const { storageKey, providerCoverKey, duration } = await ctx.step(
      "fal-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => {
        const model = params.videoModel ?? params.modelName;
        log.info("fal-video generate started", { ...ctx.tag, model });
        const result = await generateFalVideo(falKey, {
          prompt: params.prompt ?? "",
          startFrameUrl: sources.startFrameUrl,
          endFrameUrl: sources.endFrameUrl,
          referenceImageUrls: sources.referenceImageUrls,
          referenceVideoUrls: sources.referenceVideoUrls,
          referenceAudioUrls: sources.referenceAudioUrls,
          duration: params.duration,
          aspectRatio: params.aspectRatio,
          videoModel: model,
          modelParams: params.modelParams,
        });
        log.info("fal-video generated", { ...ctx.tag, model: result.model, hasCover: !!result.coverImageUrl });

        const key = await ctx.uploadFromUrl(result.url, "video/mp4");
        let coverKey: string | undefined;
        if (result.coverImageUrl) {
          try {
            coverKey = await ctx.uploadFromUrl(result.coverImageUrl, "image/jpeg", "-cover");
          } catch (e) {
            log.error("fal-video cover upload failed", { ...ctx.tag, error: String(e) });
          }
        }
        return { storageKey: key, providerCoverKey: coverKey, duration: result.duration };
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey, { skipVideoCover: !!providerCoverKey }),
    );

    const durationMs =
      probe.metadata.durationMs ??
      (typeof duration === "number" ? Math.round(duration * 1000) : undefined);

    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () =>
        ctx.createAsset({
          kind: "video",
          srcR2Key: storageKey,
          coverR2Key: providerCoverKey ?? probe.coverR2Key,
          metadata: { ...probe.metadata, durationMs },
          sourceModel: params.videoModel ?? params.modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
