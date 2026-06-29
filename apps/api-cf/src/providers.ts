import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import type { Env } from "./config";

export type ProviderType = "openai";

/**
 * Create the internal AI model from platform config.
 * User model providers and BYOK credentials are resolved from provider_account,
 * not process environment variables.
 */
export function createModel(env: Env): { model: LanguageModel; provider: ProviderType } {
  const openai = createOpenAI({
    apiKey: env.CF_AIG_TOKEN,
    baseURL: env.CF_AIG_OPENAI_URL,
  });
  return {
    model: openai.chat(env.AI_MODEL || "gpt-5.4"),
    provider: "openai",
  };
}
