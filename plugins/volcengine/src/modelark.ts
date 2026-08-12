import type {
  Executor,
  ExecutorContext,
  ExecutorStep,
} from "@clash/action-sdk";

export const VOLCENGINE_DEFAULT_BASE_URL =
  "https://ark.cn-beijing.volces.com/api/v3";

export interface ModelArkRequestValues extends Record<string, unknown> {
  modelId?: string;
  upstreamModel?: string;
  prompt?: string;
  aspectRatio?: string;
  duration?: number | string;
  modelParams?: Record<string, unknown>;
  startFrameUrl?: string;
  endFrameUrl?: string;
  referenceImageUrls?: string[];
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is string =>
          typeof entry === "string" && entry.trim().length > 0,
      )
    : [];
}

function durationValue(value: unknown): number | undefined {
  if (value === "auto") return -1;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function mediaParts(
  type: "image_url" | "video_url" | "audio_url",
  role:
    | "reference_image"
    | "reference_video"
    | "reference_audio"
    | "first_frame"
    | "last_frame",
  urls: string[],
): Array<Record<string, unknown>> {
  return urls.map((url) => ({ type, [type]: { url }, role }));
}

function parameter(
  values: ModelArkRequestValues,
  params: Record<string, unknown>,
  key: string,
): unknown {
  return params[key] ?? values[key];
}

/**
 * Translate the provider-neutral invocation into ModelArk's published request.
 *
 * Seedance 2.5 is the only family with explicit all-purpose sub-task routing. Its edit task also
 * owns two non-negotiable constraints (`ratio=adaptive`, `duration=-1`); applying either rule to
 * Seedance 2.0 changes a valid user request, so the family check is intentionally visible here.
 */
export function buildModelArkRequest(
  values: ModelArkRequestValues,
): Record<string, unknown> {
  const modelId = typeof values.modelId === "string" ? values.modelId : "";
  const model =
    typeof values.upstreamModel === "string" ? values.upstreamModel : "";
  if (!model) throw new Error("Volcengine executor needs an upstreamModel.");

  const params = record(values.modelParams);
  const prompt = typeof values.prompt === "string" ? values.prompt.trim() : "";
  const images = strings(values.referenceImageUrls);
  const videos = strings(values.referenceVideoUrls);
  const audios = strings(values.referenceAudioUrls);
  const startFrame =
    typeof values.startFrameUrl === "string" && values.startFrameUrl.trim()
      ? values.startFrameUrl.trim()
      : undefined;
  const endFrame =
    typeof values.endFrameUrl === "string" && values.endFrameUrl.trim()
      ? values.endFrameUrl.trim()
      : undefined;
  const seedance25 =
    modelId.startsWith("seedance-2.5") || model.includes("seedance-2-5");
  const startEnd = modelId.endsWith("-startend") || !!startFrame || !!endFrame;
  const extension = modelId.endsWith("-extend");
  const edit = params.edit_mode === true;

  if (edit && videos.length === 0) {
    throw new Error("Volcengine Seedance edit requires a reference video.");
  }
  if (extension && videos.length === 0) {
    throw new Error(
      "Volcengine Seedance extension requires a reference video.",
    );
  }
  if (extension && (images.length > 0 || audios.length > 0)) {
    throw new Error(
      "Volcengine Seedance extension accepts only reference video input.",
    );
  }
  if (startEnd && !startFrame) {
    throw new Error(
      "Volcengine Seedance first/last-frame generation requires a first frame.",
    );
  }
  if (
    !seedance25 &&
    audios.length > 0 &&
    images.length === 0 &&
    videos.length === 0
  ) {
    throw new Error(
      "Volcengine Seedance 2.0 audio input requires an image or video reference.",
    );
  }

  const content: Array<Record<string, unknown>> = [];
  if (prompt) content.push({ type: "text", text: prompt });
  if (startFrame)
    content.push(...mediaParts("image_url", "first_frame", [startFrame]));
  if (endFrame)
    content.push(...mediaParts("image_url", "last_frame", [endFrame]));
  content.push(...mediaParts("image_url", "reference_image", images));
  content.push(...mediaParts("video_url", "reference_video", videos));
  content.push(...mediaParts("audio_url", "reference_audio", audios));
  if (content.length === 0) {
    throw new Error(
      "Volcengine Seedance requires a prompt or reference media.",
    );
  }

  const body: Record<string, unknown> = { model, content };
  const requestedDuration = durationValue(
    parameter(values, params, "duration"),
  );
  if (seedance25 && edit) body.duration = -1;
  else if (requestedDuration !== undefined) body.duration = requestedDuration;

  const requestedRatio = values.aspectRatio ?? params.aspect_ratio;
  if (seedance25 && (edit || extension || startEnd)) {
    body.ratio = "adaptive";
  } else if (typeof requestedRatio === "string" && requestedRatio) {
    body.ratio = requestedRatio === "auto" ? "adaptive" : requestedRatio;
  }

  if (seedance25 && !startEnd) {
    if (extension) body.omni_reference_task_type = "extend";
    else if (edit) body.omni_reference_task_type = "edit";
    else if (images.length + videos.length + audios.length > 0) {
      body.omni_reference_task_type = "reference";
    }
  }

  const resolution = params.resolution;
  if (typeof resolution === "string" && resolution)
    body.resolution = resolution;
  if (typeof params.generate_audio === "boolean")
    body.generate_audio = params.generate_audio;
  // Product output is deliberately one portable format. A stale node asking for MOV cannot reopen
  // the control after it has been removed from the model card.
  if (seedance25) body.output_format = "mp4";
  return body;
}

function baseUrl(value: string | undefined): string {
  return (value?.trim() || VOLCENGINE_DEFAULT_BASE_URL).replace(/\/+$/, "");
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

function taskIdFrom(body: Record<string, unknown>): string | undefined {
  const raw = body.id ?? body.task_id;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number" && Number.isSafeInteger(raw) && raw >= 0)
    return String(raw);
  return undefined;
}

function readPollState(value: unknown): { taskId: string } {
  const state = record(value);
  const taskId =
    typeof state.taskId === "string" && state.taskId.trim()
      ? state.taskId.trim()
      : taskIdFrom(state);
  if (!taskId) throw new Error("Volcengine poll state is missing its taskId.");
  return { taskId };
}

export async function modelArkSubmit(options: {
  apiKey: string;
  baseUrl?: string;
  body: Record<string, unknown>;
  fetch: typeof globalThis.fetch;
}): Promise<ExecutorStep> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("This Volcengine account has no apiKey stored.");
  const response = await options.fetch(
    `${baseUrl(options.baseUrl)}/contents/generations/tasks`,
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
    throw new Error(
      `Volcengine video submission failed: ${messageFrom(body, response.statusText)}`,
    );
  }
  const taskId = taskIdFrom(body);
  if (!taskId)
    throw new Error("Volcengine video submission returned no task id.");
  return { status: "accepted", pollState: { taskId } };
}

export async function modelArkPoll(options: {
  apiKey: string;
  baseUrl?: string;
  state: unknown;
  fetch: typeof globalThis.fetch;
}): Promise<ExecutorStep> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) throw new Error("This Volcengine account has no apiKey stored.");
  const state = readPollState(options.state);
  const response = await options.fetch(
    `${baseUrl(options.baseUrl)}/contents/generations/tasks/${encodeURIComponent(state.taskId)}`,
    { headers: { authorization: `Bearer ${apiKey}` } },
  );
  const body = await responseBody(response);
  if (!response.ok) {
    throw new Error(
      `Volcengine video status failed: ${messageFrom(body, response.statusText)}`,
    );
  }
  const status =
    typeof body.status === "string"
      ? body.status.toLowerCase()
      : typeof body.task_status === "string"
        ? body.task_status.toLowerCase()
        : "";
  if (status === "queued" || status === "running" || status === "processing") {
    return { status: "accepted", pollState: state, retryAfterMs: 5_000 };
  }
  if (status === "succeeded" || status === "success") {
    const content = record(body.content);
    const output = record(body.output);
    const videoUrl = content.video_url ?? output.video_url ?? output.url;
    if (typeof videoUrl !== "string" || !videoUrl) {
      throw new Error(
        "Volcengine succeeded task returned no content.video_url.",
      );
    }
    return {
      status: "completed",
      media: { media: { url: videoUrl, mediaType: "video/mp4" } },
    };
  }
  if (["failed", "expired", "cancelled", "canceled"].includes(status)) {
    throw new Error(
      `Volcengine video generation ${status}: ${messageFrom(body, status)}`,
    );
  }
  throw new Error(
    `Volcengine video task returned unrecognised status ${JSON.stringify(body.status)}.`,
  );
}

