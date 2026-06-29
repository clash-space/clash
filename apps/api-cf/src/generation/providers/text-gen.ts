/**
 * Text generation via OpenAI-compatible or Anthropic-compatible chat APIs.
 * Text and image refs are adapted through shared-runtime; Google text keeps
 * its dedicated provider for broader multimodal support.
 * No asset output — result lands on node.data.content.
 */
import { generateTextCompletion, type TextContentPart } from "@clash/shared-runtime";
import { resolveModelUpstreamRoute } from "@clash/shared-types";
import { log } from "../../logger";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";
import { buildMultimodalUserMessage } from "../multimodal";
import { credentialsForProvider, credentialsForRoute } from "./provider-credentials";

function sharedContentParts(content: Awaited<ReturnType<typeof buildMultimodalUserMessage>>["content"]): TextContentPart[] {
  return content.flatMap((part): TextContentPart[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "image") return [{ type: "image", data: part.image, mediaType: part.mediaType }];
    return [];
  });
}

export const textGenProvider: GenerationProvider = {
  name: "text-gen",

  async execute(ctx) {
    const { params, env } = ctx;

    const content = await ctx.step(
      "generate-text",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "3 minutes" },
      async () => {
        const modelName = params.modelName || env.AI_MODEL || "gpt-5.4";
        const route = resolveModelUpstreamRoute({
          modelCode: modelName,
          kind: "text",
          configuredUpstreams: [
            { upstreamId: "openai", enabled: true },
            { upstreamId: "anthropic", enabled: true },
          ],
        });
        const provider = route?.apiShape === "anthropic-compatible"
          ? "anthropic-compatible"
          : "openai-compatible";
        const credentials = route
          ? await credentialsForRoute(ctx, route)
          : await credentialsForProvider(ctx, "official", ["apiKey"], { upstreamId: "openai", region: "global" });
        const systemPrompt =
          typeof params.modelParams?.system_prompt === "string"
            ? params.modelParams.system_prompt.trim()
            : "";
        const configuredModelName =
          typeof params.modelParams?.model_name === "string" && params.modelParams.model_name.trim()
            ? params.modelParams.model_name.trim()
            : "";
        const userMessage = await buildMultimodalUserMessage(ctx, params);
        log.info("Text generate started", {
          ...ctx.tag,
          model: configuredModelName || route?.upstreamModel || modelName,
          provider,
          parts: userMessage.content.length,
        });
        const result = await generateTextCompletion({
          provider,
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          model: configuredModelName || route?.upstreamModel || modelName,
          systemPrompt: systemPrompt || undefined,
          messages: [{ role: "user", content: sharedContentParts(userMessage.content) }],
        });
        return result.text;
      },
    );

    await ctx.notifyCompleted({ content });
  },
};
