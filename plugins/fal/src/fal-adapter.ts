import {
  ProviderExecutionError,
  type ExecutorContext,
  type ExecutorStep,
  type Executor as ProviderExecutor,
} from "@clash/action-sdk";

import {
  HUNYUAN3D_TEXT_TO_3D_ENDPOINT,
  falPoll,
  falSubmit,
  type FalDirectorModelInput,
  type FalDirectorModelQuality,
  type FalPollState,
} from "./fal-executor.js";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function endpoint(values: Record<string, unknown>): string {
  const value = values.upstreamModel ?? values.modelEndpoint;
  return typeof value === "string" && value
    ? value
    : HUNYUAN3D_TEXT_TO_3D_ENDPOINT;
}

function directorInput(values: Record<string, unknown>): FalDirectorModelInput {
  const params = record(values.modelParams);
  const prompt = values.prompt;
  const quality = params.quality ?? values.quality;
  return {
    prompt: typeof prompt === "string" ? prompt : "",
    quality:
      quality === "low-poly" || quality === "geometry"
        ? (quality as FalDirectorModelQuality)
        : "normal",
    pbr: (params.pbr ?? values.pbr) !== false,
    ...(typeof (params.faceCount ?? values.faceCount) === "number"
      ? { faceCount: Number(params.faceCount ?? values.faceCount) }
      : {}),
  };
}

function pollState(value: unknown): FalPollState {
  const state = record(value);
  if (typeof state.requestId !== "string" || !state.requestId) {
    throw new ProviderExecutionError({
      code: "contract_violation",
      message: "fal poll state is missing its requestId.",
      retryable: false,
      requestState: "accepted",
    });
  }
  if (
    state.phase !== undefined &&
    state.phase !== "status" &&
    state.phase !== "result"
  ) {
    throw new ProviderExecutionError({
      code: "contract_violation",
      message: `fal poll state has an unsupported phase: ${String(state.phase)}.`,
      retryable: false,
      requestState: "accepted",
    });
  }
  return {
    requestId: state.requestId,
    ...(state.phase === undefined ? {} : { phase: state.phase }),
  };
}

async function accountState(context: ExecutorContext): Promise<{
  apiKey: string;
  queueBaseUrl?: string;
}> {
  const apiKey = (await context.store.get("apiKey")) ?? "";
  const storedBaseUrl = await context.store.get("queueBaseUrl");
  const queueBaseUrl =
    storedBaseUrl?.trim() || process.env.CLASH_FAL_QUEUE_URL?.trim();
  return {
    apiKey,
    ...(queueBaseUrl ? { queueBaseUrl } : {}),
  };
}

export const falAdapter: ProviderExecutor = {
  async submit(invocation, context): Promise<ExecutorStep> {
    const credentials = await accountState(context);
    return falSubmit({
      ...credentials,
      endpoint: endpoint(invocation.input.values),
      input: directorInput(invocation.input.values),
      fetch: globalThis.fetch,
    });
  },

  async poll(invocation, context): Promise<ExecutorStep> {
    // Validate durable state before asking the Host for account secrets. A corrupt journal entry is
    // a contract failure independent of which account owns it, and a contract test can therefore
    // exercise this boundary without declaring irrelevant credential fixtures.
    const state = pollState(invocation.pollState);
    const credentials = await accountState(context);
    const result = await falPoll({
      ...credentials,
      endpoint: endpoint(invocation.input.values),
      state,
      fetch: globalThis.fetch,
    });
    if (result.status === "accepted") return result;
    return {
      status: "completed",
      media: {
        media: {
          url: result.media.url,
          mediaType: result.media.contentType,
          kind: "model",
        },
      },
    };
  },
};