async function accountState(
  context: ExecutorContext,
): Promise<{ apiKey: string; baseUrl?: string }> {
  const [apiKey, customBaseUrl] = await Promise.all([
    context.store.get("apiKey"),
    context.store.get("baseUrl"),
  ]);
  if (!apiKey?.trim())
    throw new Error("This Volcengine account has no apiKey stored.");
  return {
    apiKey: apiKey.trim(),
    ...(customBaseUrl?.trim() ? { baseUrl: customBaseUrl.trim() } : {}),
  };
}

const RETRYABLE_TRANSPORT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "EPIPE",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function retryablePollFailure(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (typeof current !== "object") break;
    const candidate = current as {
      code?: unknown;
      name?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    const code =
      typeof candidate.code === "string" ? candidate.code.toUpperCase() : "";
    if (RETRYABLE_TRANSPORT_CODES.has(code)) return true;
    if (candidate.name === "AbortError" || candidate.name === "TimeoutError")
      return true;
    if (
      typeof candidate.message === "string" &&
      /fetch failed|socket hang up/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export const volcengineAdapter: Executor = {
  async submit(invocation, context): Promise<ExecutorStep> {
    const values = invocation.input.values as ModelArkRequestValues;
    const account = await accountState(context);
    return modelArkSubmit({
      ...account,
      body: buildModelArkRequest(values),
      fetch: globalThis.fetch,
    });
  },
  async poll(invocation, context): Promise<ExecutorStep> {
    const state = readPollState(invocation.pollState);
    const account = await accountState(context);
    try {
      return await modelArkPoll({
        ...account,
        state,
        fetch: globalThis.fetch,
      });
    } catch (error) {
      if (!retryablePollFailure(error)) throw error;
      return { status: "accepted", pollState: state, retryAfterMs: 5_000 };
    }
  },
};
