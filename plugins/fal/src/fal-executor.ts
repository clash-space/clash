import {
  ProviderExecutionError,
  providerHttpError,
} from "@clash/action-sdk";

export const HUNYUAN3D_TEXT_TO_3D_ENDPOINT =
  "fal-ai/hunyuan3d-v3/text-to-3d";

export type FalDirectorModelQuality = "normal" | "low-poly" | "geometry";

export interface FalDirectorModelInput {
  prompt: string;
  quality: FalDirectorModelQuality;
  pbr: boolean;
  faceCount?: number;
}

export type FalPollState =
  | { requestId: string; phase?: "status" }
  | { requestId: string; phase: "result" };

type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

function normalizedFaceCount(value: number | undefined): number {
  if (value === undefined) return 500_000;
  if (!Number.isFinite(value)) {
    throw invalidRequest("3D model face count must be finite");
  }
  return Math.max(40_000, Math.min(1_500_000, Math.round(value)));
}

function invalidRequest(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_request",
    message,
    retryable: false,
    requestState: "rejected",
  });
}

function invalidResponse(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_response",
    message,
    retryable: false,
    requestState: "accepted",
  });
}

export function buildFalDirectorModelInput(
  input: FalDirectorModelInput,
): Record<string, unknown> {
  const prompt = input.prompt.trim();
  if (!prompt) throw invalidRequest("3D model prompt is required");
  if (new TextEncoder().encode(prompt).byteLength > 1024) {
    throw invalidRequest("3D model prompt must be at most 1024 UTF-8 bytes");
  }
  const generateType =
    input.quality === "low-poly"
      ? "LowPoly"
      : input.quality === "geometry"
        ? "Geometry"
        : "Normal";
  return {
    prompt,
    enable_pbr: input.quality === "geometry" ? false : input.pbr,
    face_count: normalizedFaceCount(input.faceCount),
    generate_type: generateType,
    polygon_type: input.quality === "low-poly" ? "quadrilateral" : "triangle",
  };
}

async function readJson(response: {
  text(): Promise<string>;
}): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return { detail: raw };
  }
}

function nested(
  value: unknown,
): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function messageFrom(
  body: Record<string, unknown>,
  fallback: string,
): string {
  const error = nested(body.error);
  if (typeof error?.message === "string" && error.message) {
    return error.message;
  }
  if (typeof body.detail === "string" && body.detail) return body.detail;
  if (typeof body.error === "string" && body.error) return body.error;
  return fallback;
}

function queueUrl(baseUrl: string, endpoint: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint}`;
}

export async function falSubmit(options: {
  apiKey: string;
  endpoint: string;
  input: FalDirectorModelInput;
  fetch: FetchLike;
  queueBaseUrl?: string;
}): Promise<{ status: "accepted"; pollState: FalPollState }> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This fal.ai account has no apiKey stored.",
      retryable: false,
      requestState: "rejected",
    });
  }
  if (options.endpoint !== HUNYUAN3D_TEXT_TO_3D_ENDPOINT) {
    throw invalidRequest(`Unsupported fal model endpoint: ${options.endpoint}`);
  }
  const response = await options.fetch(
    queueUrl(options.queueBaseUrl ?? "https://queue.fal.run", options.endpoint),
    {
      method: "POST",
      headers: {
        authorization: `Key ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildFalDirectorModelInput(options.input)),
    },
  );
  const body = await readJson(response);
  if (!response.ok) {
    throw providerHttpError({
      status: response.status,
      message: `fal 3D model request failed: ${messageFrom(body, response.statusText)}`,
      operation: "submit",
    });
  }
  const requestId = body.request_id ?? body.requestId;
  if (typeof requestId !== "string" || !requestId) {
    throw new ProviderExecutionError({
      code: "invalid_response",
      message: "fal 3D model response returned no request_id",
      retryable: false,
      requestState: "unknown",
    });
  }
  return { status: "accepted", pollState: { requestId } };
}

export async function falPoll(options: {
  apiKey: string;
  endpoint: string;
  state: FalPollState;
  fetch: FetchLike;
  queueBaseUrl?: string;
}): Promise<
  | { status: "accepted"; pollState: FalPollState; retryAfterMs?: number }
  | {
      status: "completed";
      media: { url: string; contentType: string };
      thumbnailUrl?: string;
    }
> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This fal.ai account has no apiKey stored.",
      retryable: false,
      requestState: "accepted",
    });
  }
  const requestUrl = `${queueUrl(options.queueBaseUrl ?? "https://queue.fal.run", options.endpoint)}/requests/${encodeURIComponent(options.state.requestId)}`;
  const headers = { authorization: `Key ${apiKey}` };
  if (options.state.phase === "result") {
    const resultResponse = await options.fetch(requestUrl, { headers });
    const resultBody = await readJson(resultResponse);
    if (!resultResponse.ok) {
      throw providerHttpError({
        status: resultResponse.status,
        message: `fal 3D model result failed: ${messageFrom(resultBody, resultResponse.statusText)}`,
        operation: "poll",
      });
    }
    const result = nested(resultBody.data) ?? resultBody;
    const modelFile = nested(result.model_glb) ?? nested(nested(result.model_urls)?.glb);
    if (typeof modelFile?.url !== "string" || !modelFile.url) {
      throw invalidResponse("fal 3D model result returned no GLB URL");
    }
    const thumbnail = nested(result.thumbnail);
    return {
      status: "completed",
      media: {
        url: modelFile.url,
        contentType:
          typeof modelFile.content_type === "string" && modelFile.content_type
            ? modelFile.content_type
            : "model/gltf-binary",
      },
      ...(typeof thumbnail?.url === "string" && thumbnail.url
        ? { thumbnailUrl: thumbnail.url }
        : {}),
    };
  }

  const statusResponse = await options.fetch(`${requestUrl}/status`, {
    headers,
  });
  const statusBody = await readJson(statusResponse);
  if (!statusResponse.ok) {
    throw providerHttpError({
      status: statusResponse.status,
      message: `fal 3D model status failed: ${messageFrom(statusBody, statusResponse.statusText)}`,
      operation: "poll",
    });
  }
  const status = statusBody.status;
  if (status === "IN_QUEUE" || status === "IN_PROGRESS") {
    return {
      status: "accepted",
      pollState: options.state,
      retryAfterMs: 1_000,
    };
  }
  if (status === "FAILED" || status === "ERROR" || status === "CANCELLED") {
    throw new ProviderExecutionError({
      code: "provider_failed",
      message: `fal 3D model request failed: ${messageFrom(statusBody, String(status))}`,
      retryable: false,
      requestState: "accepted",
      providerCode: String(status),
    });
  }
  if (status !== "COMPLETED") {
    throw invalidResponse(
      `fal returned an unrecognized task status: ${JSON.stringify(status)}`,
    );
  }
  // The completed status consumed this Provider step. Persist the result phase before making the
  // second request so a crash cannot erase which upstream boundary comes next.
  return {
    status: "accepted",
    pollState: { requestId: options.state.requestId, phase: "result" },
    retryAfterMs: 0,
  };
}
