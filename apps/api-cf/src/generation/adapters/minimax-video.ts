import { log } from "../../logger";
import { generateMiniMaxVideo, type MiniMaxVideoParams } from "../../services/minimax-video";
import {
  appendUnmentionedGlobalReferences,
  type OrderedPromptContentPart,
} from "@clash/shared-types";
import type { GenerationAdapter } from "../adapter";
import { signedMediaUrl, signedMediaUrls } from "./media-url";
import { credentialsForRoute } from "./provider-credentials";

function numberParam(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ratioParam(value: unknown): MiniMaxVideoParams["ratio"] {
  const ratio = typeof value === "string" ? value : "16:9";
  return ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(ratio)
    ? ratio as MiniMaxVideoParams["ratio"]
    : "16:9";
}

async function orderedContentParts(
  env: Parameters<typeof signedMediaUrl>[0],
  params: Parameters<GenerationAdapter["execute"]>[0]["params"],
): Promise<OrderedPromptContentPart[] | undefined> {
  if (params.selectedRoute?.referenceBinding?.type !== "ordered-content-parts") return undefined;

  const inlineParts: OrderedPromptContentPart[] = [];
  const globalReferences: Array<Exclude<OrderedPromptContentPart, { type: "text" }>> = [];
  const signedByKey = new Map<string, Promise<string>>();
  const sign = (key: string) => {
    let pending = signedByKey.get(key);
    if (!pending) {
      pending = signedMediaUrl(env, key);
      signedByKey.set(key, pending);
    }
    return pending;
  };

  for (const part of params.promptParts ?? []) {
    if (part.type === "text") {
      if (typeof part.text === "string" && part.text.length > 0) {
        inlineParts.push({ type: "text", text: part.text });
      }
      continue;
    }
    if (part.type !== "asset_ref" || !part.r2Key || !part.modality) continue;
    inlineParts.push({ type: part.modality, url: await sign(part.r2Key) });
  }

  const appendGlobal = async (
    type: "image" | "video" | "audio",
    keys: string[] | undefined,
  ) => {
    for (const key of keys ?? []) {
      globalReferences.push({ type, url: await sign(key) });
    }
  };
  await appendGlobal("image", params.referenceImageR2Keys);
  await appendGlobal("video", params.referenceVideoR2Keys);
  await appendGlobal("audio", params.referenceAudioR2Keys);

  const result = appendUnmentionedGlobalReferences(inlineParts, globalReferences);
  if (!result.some((part) => part.type === "text") && params.prompt) {
    result.unshift({ type: "text", text: params.prompt });
  }
  return result.length ? result : undefined;
}

export const minimaxVideoAdapter: GenerationAdapter = {
  name: "minimax-video",

  async execute(ctx) {
    const { params, env } = ctx;
    const route = params.selectedRoute;
    if (!route || route.apiShape !== "minimax") {
      throw new Error(`MiniMax video execution requires a selected MiniMax route for ${params.modelName ?? "unknown model"}`);
    }

    const storageKey = await ctx.step(
      "minimax-video-generate",
      { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" }, timeout: "15 minutes" },
      async () => {
        const orderedParts = await orderedContentParts(env, params);
        const [startFrame, endFrame, referenceImages, referenceVideos, referenceAudios] = await Promise.all([
          params.startFrameR2Key ? signedMediaUrl(env, params.startFrameR2Key) : Promise.resolve(undefined),
          params.endFrameR2Key ? signedMediaUrl(env, params.endFrameR2Key) : Promise.resolve(undefined),
          signedMediaUrls(env, params.referenceImageR2Keys),
          signedMediaUrls(env, params.referenceVideoR2Keys),
          signedMediaUrls(env, params.referenceAudioR2Keys),
        ]);
        const credentials = await credentialsForRoute(ctx, route);
        log.info("MiniMax H3 generation started", { ...ctx.tag, model: route.upstreamModel });
        const result = await generateMiniMaxVideo({
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          model: route.upstreamModel,
          prompt: params.prompt ?? "",
          duration: numberParam(params.duration ?? params.modelParams?.duration, 5),
          resolution: params.modelParams?.resolution === "768P" ? "768P" : "2K",
          ratio: ratioParam(params.aspectRatio ?? params.modelParams?.aspect_ratio),
          startFrame,
          endFrame,
          referenceImages,
          referenceVideos,
          referenceAudios,
          orderedContentParts: orderedParts,
        });
        log.info("MiniMax H3 generation completed", { ...ctx.tag, taskId: result.taskId });
        return ctx.uploadFromUrl(result.url, "video/mp4");
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey),
    );
    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () => ctx.createAsset({
        kind: "video",
        srcR2Key: storageKey,
        coverR2Key: probe.coverR2Key,
        metadata: probe.metadata,
        sourceModel: params.modelName,
        sourcePrompt: params.prompt,
      }),
    );
    await ctx.notifyCompleted({ assetId });
  },
};
