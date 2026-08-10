import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

/**
 * What the host hands an executor. One shape for every provider.
 *
 * `endpoint` is resolved by the host, not discovered here: which MiniMax answers, which fal queue
 * to use, which Vertex region — those are account facts, and a plugin that looked them up itself
 * would be guessing at something it was not told.
 */
export interface ExecutorContext {
  fetch?: typeof globalThis.fetch;
  apiKey?: string;
  endpoint?: string;
  queueBaseUrl?: string;
}

/** An output slot, already in the shape the host stores. */
export interface ExecutorOutput {
  slot: string;
  kind: "value" | "asset";
  value?: Record<string, unknown>;
  asset?: Record<string, unknown>;
}

export type ExecutorStep =
  | { status: "accepted"; pollState: unknown; retryAfterMs?: number }
  | { status: "completed"; outputs: ExecutorOutput[] };

/**
 * Every provider executor is the same two questions.
 *
 * Send it, and later: is it done yet. Nothing else belongs here — no waiting, no retry budget, no
 * opinion about how often to ask. Those were per-plugin decisions once, and the result was eight
 * hand-written loops with ceilings between 108 and 300 attempts, each one holding the upstream
 * task id in a local variable that a restart erased.
 *
 * Declaring the pair as one interface is what keeps the next executor from growing its own.
 */
export interface ProviderExecutor {
  submit(invocation: ExecutablePluginInvocation, context: ExecutorContext): Promise<ExecutorStep>;
  poll(invocation: ExecutablePluginInvocation, context: ExecutorContext): Promise<ExecutorStep>;
}

/** The value channel, which is what a provider-hosted URL travels through. */
export function valueOutput(value: Record<string, unknown>, slot = "media"): ExecutorOutput[] {
  return [{ slot, kind: "value", value }];
}
