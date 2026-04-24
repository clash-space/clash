/**
 * Custom Action pipeline — calls an author-deployed CF Worker via HTTP.
 * Injects user variables (secrets) at runtime.
 */
import { log } from "../../logger";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

type CustomActionResult = {
  type?: string;
  url?: string;
  mimeType?: string;
  content?: string;
  description?: string;
  [k: string]: unknown;
};

export const customActionProvider: GenerationProvider = {
  name: "custom-action",

  async execute(ctx) {
    const { params, env } = ctx;

    const secrets = await ctx.step(
      "load-secrets",
      { timeout: "10 seconds" },
      async () => {
        if (!env.ACTION_SECRET_KEY) return {};
        // TODO: resolve userId from project, load declared secret keys.
        return {} as Record<string, string>;
      },
    );

    const result = await ctx.step<CustomActionResult>(
      "execute-action",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "5 minutes" },
      async () => {
        log.info("Calling custom action worker", { ...ctx.tag, workerUrl: params.workerUrl });
        const resp = await fetch(params.workerUrl!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: params.taskId,
            nodeId: params.nodeId,
            projectId: params.projectId,
            actionId: params.customActionId,
            prompt: params.prompt ?? "",
            params: params.customActionParams ?? {},
            secrets,
          }),
        });
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Action worker error ${resp.status}: ${errText}`);
        }
        const data = (await resp.json()) as CustomActionResult;
        log.info("Custom action response", { ...ctx.tag, type: data.type });
        return data;
      },
    );

    let assetId: string | undefined;
    if ((result.type === "image" || result.type === "video" || result.type === "audio") && result.url) {
      const kind = result.type as "image" | "video" | "audio";
      const mime =
        result.mimeType ??
        (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png");

      const storageKey = await ctx.step(
        "upload-result",
        { retries: { limit: 2, delay: "2 seconds" }, timeout: "3 minutes" },
        async () => ctx.uploadFromUrl(result.url!, mime),
      );

      const probe = await ctx.step(
        "probe-custom-asset",
        { retries: { limit: 2, delay: "5 seconds" }, timeout: "2 minutes" },
        async () => ctx.probe(kind, storageKey),
      );

      assetId = await ctx.step(
        "save-asset",
        { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" }, timeout: "30 seconds" },
        async () =>
          ctx.createAsset({
            kind,
            srcR2Key: storageKey,
            coverR2Key: probe.coverR2Key,
            metadata: probe.metadata,
            sourceModel: params.customActionId,
            sourcePrompt: params.prompt,
          }),
      );
    }

    await ctx.notifyCompleted({
      ...(assetId ? { assetId } : {}),
      content: result.content ?? undefined,
      description: result.description ?? undefined,
    });
  },
};
