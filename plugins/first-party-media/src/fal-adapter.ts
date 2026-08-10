import { falSubmit, falPoll, type FalPollState } from "./fal-executor";
import { valueOutput, type ExecutorContext, type ExecutorStep, type ProviderExecutor } from "./executor-contract";
import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

function readPollState(value: unknown): FalPollState {
  // Opaque to the host, so it arrives typed as anything. The plugin that issued it is the only
  // party that can say whether it is intact: a truncated or hand-edited record would otherwise be
  // polled as though it were valid.
  const requestId = (value as { requestId?: unknown } | null)?.requestId;
  const endpoint = (value as { endpoint?: unknown } | null)?.endpoint;
  if (typeof requestId !== "string" || !requestId || typeof endpoint !== "string" || !endpoint) {
    throw new Error("fal poll state is missing its request id or endpoint.");
  }
  return { requestId, endpoint };
}

function kindOf(invocation: ExecutablePluginInvocation): "image" | "video" | "audio" {
  const kind = invocation.input.values.kind;
  return kind === "image" || kind === "audio" ? kind : "video";
}

export const falAdapter: ProviderExecutor = {
  async submit(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    const submitted = await falSubmit({
      endpoint: context.endpoint ?? String(invocation.input.values.endpoint ?? ""),
      apiKey: context.apiKey ?? "",
      body: (invocation.input.values.body as Record<string, unknown>) ?? invocation.input.values,
      fetch: (context.fetch ?? globalThis.fetch) as never,
      ...(context.queueBaseUrl ? { queueBaseUrl: context.queueBaseUrl } : {}),
    });
    return { status: "accepted", pollState: submitted.pollState };
  },
  async poll(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    const result = await falPoll({
      state: readPollState(invocation.pollState),
      apiKey: context.apiKey ?? "",
      kind: kindOf(invocation),
      fetch: (context.fetch ?? globalThis.fetch) as never,
      ...(context.queueBaseUrl ? { queueBaseUrl: context.queueBaseUrl } : {}),
    });
    if (result.status === "accepted") return { status: "accepted", pollState: result.pollState };
    return { status: "completed", outputs: valueOutput({ url: result.media.url, requestId: result.requestId }) };
  },
};
