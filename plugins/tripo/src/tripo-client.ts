/**
 * Tripo v3 HTTP layer.
 *
 * Pure translation between this plugin's request/response shapes and the exact contract
 * documented at developers.tripo3d.ai: a unified `{ code, data }` / `{ code, message,
 * suggestion, request_id }` envelope wrapping an async task pattern (submit -> task_id,
 * poll GET /tasks/{task_id}). No fetch call happens anywhere outside this file; the adapter
 * only ever calls the functions below.
 */

import { ProviderExecutionError, providerHttpError } from "@clash/action-sdk";

import { TRIPO_REGION_ENDPOINTS } from "./tripo-region.js";

/**
 * Documented base URL: https://developers.tripo3d.ai/en/docs/introduction
 *
 * This is the international host, and the default a caller gets when it does not resolve and
 * pass its own region-selected base URL. The adapter, which owns the account, always resolves
 * one explicitly through `tripoBaseUrl` from `./tripo-region.js` and passes it down instead of
 * relying on this default.
 */
export const TRIPO_API_BASE_URL = TRIPO_REGION_ENDPOINTS.international;

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | FormData;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
}>;

export type TripoPollState = {
  taskId: string;
};

export type TripoTextureQuality = "standard" | "detailed" | "extreme";
export type TripoGeometryQuality = "standard" | "detailed";

/**
 * The five v1 quality parameters this plugin forwards to Tripo, and only these five.
 *
 * Typed `unknown` on purpose: the adapter reads them straight out of a card's untyped
 * `modelParams`, and it is this module's job to reject a wrong type with a named error rather
 * than let a caller coerce it away before validation runs.
 */
export interface TripoQualityInput {
  pbr?: unknown;
  textureQuality?: unknown;
  geometryQuality?: unknown;
  faceLimit?: unknown;
  autoSize?: unknown;
}

const TEXTURE_QUALITIES = new Set<TripoTextureQuality>([
  "standard",
  "detailed",
  "extreme",
]);
const GEOMETRY_QUALITIES = new Set<TripoGeometryQuality>([
  "standard",
  "detailed",
]);

/**
 * Standard-mode triangle ceiling for v3.1 (the model version this plugin pins). Ultra mode and
 * quad topology are not exposed by the v1 parameter surface, so this is the one ceiling that
 * applies: https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard
 */
const MAX_FACE_LIMIT = 1_500_000;

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

function authenticationFailed(
  requestState: "rejected" | "accepted",
): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "authentication_failed",
    message: "This Tripo account has no apiKey stored.",
    retryable: false,
    requestState,
  });
}

function requireApiKey(
  apiKey: string,
  requestState: "rejected" | "accepted",
): string {
  const value = apiKey.trim();
  if (!value) throw authenticationFailed(requestState);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function qualityFields(input: TripoQualityInput): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (input.pbr !== undefined) {
    if (typeof input.pbr !== "boolean") {
      throw invalidRequest("Tripo pbr must be a boolean.");
    }
    fields.pbr = input.pbr;
  }
  if (input.textureQuality !== undefined) {
    if (
      typeof input.textureQuality !== "string" ||
      !TEXTURE_QUALITIES.has(input.textureQuality as TripoTextureQuality)
    ) {
      throw invalidRequest(
        "Tripo textureQuality must be one of standard, detailed, extreme.",
      );
    }
    fields.texture_quality = input.textureQuality;
  }
  if (input.geometryQuality !== undefined) {
    if (
      typeof input.geometryQuality !== "string" ||
      !GEOMETRY_QUALITIES.has(input.geometryQuality as TripoGeometryQuality)
    ) {
      throw invalidRequest(
        "Tripo geometryQuality must be one of standard, detailed.",
      );
    }
    fields.geometry_quality = input.geometryQuality;
  }
  if (input.faceLimit !== undefined) {
    if (
      typeof input.faceLimit !== "number" ||
      !Number.isInteger(input.faceLimit) ||
      input.faceLimit < 1 ||
      input.faceLimit > MAX_FACE_LIMIT
    ) {
      throw invalidRequest(
        `Tripo faceLimit must be an integer between 1 and ${MAX_FACE_LIMIT}.`,
      );
    }
    fields.face_limit = input.faceLimit;
  }
  if (input.autoSize !== undefined) {
    if (typeof input.autoSize !== "boolean") {
      throw invalidRequest("Tripo autoSize must be a boolean.");
    }
    fields.auto_size = input.autoSize;
  }
  return fields;
}

