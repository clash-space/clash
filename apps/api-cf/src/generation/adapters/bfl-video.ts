import { generateBflFlux3Video } from "@clash/shared-runtime";

import { log } from "../../logger";
import type { GenerationAdapter } from "../adapter";
import { signedMediaUrls } from "./media-url";
import { credentialsForRoute } from "./provider-credentials";

export const bflVideoAdapter: GenerationAdapter = {
  name: "bfl-video",

  async execute(ctx) {
    const { params, env } = ctx;
    const route = params.selectedRoute;
    if (!route || route.apiShape !== "bfl") {
      throw new Error(`BFL video execution requires a selected BFL route for ${params.modelName ?? "unknown model"}`);
    }

    const storageKey = await ctx.step(
      "bfl-video-generate",
      { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "30 minutes" },
      async () => {
        const [referenceImageUrls, referenceVideoUrls, credentials] = await Promise.all([
          signedMediaUrls(env, params.referenceImageR2Keys),
          signedMediaUrls(env, params.referenceVideoR2Keys),
          credentialsForRoute(ctx, route),
        ]);
        log.info("BFL FLUX 3 generation started", { ...ctx.tag, model: route.upstreamModel });
        const result = await generateBflFlux3Video({
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          input: {
            prompt: params.prompt ?? "",
            duration: params.duration,
            aspectRatio: params.aspectRatio,
            modelParams: params.modelParams,
            referenceImageUrls,
            referenceVideoUrls,
          },
        });
        log.info("BFL FLUX 3 generation completed", { ...ctx.tag, requestId: result.requestId });
        return ctx.uploadFromUrl(result.url, "video/mp4");
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey),
    );
    const duration = typeof params.duration === "number"
      ? params.duration
      : Number.parseInt(String(params.duration ?? params.modelParams?.duration ?? ""), 10);
    const metadata = {
      ...probe.metadata,
      ...(probe.metadata.durationMs == null && Number.isFinite(duration)
        ? { durationMs: Math.round(duration * 1000) }
        : {}),
    };
    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () => ctx.createAsset({
        kind: "video",
        srcR2Key: storageKey,
        coverR2Key: probe.coverR2Key,
        metadata,
        sourceModel: params.modelName,
        sourcePrompt: params.prompt,
      }),
    );
    await ctx.notifyCompleted({ assetId });
  },
};
