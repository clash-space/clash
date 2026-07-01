import { log } from "../../logger";
import { generateMiniMaxAudio } from "../../services/minimax-audio";
import type { GenerationProvider } from "../provider";
import { credentialsForProvider } from "./provider-credentials";

export const minimaxAudioProvider: GenerationProvider = {
  name: "minimax-audio",

  async execute(ctx) {
    const { params, env } = ctx;
    const modelName = params.modelName ?? "minimax-tts";

    const storageKey = await ctx.step(
      "minimax-audio-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("MiniMax TTS started", { ...ctx.tag, model: modelName });
        const credentials = await credentialsForProvider(ctx, "minimax", ["apiKey"], {
          upstreamId: "minimax",
          modelCode: modelName,
        });
        const result = await generateMiniMaxAudio(credentials.apiKey, {
          prompt: params.prompt ?? "",
          modelName,
          modelParams: params.modelParams,
          baseUrl: credentials.baseUrl,
        });
        log.info("MiniMax TTS generated", { ...ctx.tag, model: result.model, bytes: result.data.byteLength });
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