/** `POST /generation/text-to-model` body. https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard */
export function buildTripoTextToModelBody(
  input: TripoQualityInput & { prompt: string; model: string },
): Record<string, unknown> {
  const prompt = input.prompt.trim();
  if (!prompt) throw invalidRequest("Tripo text-to-model requires a prompt.");
  if (new TextEncoder().encode(prompt).byteLength > 1024) {
    throw invalidRequest("Tripo prompt must be at most 1024 UTF-8 bytes.");
  }
  return { prompt, model: input.model, ...qualityFields(input) };
}

/** `POST /generation/image-to-model` body. https://developers.tripo3d.ai/en/docs/generation-image-to-model/standard */
export function buildTripoImageToModelBody(
  input: TripoQualityInput & { inputImage: string; model: string },
): Record<string, unknown> {
  const inputImage = input.inputImage.trim();
  if (!inputImage) {
    throw invalidRequest(
      "Tripo image-to-model requires a resolved image input.",
    );
  }
  return { input: inputImage, model: input.model, ...qualityFields(input) };
}

/** `POST /animations/rig` body, always biped/mixamo/glb. https://developers.tripo3d.ai/en/docs/animations-rig */
export function buildTripoRigBody(input: {
  inputModel: string;
  model: string;
}): Record<string, unknown> {
  const inputModel = input.inputModel.trim();
  if (!inputModel) {
    throw invalidRequest(
      "Tripo auto-rig requires a resolved 3D model input.",
    );
  }
  return {
    input: inputModel,
    model: input.model,
    rig_type: "biped",
    spec: "mixamo",
    out_format: "glb",
  };
}

interface TripoEnvelope {
  code: number;
  data: Record<string, unknown>;
  message?: string;
}

async function readEnvelope(response: {
  text(): Promise<string>;
}): Promise<TripoEnvelope> {
  const raw = await response.text();
  if (!raw) return { code: -1, data: {} };
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const parsed = value as Record<string, unknown>;
      return {
        code: typeof parsed.code === "number" ? parsed.code : -1,
        data: record(parsed.data),
        ...(typeof parsed.message === "string"
          ? { message: parsed.message }
          : {}),
      };
    }
  } catch {
    // fall through to the raw-text envelope below
  }
  return { code: -1, data: {}, message: raw };
}

/**
 * https://developers.tripo3d.ai/en/docs/error-handling — only the codes this plugin's request
 * surface can realistically provoke are named; every other non-zero code falls back to
 * `invalid_request`, which is the least this plugin can claim about a business error it does not
 * recognise.
 */
const TRIPO_ENVELOPE_FAILURE_CODES: Record<
  number,
  { code: ProviderExecutionError["failure"]["code"]; retryable: boolean }
> = {
  1000: { code: "authentication_failed", retryable: false },
  1001: { code: "authentication_failed", retryable: false },
  2000: { code: "rate_limited", retryable: true },
  2002: { code: "invalid_request", retryable: false },
  2003: { code: "invalid_request", retryable: false },
  2004: { code: "invalid_request", retryable: false },
  2008: { code: "content_rejected", retryable: false },
  2010: { code: "quota_exhausted", retryable: false },
  2015: { code: "invalid_request", retryable: false },
  2018: { code: "invalid_request", retryable: false },
};

function envelopeFailure(
  envelope: TripoEnvelope,
  operation: "submit" | "poll",
): ProviderExecutionError {
  const mapping =
    TRIPO_ENVELOPE_FAILURE_CODES[envelope.code] ?? {
      code: "invalid_request" as const,
      retryable: false,
    };
  return new ProviderExecutionError({
    code: mapping.code,
    message: envelope.message ?? `Tripo request failed with code ${envelope.code}.`,
    retryable: mapping.retryable,
    requestState: operation === "submit" ? "rejected" : "accepted",
    providerCode: String(envelope.code),
  });
}

