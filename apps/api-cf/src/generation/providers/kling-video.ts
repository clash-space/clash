import { log } from "../../logger";
import { generateVideo as generateKlingVideo } from "../../services/kling";
import type { GenerationProvider } from "../provider";
import { signedMediaUrl } from "./media-url";
import { credentialsForRoute } from "./provider-credentials";

export const klingVideoProvider: GenerationProvider = {
  name: "kling-video",

  async execute(ctx) {
    const { params, env } = ctx;
    const modelName = params.videoModel ?? params.modelName ?? "kling-3";
    const route = params.selectedRoute;
    if (!route || route.apiShape !== "kling") {
      throw new Error(`Kling execution requires a selected Kling route for ${modelName}`);
    }

    const sourceImageUrl = await ctx.step(
      "resolve-source",
      { retries: { limit: 2, delay: "2 seconds" }, timeout: "1 minute" },
      async () => {
        const sourceKey = params.startFrameR2Key ?? params.referenceImageR2Keys?.[0];
        if (!sourceKey) throw new Error("Kling video generation requires a start frame image.");
        return signedMediaUrl(env, sourceKey);
      },
    );

    const { storageKey, providerCoverKey, duration } = await ctx.step(
      "kling-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => {
        log.info("Kling video generate started", { ...ctx.tag, model: modelName });
        const credentials = await credentialsForRoute(ctx, route);
        const result = await generateKlingVideo(
          {
            accessKey: credentials.accessKey,
            secretKey: credentials.secretKey,
            apiUrl: credentials.baseUrl,
          },
          {
            image: sourceImageUrl,
            prompt: params.prompt,
            duration: typeof params.duration === "number" ? params.duration : Number.parseInt(String(params.duration ?? "5"), 10),
            cfgScale: params.cfgScale,
            model: route.upstreamModel,
          },
        );
        log.info("Kling video generated", { ...ctx.tag, taskId: result.taskId });
        const key = await ctx.uploadFromUrl(result.url, "video/mp4");
        let coverKey: string | undefined;
        if (result.coverImageUrl) {
          try {
            coverKey = await ctx.uploadFromUrl(result.coverImageUrl, "image/jpeg", "-cover");
          } catch (error) {
            log.error("Kling cover upload failed", { ...ctx.tag, error: String(error) });
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
          sourceModel: modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
