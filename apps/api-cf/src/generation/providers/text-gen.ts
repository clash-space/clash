/**
 * Text generation via OpenAI-compatible gateway (CF AI Gateway).
 * No asset output — result lands on node.data.content.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { log } from "../../logger";
import type { GenerationContext } from "../context";
import type { GenerationProvider } from "../provider";

export const textGenProvider: GenerationProvider = {
  name: "text-gen",

  async execute(ctx) {
    const { params, env } = ctx;

    const content = await ctx.step(
      "generate-text",
      { retries: { limit: 2, delay: "5 seconds", backoff: "exponential" }, timeout: "3 minutes" },
      async () => {
        const openai = createOpenAI({
          apiKey: env.CF_AIG_TOKEN,
          baseURL: env.CF_AIG_OPENAI_URL,
        });
        const modelName = params.modelName || env.AI_MODEL || "gpt-5.4";
        const systemPrompt =
          typeof params.modelParams?.system_prompt === "string"
            ? params.modelParams.system_prompt.trim()
            : "";
        log.info("Text generate started", { ...ctx.tag, model: modelName });
        const result = await generateText({
          model: openai.chat(modelName),
          ...(systemPrompt ? { system: systemPrompt } : {}),
          prompt: params.prompt ?? "",
        });
        if (!result.text) throw new Error("No text generated");
        return result.text;
      },
    );

    await ctx.notifyCompleted({ content });
  },
};