async function tripoRequest(options: {
  method: "GET" | "POST";
  baseUrl?: string;
  path: string;
  apiKey: string;
  body?: string | FormData;
  headers?: Record<string, string>;
  operation: "submit" | "poll";
  fetch: FetchLike;
}): Promise<TripoEnvelope> {
  const baseUrl = options.baseUrl ?? TRIPO_API_BASE_URL;
  const response = await options.fetch(`${baseUrl}${options.path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      ...(typeof options.body === "string"
        ? { "content-type": "application/json" }
        : {}),
      ...options.headers,
    },
    ...(options.body !== undefined ? { body: options.body } : {}),
  });
  const envelope = await readEnvelope(response);
  if (!response.ok) {
    throw providerHttpError({
      status: response.status,
      message: envelope.message ?? `Tripo request failed: ${response.statusText}`,
      operation: options.operation,
      providerCode: String(envelope.code),
    });
  }
  if (envelope.code !== 0) throw envelopeFailure(envelope, options.operation);
  return envelope;
}

/** Submits one task and returns the durable poll state the Host will hand back unread. */
export async function tripoSubmitTask(options: {
  apiKey: string;
  baseUrl?: string;
  path: string;
  body: Record<string, unknown>;
  fetch: FetchLike;
}): Promise<{ status: "accepted"; pollState: TripoPollState }> {
  const apiKey = requireApiKey(options.apiKey, "rejected");
  const envelope = await tripoRequest({
    method: "POST",
    baseUrl: options.baseUrl,
    path: options.path,
    apiKey,
    body: JSON.stringify(options.body),
    operation: "submit",
    fetch: options.fetch,
  });
  const taskId = envelope.data.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw invalidResponse("Tripo response returned no task_id.");
  }
  return { status: "accepted", pollState: { taskId } };
}

export type TripoTaskOutcome =
  | { status: "accepted"; pollState: TripoPollState; retryAfterMs: number }
  | { status: "completed"; media: { url: string; mediaType: string } };

/**
 * `GET /tasks/{task_id}` is the one poll endpoint shared by every route this plugin submits to.
 * https://developers.tripo3d.ai/en/docs/task-query
 */
export async function tripoPollTask(options: {
  apiKey: string;
  baseUrl?: string;
  state: TripoPollState;
  fetch: FetchLike;
}): Promise<TripoTaskOutcome> {
  const apiKey = requireApiKey(options.apiKey, "accepted");
  const envelope = await tripoRequest({
    method: "GET",
    baseUrl: options.baseUrl,
    path: `/tasks/${encodeURIComponent(options.state.taskId)}`,
    apiKey,
    operation: "poll",
    fetch: options.fetch,
  });
  const status = envelope.data.status;
  if (status === "queued" || status === "running") {
    return { status: "accepted", pollState: options.state, retryAfterMs: 1_500 };
  }
  if (status === "success") {
    const output = record(envelope.data.output);
    const modelUrl = output.model_url;
    if (typeof modelUrl !== "string" || !modelUrl) {
      throw invalidResponse("Tripo task succeeded without a model_url.");
    }
    return {
      status: "completed",
      media: { url: modelUrl, mediaType: "model/gltf-binary" },
    };
  }
  if (status === "failed") {
    const errorCode = envelope.data.error_code;
    const errorMessage = envelope.data.error_message;
    throw new ProviderExecutionError({
      code: "provider_failed",
      message:
        typeof errorMessage === "string" && errorMessage
          ? errorMessage
          : "Tripo task failed.",
      retryable: false,
      requestState: "accepted",
      ...(errorCode !== undefined ? { providerCode: String(errorCode) } : {}),
    });
  }
  if (status === "cancelled") {
    throw new ProviderExecutionError({
      code: "cancelled",
      message: "Tripo task was cancelled.",
      retryable: false,
      requestState: "accepted",
    });
  }
  throw invalidResponse(
    `Tripo returned an unrecognized task status: ${JSON.stringify(status)}`,
  );
}

/**
 * `POST /files` (multipart/form-data). Used only when a reference resolves to bytes rather than
 * a Provider-fetchable URL, so Tripo still never receives a `clash-asset://` URI.
 * https://developers.tripo3d.ai/en/docs/files
 */
export async function tripoUploadFile(options: {
  apiKey: string;
  baseUrl?: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  fetch: FetchLike;
}): Promise<string> {
  const apiKey = requireApiKey(options.apiKey, "rejected");
  const form = new FormData();
  form.append(
    "file",
    new Blob([options.bytes.slice()], { type: options.contentType }),
    options.filename,
  );
  const envelope = await tripoRequest({
    method: "POST",
    baseUrl: options.baseUrl,
    path: "/files",
    apiKey,
    body: form,
    operation: "submit",
    fetch: options.fetch,
  });
  const fileToken = envelope.data.file_token;
  if (typeof fileToken !== "string" || !fileToken) {
    throw invalidResponse("Tripo file upload returned no file_token.");
  }
  return fileToken;
}
