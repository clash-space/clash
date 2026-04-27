/**
 * Timeline render — proxies to render-server (ffmpeg) OR CF Container.
 */
import { log } from "../../logger";
import { renderServerFetch } from "../../services/thumbnail";
import { getRenderMetadataFromHeaders } from "../../services/render-metadata";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

export const videoRenderProvider: GenerationProvider = {
  name: "video-render",

  async execute(ctx) {
    const { params, env } = ctx;

    const { storageKey, metadata } = await ctx.step(
      "render",
      { retries: { limit: 1, delay: "10 seconds" }, timeout: "15 minutes" },
      async () => {
        log.info("Render started", ctx.tag);
        const resp = await renderServerFetch(env, "/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            timelineDsl: params.timelineDsl,
            projectId: params.projectId,
            taskId: params.taskId,
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Render server error ${resp.status}: ${errText}`);
        }
        const key = `projects/${params.projectId}/renders/${params.taskId}.mp4`;
        // R2.put on a ReadableStream requires a known length; container fetch
        // body doesn't propagate Content-Length cleanly, so buffer the MP4
        // (small enough, capped by render-server output) and upload as bytes.
        const bytes = await resp.arrayBuffer();
        await env.R2_BUCKET.put(key, bytes, {
          httpMetadata: { contentType: "video/mp4" },
        });
        const meta = getRenderMetadataFromHeaders(resp.headers, params.timelineDsl);
        log.info("Render uploaded to R2", { ...ctx.tag, storageKey: key, metadata: meta });
        return { storageKey: key, metadata: meta };
      },
    );

    const assetId = await ctx.step(
      "save-asset",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
      async () =>
        ctx.createAsset({
          kind: "video",
          srcR2Key: storageKey,
          metadata,
        }),
    );

    await ctx.notifyCompleted({ assetId });
  },
};
