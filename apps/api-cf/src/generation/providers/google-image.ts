/**
 * Google Gemini image generation (gemini-flash-image, gemini-pro-image, …).
 * No reference-image routing today — Gemini image models generate from
 * prompt+aspectRatio only. If/when ref-to-image lands, read R2→base64 here.
 */
import { log } from "../../logger";
import { generateGoogleImage, type VertexCredentials } from "../../services/google-gen";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

export const googleImageProvider: GenerationProvider = {
  name: "google-image",

  async execute(ctx) {
    const { params, env } = ctx;

    const storageKey = await ctx.step(
      "google-image-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        const creds: VertexCredentials = {
          clientEmail: env.GOOGLE_CLIENT_EMAIL ?? "",
          privateKey: env.GOOGLE_PRIVATE_KEY ?? "",
          project: env.GOOGLE_CLOUD_PROJECT ?? "",
          location: env.GOOGLE_CLOUD_LOCATION ?? "global",
        };
        log.info("Google image generate started", { ...ctx.tag, model: params.modelName });
        const result = await generateGoogleImage(creds, {
          prompt: params.prompt ?? "",
          aspectRatio: params.aspectRatio,
          modelName: params.modelName,
          modelParams: params.modelParams,
        });
        log.info("Google image generated", { ...ctx.tag, model: result.model });
        return ctx.uploadBytes(result.data, result.mediaType ?? "image/png");
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
