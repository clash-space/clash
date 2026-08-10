import { log } from "../../logger";
import { generateSunoAudio } from "../../services/suno-audio";
import type { GenerationAdapter } from "../adapter";
import { credentialsForRoute } from "./provider-credentials";

export const sunoAudioAdapter: GenerationAdapter = {
  name: "suno-audio",

  async execute(ctx) {
    const { params, env } = ctx;
    const route = params.selectedRoute;
    if (!route || route.apiShape !== "suno") {
      throw new Error(`Suno execution requires a selected Suno route for ${params.modelName ?? "unknown model"}`);
    }
    const credentials = await credentialsForRoute(ctx, route);
    const publicOrigin = credentials.callbackUrl || env.WORKER_PUBLIC_URL;
    if (!publicOrigin) {
      throw new Error("Suno provider requires callbackUrl credentials or WORKER_PUBLIC_URL.");
    }
    const callbackUrl = credentials.callbackUrl ||
      `${publicOrigin.replace(/\/+$/, "")}/api/v1/provider-callbacks/suno`;

    const storageKey = await ctx.step(
      "suno-audio-generate",
      { retries: { limit: 1, delay: "10 seconds" }, timeout: "10 minutes" },
      async () => {
        log.info("Suno generation started", { ...ctx.tag, model: route.upstreamModel });
        const result = await generateSunoAudio({
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          callbackUrl,
          prompt: params.prompt ?? "",
          model: route.upstreamModel,
          modelParams: params.modelParams,
        });
        log.info("Suno generation completed", { ...ctx.tag, taskId: result.taskId, model: result.model });
        return ctx.uploadFromUrl(result.url, "audio/mpeg");
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
