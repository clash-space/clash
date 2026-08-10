/**
 * Text generation via OpenAI-compatible or Anthropic-compatible chat APIs.
 * Text and image refs are adapted through shared-runtime; Google text keeps
 * its dedicated provider for broader multimodal support.
 * No asset output — result lands on node.data.content.
 */
import { generatePikaChat, generateTextCompletion, type TextContentPart } from "@clash/shared-runtime";
import { log } from "../../logger";
import type { GenerationAdapter } from "../adapter";
import { buildMultimodalUserMessage } from "../multimodal";
import { credentialsForRoute } from "./provider-credentials";
import { appendProviderUsageEvent } from "../../services/provider-usage";

function sharedContentParts(content: Awaited<ReturnType<typeof buildMultimodalUserMessage>>["content"]): TextContentPart[] {
  return content.flatMap((part): TextContentPart[] => {
    if (part.type === "text") return [{ type: "text", text: part.text }];
    if (part.type === "image") return [{ type: "image", data: part.image, mediaType: part.mediaType }];
    return [];
  });
}

export const textGenAdapter: GenerationAdapter = {
  name: "text-gen",

  async execute(ctx) {
    const { params } = ctx;
    const route = params.selectedRoute;
    if (!route || !["openai-compatible", "anthropic-compatible", "pika-chat"].includes(route.apiShape)) {
      throw new Error(`Text execution requires a selected compatible route for ${params.modelName ?? "unknown model"}`);
    }

    const content = await ctx.step(
      "generate-text",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "3 minutes" },
      async () => {
        const provider = route.apiShape === "anthropic-compatible"
          ? "anthropic-compatible"
          : route.apiShape === "pika-chat" ? "pika" : "openai-compatible";
        const credentials = await credentialsForRoute(ctx, route);
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
          model: configuredModelName || route.upstreamModel,
          provider,
          parts: userMessage.content.length,
        });
        if (route.apiShape === "pika-chat") {
          const textPrompt = userMessage.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          try {
            const result = await generatePikaChat({
              apiKey: credentials.apiKey,
              baseUrl: credentials.baseUrl,
              model: route.upstreamModel,
              prompt: textPrompt,
              systemPrompt: systemPrompt || undefined,
            });
            await appendProviderUsageEvent(ctx.env.DB, {
              id: `${params.taskId}:pika:${result.requestId ?? "sync"}:completed`,
              userId: params.actorUserId, providerId: "pika", ...(route.accountId ? { providerAccountId: route.accountId } : {}),
              modelId: route.modelCode, operation: route.upstreamModel, taskId: params.taskId, projectId: params.projectId,
              nodeId: params.nodeId, actorType: params.actorType, actorUserId: params.actorUserId,
              ...(params.actorAgentId ? { actorAgentId: params.actorAgentId } : {}),
              ...(result.requestId ? { providerRequestId: result.requestId } : {}),
              idempotencyKey: params.taskId, status: "completed", estimateComplete: false,
              currency: "USD", pricingSource: "unavailable", billingBasis: result.usage ?? {}, occurredAt: new Date().toISOString(),
            });
            return result;
          } catch (error) {
            await appendProviderUsageEvent(ctx.env.DB, {
              id: `${params.taskId}:pika:sync:failed`, userId: params.actorUserId, providerId: "pika",
              modelId: route.modelCode, operation: route.upstreamModel, taskId: params.taskId, projectId: params.projectId,
              nodeId: params.nodeId, actorType: params.actorType, actorUserId: params.actorUserId,
              idempotencyKey: params.taskId, status: "failed", estimateComplete: false,
              currency: "USD", pricingSource: "unavailable", billingBasis: {},
              errorMessage: error instanceof Error ? error.message : String(error), occurredAt: new Date().toISOString(),
            });
            throw error;
          }
        }
        const result = await generateTextCompletion({
          provider,
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
          model: configuredModelName || route.upstreamModel,
          systemPrompt: systemPrompt || undefined,
          messages: [{ role: "user", content: sharedContentParts(userMessage.content) }],
        });
        return result;
      },
    );

    await ctx.notifyCompleted({ content: content.text });
  },
};
