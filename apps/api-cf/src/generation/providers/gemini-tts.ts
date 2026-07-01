/**
 * Google Gemini TTS audio generation (gemini-3.1-flash-tts etc.).
 */
import { log } from "../../logger";
import { generateGoogleAudio } from "../../services/google-gen";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";
import { credentialsForProvider } from "./provider-credentials";

export const geminiTtsProvider: GenerationProvider = {
  name: "gemini-tts",

  async execute(ctx) {
    const { params } = ctx;
    const modelName = params.modelName ?? "gemini-3.1-flash-tts";

    const storageKey = await ctx.step(
      "gemini-tts-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("Gemini TTS started", { ...ctx.tag, model: modelName });
        const credentials = await credentialsForProvider(ctx, "official", ["apiKey"], {
          upstreamId: "google",
          region: "global",
          modelCode: modelName,
        });
        const result = await generateGoogleAudio(credentials.apiKey, {
          prompt: params.prompt ?? "",
          modelName,
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
