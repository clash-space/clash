/**
 * Google VEO 3.1 video generation. Reads R2 sources directly, base64-encodes
 * inline for Vertex's payload — no third-party stopover.
 */
import { log } from "../../logger";
import { generateGoogleVideo, type VertexCredentials, type VertexInlineImage } from "../../services/google-gen";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

export const veoProvider: GenerationProvider = {
  name: "veo",

  async execute(ctx: GenerationContext): Promise<void> {
    const { params, env } = ctx;

    // Note: base64 source images are NOT cached in a separate step — a 1280×720
    // PNG is 1–2 MiB base64, which blows CF Workflow's 1 MiB step-output cap.
    // R2 reads are cheap (same isolate, no egress); re-reading on retry is
    // fine. Only the post-upload storage key (short string) crosses steps.
    const { storageKey, duration } = await ctx.step(
      "vertex-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => {
        const read = (k?: string): Promise<VertexInlineImage | undefined> =>
          k ? ctx.readR2Base64(k) : Promise.resolve(undefined);
        const readAll = async (keys?: string[]): Promise<VertexInlineImage[] | undefined> => {
          if (!keys?.length) return undefined;
          return Promise.all(keys.map((k) => ctx.readR2Base64(k)));
        };
        // Vertex Veo wire shape:
        //   startFrameR2Key       → inst.image      (startEnd anchor)
        //   endFrameR2Key         → inst.lastFrame  (startEnd tail)
        //   referenceImageR2Keys  → inst.referenceImages (multi-subject)
        // Veo cards routed here are either startEnd or multi-ref — no
        // single-image-i2v ambiguity (legacy veo3 lives on fal-video).
        const [image, tailImage, referenceImages] = await Promise.all([
          read(params.startFrameR2Key),
          read(params.endFrameR2Key),
          readAll(params.referenceImageR2Keys),
        ]);

        const creds: VertexCredentials = {
          clientEmail: env.GOOGLE_CLIENT_EMAIL ?? "",
          privateKey: env.GOOGLE_PRIVATE_KEY ?? "",
          project: env.GOOGLE_CLOUD_PROJECT ?? "",
          location: env.GOOGLE_CLOUD_LOCATION ?? "global",
        };
        const model = params.videoModel ?? params.modelName;
        log.info("Veo generate started", { ...ctx.tag, model, hasImage: !!image, refs: referenceImages?.length ?? 0 });
        const result = await generateGoogleVideo(creds, {
          prompt: params.prompt ?? "",
          aspectRatio: params.aspectRatio,
          modelName: model,
          modelParams: params.modelParams,
          image,
          tailImage,
          referenceImages,
        });
        log.info("Veo generated", { ...ctx.tag, model: result.model, bytes: result.data.byteLength });
        const key = await ctx.uploadBytes(result.data, result.mediaType ?? "video/mp4");
        return { storageKey: key, duration: params.duration ?? 8, model: result.model };
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey),
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
          coverR2Key: probe.coverR2Key,
          metadata: { ...probe.metadata, durationMs },
          sourceModel: params.videoModel ?? params.modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
