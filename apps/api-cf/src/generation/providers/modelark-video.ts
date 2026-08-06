import { log } from "../../logger";
import { generateModelArkVideo } from "../../services/modelark-video";
import type { GenerationProvider } from "../provider";
import { signedMediaUrl, signedMediaUrls } from "./media-url";
import { credentialsForRoute } from "./provider-credentials";
import { positionalReferencePrompt } from "./positional-reference-prompt";

type ModelArkProviderKind = "volcengine";

function createModelArkVideoProvider(kind: ModelArkProviderKind): GenerationProvider {
  return {
    name: `${kind}-video`,

    async execute(ctx) {
      const { params, env } = ctx;
      const modelName = params.videoModel ?? params.modelName ?? "seedance-2-ref";
      const route = params.selectedRoute;
      if (!route || route.apiShape !== "modelark") {
        throw new Error(`ModelArk execution requires a selected ModelArk route for ${modelName}`);
      }

      const sources = await ctx.step(
        `${kind}-resolve-sources`,
        { retries: { limit: 2, delay: "2 seconds" }, timeout: "2 minutes" },
        async () => {
          const [startFrameUrl, endFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls] =
            await Promise.all([
              params.startFrameR2Key ? signedMediaUrl(env, params.startFrameR2Key) : Promise.resolve(undefined),
              params.endFrameR2Key ? signedMediaUrl(env, params.endFrameR2Key) : Promise.resolve(undefined),
              signedMediaUrls(env, params.referenceImageR2Keys),
              signedMediaUrls(env, params.referenceVideoR2Keys),
              signedMediaUrls(env, params.referenceAudioR2Keys),
            ]);
          return { startFrameUrl, endFrameUrl, referenceImageUrls, referenceVideoUrls, referenceAudioUrls };
        },
      );

      const { storageKey, providerCoverKey, duration } = await ctx.step(
        `${kind}-generate`,
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
        async () => {
          log.info("ModelArk video generate started", { ...ctx.tag, provider: kind, model: modelName });
          const credentials = await credentialsForRoute(ctx, route);
          const result = await generateModelArkVideo(credentials.apiKey, {
            baseUrl: credentials.baseUrl ?? "https://ark.cn-beijing.volces.com/api/v3",
            prompt: positionalReferencePrompt(params),
            modelName,
            upstreamModel: route.upstreamModel,
            startFrameUrl: sources.startFrameUrl,
            endFrameUrl: sources.endFrameUrl,
            referenceImageUrls: sources.referenceImageUrls,
            referenceVideoUrls: sources.referenceVideoUrls,
            referenceAudioUrls: sources.referenceAudioUrls,
            duration: params.duration,
            aspectRatio: params.aspectRatio,
            modelParams: params.modelParams,
          });
          log.info("ModelArk video generated", { ...ctx.tag, provider: kind, taskId: result.taskId });
          const key = await ctx.uploadFromUrl(result.url, "video/mp4");
          let coverKey: string | undefined;
          if (result.coverImageUrl) {
            try {
              coverKey = await ctx.uploadFromUrl(result.coverImageUrl, "image/jpeg", "-cover");
            } catch (error) {
              log.error("ModelArk cover upload failed", { ...ctx.tag, provider: kind, error: String(error) });
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
}

export const volcengineVideoProvider = createModelArkVideoProvider("volcengine");
