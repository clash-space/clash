/**
 * Google Gemini image generation (gemini-flash-image, gemini-pro-image, …).
 * Reference images go through the Gemini `:generateContent` multimodal path
 * (image-in + image-out); plain text-to-image keeps the Imagen-style
 * `:predict` route for richer aspectRatio/resolution plumbing.
 */
import { log } from "../../logger";
import {
  generateGoogleImage,
  type VertexCredentials,
  type VertexInlineImage,
} from "../../services/google-gen";
import type { GenerationProvider } from "../provider";

async function loadInlineFromR2(
  bucket: R2Bucket,
  key: string,
): Promise<VertexInlineImage | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return {
    bytesBase64Encoded: btoa(bin),
    mimeType: obj.httpMetadata?.contentType ?? "image/png",
  };
}

export const googleImageProvider: GenerationProvider = {
  name: "google-image",

  async execute(ctx) {
    const { params, env } = ctx;

    const storageKey = await ctx.step(
      "google-image-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        // R2 read + base64 encode happens INSIDE this step. Don't return
        // base64 bytes from a separate step — CF Workflow's per-step output
        // cap is 1 MiB, and a 1280×720 PNG base64 is ~1–2 MiB. R2 reads are
        // cheap (same isolate, no egress); re-reading on retry is fine.
        // Only the final R2 storage key (a short string) crosses the step
        // boundary. Same trick as veo.ts.
        const r2Keys = params.referenceImageR2Keys ?? [];
        const referenceImages: VertexInlineImage[] = [];
        for (const k of r2Keys) {
          const inline = await loadInlineFromR2(env.R2_BUCKET, k);
          if (inline) referenceImages.push(inline);
        }

        const creds: VertexCredentials = {
          clientEmail: env.GOOGLE_CLIENT_EMAIL ?? "",
          privateKey: env.GOOGLE_PRIVATE_KEY ?? "",
          project: env.GOOGLE_CLOUD_PROJECT ?? "",
          location: env.GOOGLE_CLOUD_LOCATION ?? "global",
        };
        log.info("Google image generate started", {
          ...ctx.tag,
          model: params.modelName,
          refs: referenceImages.length,
        });
        const result = await generateGoogleImage(creds, {
          prompt: params.prompt ?? "",
          aspectRatio: params.aspectRatio,
          modelName: params.modelName,
          modelParams: params.modelParams,
          referenceImages: referenceImages.length ? referenceImages : undefined,
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
