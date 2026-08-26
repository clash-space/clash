import type {
  Executor,
  ExecutorContext,
  ExecutorStep,
} from "@clash/action-sdk";
import {
  ProviderExecutionError,
  providerHttpError,
} from "@clash/action-sdk";

export const MEDIAKIT_DEFAULT_BASE_URL = "https://mediakit.cn-beijing.volces.com";

const TOOL_VERSIONS = ["standard", "professional"] as const;
const SCENES = ["common", "ugc", "short_series", "aigc", "old_film"] as const;
const ENHANCE_STYLES = ["hd", "natural"] as const;
const RESOLUTIONS = [
  "240p",
  "360p",
  "480p",
  "540p",
  "720p",
  "1080p",
  "2k",
  "4k",
  "8k",
] as const;
const BITRATE_LEVELS = ["low", "medium", "high"] as const;
const BIT_DEPTHS = [8, 10, 12, 16] as const;

export interface MediaKitRequestValues extends Record<string, unknown> {
  toolVersion?: string;
  scene?: string;
  enhanceStyle?: string;
  resolution?: string;
  resolutionLimit?: number;
  bitrateLevel?: string;
  bitrate?: number;
  fps?: number;
  bitDepth?: number;
  mediaOutputDestination?: string;
  clientToken?: string;
}

function rejectedInvalidRequest(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_request",
    message,
    retryable: false,
    requestState: "rejected",
  });
}

/** Translate the provider-neutral invocation into MediaKit's published `enhance-video` request. */
export function buildMediaKitRequest(
  values: MediaKitRequestValues,
  videoUrl: string,
): Record<string, unknown> {
  if (!videoUrl) {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit enhance-video requires a video_url.",
    );
  }
  const toolVersion = values.toolVersion;
  if (
    typeof toolVersion !== "string" ||
    !TOOL_VERSIONS.includes(toolVersion as (typeof TOOL_VERSIONS)[number])
  ) {
    throw rejectedInvalidRequest(
      `Volcengine MediaKit tool_version must be one of ${TOOL_VERSIONS.join(", ")}.`,
    );
  }

  if (values.scene !== undefined) {
    if (toolVersion !== "standard") {
      throw rejectedInvalidRequest(
        "Volcengine MediaKit scene is only valid for the standard tool_version.",
      );
    }
    if (!SCENES.includes(values.scene as (typeof SCENES)[number])) {
      throw rejectedInvalidRequest(
        `Volcengine MediaKit scene must be one of ${SCENES.join(", ")}.`,
      );
    }
  }

  if (values.bitDepth !== undefined) {
    if (toolVersion !== "professional") {
      throw rejectedInvalidRequest(
        "Volcengine MediaKit bit_depth is only valid for the professional tool_version.",
      );
    }
    if (!BIT_DEPTHS.includes(values.bitDepth as (typeof BIT_DEPTHS)[number])) {
      throw rejectedInvalidRequest(
        `Volcengine MediaKit bit_depth must be one of ${BIT_DEPTHS.join(", ")}.`,
      );
    }
  }

  if (values.enhanceStyle !== undefined) {
    if (
      !ENHANCE_STYLES.includes(
        values.enhanceStyle as (typeof ENHANCE_STYLES)[number],
      )
    ) {
      throw rejectedInvalidRequest(
        `Volcengine MediaKit enhance_style must be one of ${ENHANCE_STYLES.join(", ")}.`,
      );
    }
  }

  if (values.resolution !== undefined && values.resolutionLimit !== undefined) {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit accepts either resolution or resolution_limit, not both.",
    );
  }
  if (
    values.resolution !== undefined &&
    !RESOLUTIONS.includes(values.resolution as (typeof RESOLUTIONS)[number])
  ) {
    throw rejectedInvalidRequest(
      `Volcengine MediaKit resolution must be one of ${RESOLUTIONS.join(", ")}.`,
    );
  }
  if (
    values.resolutionLimit !== undefined &&
    (!Number.isFinite(values.resolutionLimit) ||
      values.resolutionLimit < 128 ||
      values.resolutionLimit > 4320)
  ) {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit resolution_limit must be between 128 and 4320.",
    );
  }

  if (values.bitrateLevel !== undefined && values.bitrate !== undefined) {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit accepts either bitrate_level or bitrate, not both.",
    );
  }
  if (
    values.bitrateLevel !== undefined &&
    !BITRATE_LEVELS.includes(
      values.bitrateLevel as (typeof BITRATE_LEVELS)[number],
    )
  ) {
    throw rejectedInvalidRequest(
      `Volcengine MediaKit bitrate_level must be one of ${BITRATE_LEVELS.join(", ")}.`,
    );
  }
  if (
    values.bitrate !== undefined &&
    (!Number.isFinite(values.bitrate) ||
      values.bitrate < 10 ||
      values.bitrate > 150_000)
  ) {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit bitrate must be between 10 and 150000.",
    );
  }

  if (
    values.fps !== undefined &&
    (!Number.isFinite(values.fps) || values.fps < 15 || values.fps > 120)
  ) {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit fps must be between 15 and 120.",
    );
  }

  if (values.clientToken !== undefined) {
    if (values.clientToken.length > 64 || !/^[\x20-\x7e]*$/.test(values.clientToken)) {
      throw rejectedInvalidRequest(
        "Volcengine MediaKit client_token must be at most 64 printable ASCII characters.",
      );
    }
  }

  if (values.mediaOutputDestination !== undefined) {
    const destination = values.mediaOutputDestination;
    const vodMatch = /^vod:\/\/(.+)$/.exec(destination);
    const tosMatch = /^tos:\/\/(.+)$/.exec(destination);
    if (
      (!vodMatch || !vodMatch[1].trim()) &&
      (!tosMatch || !tosMatch[1].trim())
    ) {
      throw rejectedInvalidRequest(
        "Volcengine MediaKit media_output_destination must be a non-empty vod:// or tos:// URI.",
      );
    }
  }

  const body: Record<string, unknown> = {
    video_url: videoUrl,
    tool_version: toolVersion,
  };
  if (values.scene !== undefined) body.scene = values.scene;
  if (values.enhanceStyle !== undefined) body.enhance_style = values.enhanceStyle;
  if (values.resolution !== undefined) body.resolution = values.resolution;
  if (values.resolutionLimit !== undefined)
    body.resolution_limit = values.resolutionLimit;
  if (values.bitrateLevel !== undefined) body.bitrate_level = values.bitrateLevel;
  if (values.bitrate !== undefined) body.bitrate = values.bitrate;
  if (values.fps !== undefined) body.fps = values.fps;
  if (values.bitDepth !== undefined) body.bit_depth = values.bitDepth;
  if (values.mediaOutputDestination !== undefined)
    body.media_output_destination = values.mediaOutputDestination;
  if (values.clientToken !== undefined) body.client_token = values.clientToken;
  return body;
}

