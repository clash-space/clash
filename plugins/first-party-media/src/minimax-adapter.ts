import { minimaxSubmit, minimaxPoll, type MinimaxPollState } from "./minimax-executor";
import { valueOutput, type ExecutorContext, type ExecutorStep, type ProviderExecutor } from "./executor-contract";

function readPollState(value: unknown): MinimaxPollState {
  if (!value || typeof value !== "object") throw new Error("MiniMax poll state is missing.");
  const taskId = (value as { taskId?: unknown }).taskId;
  if (typeof taskId !== "string" || !taskId) throw new Error("MiniMax poll state is missing its taskId.");
  return { taskId };
}

export const minimaxAdapter: ProviderExecutor = {
  async submit(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    const submitted = await minimaxSubmit({
      kind: invocation.input.values.kind === "audio" ? "audio" : "video",
      apiKey: context.apiKey ?? "",
      body: (invocation.input.values.body as Record<string, unknown>) ?? invocation.input.values,
      fetch: (context.fetch ?? globalThis.fetch) as never,
      // Which MiniMax answers is the account's fact, resolved by the host: an international key is
      // unknown to the domestic host, and the refusal arrives as an authentication error.
      ...(context.endpoint ? { baseUrl: context.endpoint } : {}),
      ...(invocation.input.values.musicEndpoint ? { musicEndpoint: true } : {}),
    });
    // One provider, two lifecycles: video queues and is polled, speech hands back bytes on the
    // first call. Returning the finished arm rather than inventing a task id for the audio path is
    // what keeps the poll contract describing something real.
    if (submitted.status === "completed") {
      return {
        status: "completed",
        outputs: [{
          slot: "media",
          kind: "asset",
          asset: {
            kind: "inline",
            dataBase64: Buffer.from(submitted.media.bytes).toString("base64"),
            mimeType: submitted.media.contentType,
          },
        }],
      };
    }
    return { status: "accepted", pollState: submitted.pollState };
  },
  async poll(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    const result = await minimaxPoll({
      state: readPollState(invocation.pollState),
      apiKey: context.apiKey ?? "",
      fetch: (context.fetch ?? globalThis.fetch) as never,
      ...(context.endpoint ? { baseUrl: context.endpoint } : {}),
    });
    if (result.status === "accepted") return { status: "accepted", pollState: result.pollState };
    return { status: "completed", outputs: valueOutput({ url: result.media.url, taskId: result.taskId }) };
  },
};
