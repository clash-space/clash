/**
 * Google Veo 3.1 video generation — split into submit + poll steps so a
 * DO/Workflow reset mid-generation doesn't re-bill on retry.
 *
 * Step graph:
 *   1. veo-submit  → POST :predictLongRunning, returns operationName
 *                    (cached in workflow step state — survives retries)
 *   2. veo-poll    → POST :fetchPredictOperation in a loop, decode inline
 *                    video, upload to R2. Re-entrant: re-polling the same
 *                    operationName resumes against the same Vertex job.
 *   3. probe-video → dimensions + duration + cover frame
 *   4. save-asset  → D1 row
 *
 * Why split: previously a single `vertex-generate` step wrapped the AI SDK's
 * `experimental_generateVideo`, which awaits the LRO internally and hides
 * the operationName. Veo bills $0.50/sec — a single retry can cost $2-5,
 * and DO resets (deploys, code updates) happened often enough to matter.
 */
import { log } from "../../logger";
import {
  submitVeoOperation,
  pollVeoOperation,
  type VertexInlineImage,
} from "../../services/google-gen";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

export const veoProvider: GenerationProvider = {
  name: "veo",

  async execute(ctx: GenerationContext): Promise<void> {
    const { params, env } = ctx;

    // Step 1: submit. Inline image bytes (R2 reads kept inside the step —
    // base64 of a 1280×720 PNG is 1-2 MiB, exceeds Workflows' 1 MiB step
    // output cap so they can't cross a step boundary). Output is just the
    // operation name + model id, both small strings.
    const { operationName, modelId } = await ctx.step(
      "veo-submit",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "2 minutes" },
      async () => {
        const read = (k?: string): Promise<VertexInlineImage | undefined> =>
          k ? ctx.readR2Base64(k) : Promise.resolve(undefined);
        const readAll = async (keys?: string[]): Promise<VertexInlineImage[] | undefined> => {
          if (!keys?.length) return undefined;
          return Promise.all(keys.map((k) => ctx.readR2Base64(k)));
        };
        const [image, tailImage, referenceImages] = await Promise.all([
          read(params.startFrameR2Key),
          read(params.endFrameR2Key),
          readAll(params.referenceImageR2Keys),
        ]);
        const modelName = params.videoModel ?? params.modelName;
        log.info("Veo submit", {
          ...ctx.tag,
          model: modelName,
          hasImage: !!image,
          hasTail: !!tailImage,
          refs: referenceImages?.length ?? 0,
        });
        const result = await submitVeoOperation(env, {
          prompt: params.prompt ?? "",
          aspectRatio: params.aspectRatio,
          modelName,
          modelParams: params.modelParams,
          image,
          tailImage,
          referenceImages,
        });
        log.info("Veo operation submitted", { ...ctx.tag, operationName: result.operationName });
        return result;
      },
    );

    // Step 2: poll until done + upload to R2. Bytes stay inside the step;
    // only the storage key (small string) crosses to the next step.
    const storageKey = await ctx.step(
      "veo-poll",
      { retries: { limit: 2, delay: "10 seconds" }, timeout: "10 minutes" },
      async () => {
        const { bytes, mediaType } = await pollVeoOperation(env, modelId, operationName, {
          intervalMs: 5000,
          maxWaitMs: 9 * 60 * 1000,
        });
        log.info("Veo operation done", { ...ctx.tag, bytes: bytes.byteLength });
        return ctx.uploadBytes(bytes, mediaType);
      },
    );

    const probe = await ctx.step(
      "probe-video",
      { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
      async () => ctx.probe("video", storageKey),
    );

    const durationMs =
      probe.metadata.durationMs ??
      (typeof params.duration === "number" ? Math.round(params.duration * 1000) : undefined);

    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () =>
        ctx.createAsset({
          kind: "video",
          srcR2Key: storageKey,
          coverR2Key: probe.coverR2Key,
          metadata: { ...probe.metadata, durationMs },
          sourceModel: params.videoModel ?? params.modelName,
          sourcePrompt: params.prompt,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