function baseUrl(value: string | undefined): string {
  return (value?.trim() || MEDIAKIT_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function responseBody(
  response: Response,
): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    return record(JSON.parse(raw));
  } catch {
    return { error: { message: raw } };
  }
}

function messageFrom(body: Record<string, unknown>, fallback: string): string {
  const error = record(body.error);
  if (typeof error.message === "string" && error.message) return error.message;
  if (typeof body.message === "string" && body.message) return body.message;
  return fallback;
}

function readPollState(value: unknown): { taskId: string } {
  const state = record(value);
  const taskId =
    typeof state.taskId === "string" && state.taskId.trim()
      ? state.taskId.trim()
      : undefined;
  if (!taskId) {
    throw new ProviderExecutionError({
      code: "contract_violation",
      message: "Volcengine MediaKit poll state is missing its taskId.",
      retryable: false,
      requestState: "accepted",
    });
  }
  return { taskId };
}

export async function mediaKitSubmit(options: {
  apiKey: string;
  baseUrl?: string;
  body: Record<string, unknown>;
  fetch: typeof globalThis.fetch;
}): Promise<ExecutorStep> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Volcengine MediaKit account has no apiKey stored.",
      retryable: false,
      requestState: "rejected",
    });
  }
  const response = await options.fetch(
    `${baseUrl(options.baseUrl)}/api/v1/tools/enhance-video`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(options.body),
    },
  );
  const body = await responseBody(response);
  if (!response.ok) {
    throw providerHttpError({
      status: response.status,
      message: `Volcengine MediaKit enhance-video submission failed: ${messageFrom(body, response.statusText)}`,
      operation: "submit",
    });
  }
  const taskId = typeof body.task_id === "string" ? body.task_id.trim() : "";
  if (!taskId) {
    throw new ProviderExecutionError({
      code: "invalid_response",
      message: "Volcengine MediaKit enhance-video submission returned no task_id.",
      retryable: false,
      requestState: "unknown",
    });
  }
  return { status: "accepted", pollState: { taskId } };
}

