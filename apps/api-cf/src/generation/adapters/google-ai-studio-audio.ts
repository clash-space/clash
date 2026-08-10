/**
 * Google Gemini TTS audio generation (gemini-3.1-flash-tts etc.).
 */
import { log } from "../../logger";
import { generateGoogleAudio } from "../../services/google-gen";
import type { GenerationAdapter } from "../adapter";
import { credentialsForRoute } from "./provider-credentials";

export const googleAiStudioAudioAdapter: GenerationAdapter = {
  name: "gemini-tts",

  async execute(ctx) {
    const { params } = ctx;
    const modelName = params.modelName ?? "gemini-3.1-flash-tts";
    const route = params.selectedRoute;
    if (!route || route.apiShape !== "google-ai-studio") {
      throw new Error(`Gemini TTS execution requires a selected Google AI Studio route for ${modelName}`);
    }

    const storageKey = await ctx.step(
      "gemini-tts-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("Gemini TTS started", { ...ctx.tag, model: modelName });
        const credentials = await credentialsForRoute(ctx, route);
        const result = await generateGoogleAudio(credentials.apiKey, {
          prompt: params.prompt ?? "",
          modelName: route.upstreamModel,
          modelParams: params.modelParams,
          baseUrl: credentials.baseUrl,
        });
        log.info("Gemini TTS generated", { ...ctx.tag, model: result.model, bytes: result.data.byteLength });
        return ctx.uploadBytes(result.data, result.mediaType);
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
      async () =>
        ctx.createAsset({
          kind: "audio",
          srcR2Key: storageKey,
          metadata: probe.metadata,
          sourceModel: modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
