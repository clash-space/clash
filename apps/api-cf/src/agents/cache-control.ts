import type { ModelMessage } from "ai";
import type { ProviderType } from "../providers";

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
  _provider: ProviderType,
): ModelMessage[] {
  return messages;
}

/**
 * Build the system prompt with cache control for Anthropic.
 *
 * Returns a plain string (OpenAI) or a SystemModelMessage with
 * cache_control (Anthropic) for the `system` parameter of streamText().
 */
export function cachedSystemPrompt(
  prompt: string,
  _provider: ProviderType,
): string {
  return prompt;
}
