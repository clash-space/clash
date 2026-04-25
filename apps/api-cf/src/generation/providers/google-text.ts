/**
 * Gemini text generation via Vertex. Mirrors text-gen.ts but routes through
 * @ai-sdk/google-vertex. Accepts inline image / video / audio refs alongside
 * the prompt — Gemini is multimodal across all four input types.
 * No asset output — result lands on node.data.content.
 */
import { log } from "../../logger";
import { generateGoogleText, type VertexCredentials } from "../../services/google-gen";
import type { GenerationProvider } from "../provider";
import { buildMultimodalUserMessage } from "../multimodal";

export const googleTextProvider: GenerationProvider = {
  name: "google-text",

  async execute(ctx) {
    const { params, env } = ctx;

    const content = await ctx.step(
      "google-text-generate",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "3 minutes" },
      async () => {
        const creds: VertexCredentials = {
          clientEmail: env.GOOGLE_CLIENT_EMAIL ?? "",
          privateKey: env.GOOGLE_PRIVATE_KEY ?? "",
          project: env.GOOGLE_CLOUD_PROJECT ?? "",
          location: env.GOOGLE_CLOUD_LOCATION ?? "global",
        };
        const systemPrompt =
          typeof params.modelParams?.system_prompt === "string"
            ? params.modelParams.system_prompt.trim()
            : "";
        const userMessage = await buildMultimodalUserMessage(ctx, params);
        log.info("Gemini text generate started", {
          ...ctx.tag,
          model: params.modelName,
          parts: userMessage.content.length,
        });
        const result = await generateGoogleText(creds, {
          messages: [userMessage],
          modelName: params.modelName,
          systemPrompt: systemPrompt || undefined,
        });
        return result.text;
      },
    );

    await ctx.notifyCompleted({ content });
  },
};
