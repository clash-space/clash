import { log } from "../../logger";
import { generateFalAudio } from "../../services/fal-audio";
import type { GenerationProvider } from "../provider";
import { credentialsForRoute } from "./provider-credentials";

export const falAudioProvider: GenerationProvider = {
  name: "fal-audio",

  async execute(ctx) {
    const { params } = ctx;
    const route = params.selectedRoute;
    if (!route || route.apiShape !== "fal") {
      throw new Error(`fal audio execution requires a selected fal route for ${params.modelName ?? "unknown model"}`);
    }
    const credentials = await credentialsForRoute(ctx, route);

    const storageKey = await ctx.step(
      "fal-audio-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "10 minutes" },
      async () => {
        log.info("fal audio generation started", { ...ctx.tag, model: route.upstreamModel });
        const result = await generateFalAudio(credentials.apiKey, {
          prompt: params.prompt ?? "",
          modelEndpoint: route.upstreamModel,
          modelParams: params.modelParams,
        });
        log.info("fal audio generation completed", { ...ctx.tag, model: result.model, requestId: result.requestId });
        return ctx.uploadFromUrl(result.url, result.contentType);
      },
    );

    const probe = await ctx.step(
      "probe-audio",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("audio", storageKey),
    );
    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () => ctx.createAsset({
        kind: "audio",
        srcR2Key: storageKey,
        metadata: probe.metadata,
        sourceModel: params.modelName,
        sourcePrompt: params.prompt,
      }),
    );
    await ctx.notifyCompleted({ assetId });
  },
};