export async function mediaKitPoll(options: {
  apiKey: string;
  baseUrl?: string;
  state: unknown;
  fetch: typeof globalThis.fetch;
}): Promise<ExecutorStep> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Volcengine MediaKit account has no apiKey stored.",
      retryable: false,
      requestState: "accepted",
    });
  }
  const state = readPollState(options.state);
  const response = await options.fetch(
    `${baseUrl(options.baseUrl)}/api/v1/tasks/${encodeURIComponent(state.taskId)}`,
    { headers: { authorization: `Bearer ${apiKey}` } },
  );
  const body = await responseBody(response);
  if (!response.ok) {
    throw providerHttpError({
      status: response.status,
      message: `Volcengine MediaKit task status failed: ${messageFrom(body, response.statusText)}`,
      operation: "poll",
    });
  }
  const status = typeof body.status === "string" ? body.status.toLowerCase() : "";
  if (status === "running") {
    return { status: "accepted", pollState: state, retryAfterMs: 5_000 };
  }
  if (status === "completed") {
    const result = record(body.result);
    const videoUrl = result.video_url;
    if (typeof videoUrl !== "string" || !videoUrl) {
      throw new ProviderExecutionError({
        code: "invalid_response",
        message: "Volcengine MediaKit completed task returned no result.video_url.",
        retryable: false,
        requestState: "accepted",
      });
    }
    return {
      status: "completed",
      media: { media: { url: videoUrl, mediaType: "video/mp4" } },
    };
  }
  if (status === "failed") {
    const error = record(body.error);
    const providerCode =
      typeof error.code === "string" && error.code ? error.code : undefined;
    return Promise.reject(
      new ProviderExecutionError({
        code: "provider_failed",
        message: `Volcengine MediaKit enhance-video failed: ${messageFrom(body, "failed")}`,
        retryable: false,
        requestState: "accepted",
        ...(providerCode ? { providerCode } : {}),
      }),
    );
  }
  throw new ProviderExecutionError({
    code: "invalid_response",
    message: `Volcengine MediaKit task returned unrecognised status ${JSON.stringify(body.status)}.`,
    retryable: false,
    requestState: "accepted",
    ...(status ? { providerCode: status } : {}),
  });
}

async function accountState(
  context: ExecutorContext,
  requestState: "rejected" | "accepted",
): Promise<{ apiKey: string; baseUrl?: string }> {
  const [apiKey, customBaseUrl] = await Promise.all([
    context.store.get("apiKey"),
    context.store.get("baseUrl"),
  ]);
  if (!apiKey?.trim()) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Volcengine MediaKit account has no apiKey stored.",
      retryable: false,
      requestState,
    });
  }
  return {
    apiKey: apiKey.trim(),
    ...(customBaseUrl?.trim() ? { baseUrl: customBaseUrl.trim() } : {}),
  };
}

async function resolveVideoUrl(
  invocation: Parameters<Executor["submit"]>[0],
  context: ExecutorContext,
): Promise<string> {
  const references = invocation.input.references;
  const videoReference = references.find(
    (reference) => reference.slot === "video" || reference.slot === "source",
  );
  if (!videoReference) {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit enhance-video requires exactly one video reference.",
    );
  }
  const resolved = await context.reference(videoReference);
  if (resolved.form !== "provider-url") {
    throw rejectedInvalidRequest(
      "Volcengine MediaKit video reference must resolve to a Host-issued provider-url.",
    );
  }
  if (resolved.kind && resolved.kind !== "video") {
    throw rejectedInvalidRequest(
      `Volcengine MediaKit video slot resolved to ${resolved.kind} media.`,
    );
  }
  return resolved.providerUrl;
}

function requestValues(
  invocation: Parameters<Executor["submit"]>[0],
): MediaKitRequestValues {
  return invocation.input.values as MediaKitRequestValues;
}

export const volcengineMediaKitAdapter: Executor = {
  async submit(invocation, context): Promise<ExecutorStep> {
    const videoUrl = await resolveVideoUrl(invocation, context);
    const account = await accountState(context, "rejected");
    return mediaKitSubmit({
      ...account,
      body: buildMediaKitRequest(requestValues(invocation), videoUrl),
      fetch: globalThis.fetch,
    });
  },
  async poll(invocation, context): Promise<ExecutorStep> {
    const state = readPollState(invocation.pollState);
    const account = await accountState(context, "accepted");
    return mediaKitPoll({
      ...account,
      state,
      fetch: globalThis.fetch,
    });
  },
};
