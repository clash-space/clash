import type { ModelMessage } from "ai";
import type { ProviderType } from "../providers";

const ANTHROPIC_CACHE = {
  anthropic: { cacheControl: { type: "ephemeral" as const } },
} as const;

/**
 * Add Anthropic cache_control breakpoints to messages for prompt caching.
 *
 * Strategy: place a cache breakpoint at the penultimate user message so that
 * on each turn, only the last user message + new assistant response are
 * billed as uncached input tokens. Everything before is cached at 90% discount.
 *
 * For OpenAI, this is a no-op — OpenAI auto-caches matching prefixes ≥1024 tokens.
 */
export function withCacheControl(
  messages: ModelMessage[],
  provider: ProviderType,
): ModelMessage[] {
  if (provider !== "anthropic") return messages;

  const result = messages.map((m) => ({ ...m }));

  // Find the last user message index (the new input — don't cache it)
  let lastUserIdx = -1;
  for (let i = result.length - 1; i >= 0; i--) {
    if (result[i].role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  // Find the penultimate user message — cache everything up to here
  let penultimateUserIdx = -1;
  for (let i = lastUserIdx - 1; i >= 0; i--) {
    if (result[i].role === "user") {
      penultimateUserIdx = i;
      break;
    }
  }

  if (penultimateUserIdx >= 0) {
    result[penultimateUserIdx] = {
      ...result[penultimateUserIdx],
      providerOptions: {
        ...result[penultimateUserIdx].providerOptions,
        ...ANTHROPIC_CACHE,
      },
    } as ModelMessage;
  }

  return result;
}

/**
 * Build the system prompt with cache control for Anthropic.
 *
 * Returns a plain string (OpenAI) or a SystemModelMessage with
 * cache_control (Anthropic) for the `system` parameter of streamText().
 */
export function cachedSystemPrompt(
  prompt: string,
  provider: ProviderType,
): string | { role: "system"; content: string; providerOptions: typeof ANTHROPIC_CACHE } {
  if (provider !== "anthropic") return prompt;

  return {
    role: "system" as const,
    content: prompt,
    providerOptions: ANTHROPIC_CACHE,
  };
}
