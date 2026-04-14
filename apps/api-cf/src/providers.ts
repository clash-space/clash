import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";
import type { Env } from "./config";

export type ProviderType = "openai" | "anthropic";

/**
 * Create the AI model from environment config.
 *
 * Supports:
 * - `openai` (default): uses CF AI Gateway with automatic prefix caching (≥1024 token prefix)
 * - `anthropic`: uses @ai-sdk/anthropic with explicit cache_control breakpoints (90% savings)
 *
 * Set AI_PROVIDER=anthropic and ANTHROPIC_API_KEY in env to use Anthropic.
 */
export function createModel(env: Env): { model: LanguageModel; provider: ProviderType } {
  const providerType = (env.AI_PROVIDER as ProviderType) || "openai";

  if (providerType === "anthropic") {
    const anthropic = createAnthropic({
      apiKey: env.ANTHROPIC_API_KEY!,
      ...(env.CF_AIG_ANTHROPIC_URL ? { baseURL: env.CF_AIG_ANTHROPIC_URL } : {}),
    });
    return {
      model: anthropic(env.AI_MODEL || "claude-sonnet-4-20250514"),
      provider: "anthropic",
    };
  }

  // Default: OpenAI via CF AI Gateway
  const openai = createOpenAI({
    apiKey: env.CF_AIG_TOKEN,
    baseURL: env.CF_AIG_OPENAI_URL,
  });
  return {
    model: openai.chat(env.AI_MODEL || "gpt-5.4"),
    provider: "openai",
  };
}
