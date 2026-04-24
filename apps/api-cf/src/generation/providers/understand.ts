/**
 * Media understanding: ASR (audio/video) + visual analysis (image/video).
 * Writes results to node.data.understanding.
 */
import { fal } from "@fal-ai/client";
import { log } from "../../logger";
import { transcribeAudio } from "../../services/asr";
import { analyzeVisual } from "../../services/visual-understanding";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

async function uploadR2ToFal(bucket: R2Bucket, key: string, falApiKey: string): Promise<string> {
  fal.config({ credentials: falApiKey });
  const obj = await bucket.get(key);
  if (!obj) throw new Error(`R2 object not found: ${key}`);
  const buf = await obj.arrayBuffer();
  const ct = obj.httpMetadata?.contentType || "audio/mpeg";
  return fal.storage.upload(new Blob([buf], { type: ct }));
}

export const understandProvider: GenerationProvider = {
  name: "understand",

  async execute(ctx) {
    const { params, env } = ctx;
    const r2Key = params.r2Key;
    const mime = params.mimeType ?? "";
    if (!r2Key) throw new Error("understand task requires r2Key");

    const isAudio = mime.startsWith("audio/");
    const isVideo = mime.startsWith("video/");
    const isImage = mime.startsWith("image/");
    const understanding: Record<string, unknown> = {};

    if (isAudio || isVideo) {
      understanding.transcription = await ctx.step(
        "transcribe",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
        async () => {
          log.info("ASR started", ctx.tag);
          const audioUrl = await uploadR2ToFal(env.R2_BUCKET, r2Key, env.FAL_API_KEY ?? "");
          const result = await transcribeAudio(env.FAL_API_KEY ?? "", audioUrl, {
            language: params.language,
          });
          log.info("ASR completed", {
            ...ctx.tag,
            textLength: result.text.length,
            segments: result.segments.length,
          });
          return result;
        },
      );
    }

    if (isImage || isVideo) {
      understanding.visual = await ctx.step(
        "visual-analyze",
        { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "3 minutes" },
        async () => {
          log.info("Visual analysis started", ctx.tag);
          const dataUri = await ctx.readR2DataUri(r2Key);
          const result = await analyzeVisual(env.AI, dataUri);
          log.info("Visual analysis completed", {
            ...ctx.tag,
            hasDescription: !!result.description,
            shots: result.shots?.length,
          });
          return result;
        },
      );
    }

    await ctx.notify({
      pendingTask: undefined,
      understanding,
      _log: undefined,
    });
  },
};
