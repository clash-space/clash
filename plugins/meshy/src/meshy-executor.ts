import { ProviderExecutionError, providerHttpError } from "@clash/action-sdk";

/**
 * Meshy's REST surface, verified against docs.meshy.ai's current Text to 3D (v2), Image to 3D
 * (v1), and Rigging (v1) references.
 *
 * Every generation and every rig is asynchronous: a POST returns a task id, and the caller polls
 * GET until the task's `status` reaches a terminal value. Text to 3D additionally has two stages
 * behind one endpoint -- a `preview` mesh, then a `refine` pass that submits a second task naming
 * the first's id. Image to 3D and Rigging are each one stage.
 */
export const MESHY_BASE_URL = "https://api.meshy.ai/openapi";

const TEXTURE_RESOLUTIONS = ["2k", "4k", "8k"] as const;
export type MeshyTextureResolution = (typeof TEXTURE_RESOLUTIONS)[number];

const POSE_MODES = ["a-pose", "t-pose", ""] as const;
export type MeshyPoseMode = (typeof POSE_MODES)[number];

// Documented range for `target_polycount` on the remesh path (the only path this plugin exposes
// it through). Smart Topology's own 100-15,000 range is a different model_type this plugin does
// not offer, so it is not one of this executor's contracts to defend.
const MIN_TARGET_POLYCOUNT = 100;
const MAX_TARGET_POLYCOUNT = 300_000;

export interface MeshyGenerateInput {
  aiModel: string;
  /** Guides shape (text-to-3d) or texture (image-to-3d, when an image is also present). */
  prompt: string;
  pbr: boolean;
  textureResolution?: MeshyTextureResolution;
  poseMode?: MeshyPoseMode;
  targetPolycount?: number;
}

export interface MeshyImageToThreeDInput extends MeshyGenerateInput {
  imageUrl: string;
}

export interface MeshyRefineInput {
  aiModel: string;
  pbr: boolean;
  textureResolution?: MeshyTextureResolution;
}

export interface MeshyRigInput {
  modelUrl: string;
  heightMeters?: number;
}

export type MeshyPollState =
  | {
      kind: "text-to-3d";
      phase: "preview";
      taskId: string;
      aiModel: string;
      pbr: boolean;
      textureResolution?: MeshyTextureResolution;
    }
  | { kind: "text-to-3d"; phase: "refine"; taskId: string }
  | { kind: "image-to-3d"; taskId: string }
  | { kind: "rig"; taskId: string };

export type MeshyMedia = { url: string; mediaType: "model/gltf-binary" };

export type MeshySubmitResult = { status: "accepted"; pollState: MeshyPollState };

export type MeshyPollResult =
  | { status: "accepted"; pollState: MeshyPollState; retryAfterMs?: number }
  | { status: "completed"; media: MeshyMedia };

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

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function poseModeField(poseMode: MeshyPoseMode | undefined): string {
  if (poseMode === undefined) return "";
  if (!POSE_MODES.includes(poseMode)) {
    throw invalidRequest(
      `Meshy pose mode must be one of ${POSE_MODES.map((mode) => `"${mode}"`).join(", ")}.`,
    );
  }
  return poseMode;
}

function textureResolutionField(
  resolution: MeshyTextureResolution | undefined,
): MeshyTextureResolution | undefined {
  if (resolution === undefined) return undefined;
  if (!TEXTURE_RESOLUTIONS.includes(resolution)) {
    throw invalidRequest(
      `Meshy texture resolution must be one of ${TEXTURE_RESOLUTIONS.join(", ")}.`,
    );
  }
  return resolution;
}

function targetPolycountFields(targetPolycount: number | undefined): Record<string, unknown> {
  if (targetPolycount === undefined) return {};
  if (
    !Number.isFinite(targetPolycount) ||
    targetPolycount < MIN_TARGET_POLYCOUNT ||
    targetPolycount > MAX_TARGET_POLYCOUNT
  ) {
    throw invalidRequest(
      `Meshy target polycount must be between ${MIN_TARGET_POLYCOUNT} and ${MAX_TARGET_POLYCOUNT}.`,
    );
  }
  // `target_polycount` only takes effect on the remesh path for a standard model; this plugin
  // exposes no `should_remesh` control of its own, so requesting a polycount is what turns remesh
  // on. This is an upstream-only request invariant, not a second product-visible parameter.
  return { target_polycount: targetPolycount, should_remesh: true };
}

/** The untextured preview stage of Text to 3D: `POST /v2/text-to-3d`, `mode: "preview"`. */
export function buildTextToThreeDPreviewBody(input: MeshyGenerateInput): Record<string, unknown> {
  const prompt = input.prompt.trim();
  if (!prompt) throw invalidRequest("Meshy text-to-3d requires a prompt.");
  return {
    mode: "preview",
    prompt,
    ai_model: input.aiModel,
    target_formats: ["glb"],
    pose_mode: poseModeField(input.poseMode),
    ...targetPolycountFields(input.targetPolycount),
  };
}

/** The texturing stage of Text to 3D: `POST /v2/text-to-3d`, `mode: "refine"`. */
export function buildTextToThreeDRefineBody(
  previewTaskId: string,
  input: MeshyRefineInput,
): Record<string, unknown> {
  if (!previewTaskId.trim()) {
    throw invalidRequest("Meshy text-to-3d refine requires a preview task id.");
  }
  const textureResolution = textureResolutionField(input.textureResolution);
  return {
    mode: "refine",
    preview_task_id: previewTaskId,
    ai_model: input.aiModel,
    target_formats: ["glb"],
    // `false` is an explicit choice, not an absent one; the field is always sent.
    enable_pbr: input.pbr,
    ...(textureResolution ? { texture_resolution: textureResolution } : {}),
  };
}

/** `POST /v1/image-to-3d`. Single stage: mesh and texture in one task. */
export function buildImageToThreeDBody(input: MeshyImageToThreeDInput): Record<string, unknown> {
  const imageUrl = input.imageUrl.trim();
  if (!imageUrl) throw invalidRequest("Meshy image-to-3d requires an image URL.");
  const prompt = input.prompt.trim();
  const textureResolution = textureResolutionField(input.textureResolution);
  return {
    image_url: imageUrl,
    ai_model: input.aiModel,
    target_formats: ["glb"],
    enable_pbr: input.pbr,
    pose_mode: poseModeField(input.poseMode),
    ...(textureResolution ? { texture_resolution: textureResolution } : {}),
    ...(prompt ? { texture_prompt: prompt } : {}),
    ...targetPolycountFields(input.targetPolycount),
  };
}

/** `POST /v1/rigging`. Single stage: a rigged, skinned GLB/FBX pair. */
export function buildRiggingBody(input: MeshyRigInput): Record<string, unknown> {
  const modelUrl = input.modelUrl.trim();
  if (!modelUrl) throw invalidRequest("Meshy auto-rig requires a model URL.");
  if (
    input.heightMeters !== undefined &&
    (!Number.isFinite(input.heightMeters) || input.heightMeters <= 0)
  ) {
    throw invalidRequest("Meshy auto-rig heightMeters must be a positive number.");
  }
  return {
    model_url: modelUrl,
    ...(input.heightMeters !== undefined ? { height_meters: input.heightMeters } : {}),
  };
}

async function readJson(response: { text(): Promise<string> }): Promise<Record<string, unknown>> {
  const raw = await response.text();
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return { message: raw };
  }
}

function messageFrom(body: Record<string, unknown>, fallback: string): string {
  return typeof body.message === "string" && body.message ? body.message : fallback;
}

async function meshyRequest(options: {
  apiKey: string;
  fetch: FetchLike;
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
  operation: "submit" | "poll";
  label: string;
}): Promise<Record<string, unknown>> {
  const response = await options.fetch(`${MESHY_BASE_URL}${options.path}`, {
    method: options.method,
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      "content-type": "application/json",
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw providerHttpError({
      status: response.status,
      message: `${options.label} failed: ${messageFrom(body, response.statusText)}`,
      operation: options.operation,
    });
  }
  return body;
}

function requireResultId(body: Record<string, unknown>, label: string): string {
  const result = body.result;
  if (typeof result !== "string" || !result) {
    throw new ProviderExecutionError({
      code: "invalid_response",
      message: `${label} returned no task id.`,
      retryable: false,
      requestState: "unknown",
    });
  }
  return result;
}

/** Advances the caller past a still-running task, or throws for a documented terminal failure. */
function ensureTaskOutcome(body: Record<string, unknown>, label: string): "pending" | "succeeded" {
  const status = body.status;
  if (status === "PENDING" || status === "IN_PROGRESS") return "pending";
  if (status === "SUCCEEDED") return "succeeded";
  if (status === "FAILED" || status === "CANCELED") {
    const taskError = record(body.task_error);
    const message =
      typeof taskError.message === "string" && taskError.message
        ? taskError.message
        : `${label} finished as ${status}.`;
    const providerCode =
      (typeof taskError.code === "string" && taskError.code) ||
      (typeof taskError.type === "string" && taskError.type) ||
      String(status);
    throw new ProviderExecutionError({
      code: status === "CANCELED" ? "cancelled" : "provider_failed",
      message: `${label}: ${message}`,
      retryable: false,
      requestState: "accepted",
      providerCode,
    });
  }
  throw invalidResponse(`${label} returned an unrecognized task status: ${JSON.stringify(status)}.`);
}

function glbFromModelUrls(modelUrls: unknown, label: string): MeshyMedia {
  const glb = record(modelUrls).glb;
  if (typeof glb !== "string" || !glb) {
    throw invalidResponse(`${label} returned no GLB URL.`);
  }
  return { url: glb, mediaType: "model/gltf-binary" };
}

const PREVIEW_RETRY_MS = 2_000;

export async function meshySubmitTextToThreeD(options: {
  apiKey: string;
  fetch: FetchLike;
  input: MeshyGenerateInput;
}): Promise<MeshySubmitResult> {
  const body = buildTextToThreeDPreviewBody(options.input);
  const response = await meshyRequest({
    apiKey: options.apiKey,
    fetch: options.fetch,
    method: "POST",
    path: "/v2/text-to-3d",
    body,
    operation: "submit",
    label: "Meshy text-to-3d preview",
  });
  const taskId = requireResultId(response, "Meshy text-to-3d preview");
  return {
    status: "accepted",
    pollState: {
      kind: "text-to-3d",
      phase: "preview",
      taskId,
      aiModel: options.input.aiModel,
      pbr: options.input.pbr,
      ...(options.input.textureResolution ? { textureResolution: options.input.textureResolution } : {}),
    },
  };
}

export async function meshyPollTextToThreeD(options: {
  apiKey: string;
  fetch: FetchLike;
  state: MeshyPollState & { kind: "text-to-3d" };
}): Promise<MeshyPollResult> {
  const { state } = options;
  if (state.phase === "preview") {
    const body = await meshyRequest({
      apiKey: options.apiKey,
      fetch: options.fetch,
      method: "GET",
      path: `/v2/text-to-3d/${encodeURIComponent(state.taskId)}`,
      operation: "poll",
      label: "Meshy text-to-3d preview",
    });
    if (ensureTaskOutcome(body, "Meshy text-to-3d preview") === "pending") {
      return { status: "accepted", pollState: state, retryAfterMs: PREVIEW_RETRY_MS };
    }
    // The preview succeeded; submit refine now and report the new task rather than waiting for a
    // separate invocation to notice. A poll that only watched would leave the refine step
    // unstarted forever once the preview settled.
    const refineResponse = await meshyRequest({
      apiKey: options.apiKey,
      fetch: options.fetch,
      method: "POST",
      path: "/v2/text-to-3d",
      body: buildTextToThreeDRefineBody(state.taskId, {
        aiModel: state.aiModel,
        pbr: state.pbr,
        ...(state.textureResolution ? { textureResolution: state.textureResolution } : {}),
      }),
      operation: "poll",
      label: "Meshy text-to-3d refine",
    });
    const refineTaskId = requireResultId(refineResponse, "Meshy text-to-3d refine");
    return {
      status: "accepted",
      pollState: { kind: "text-to-3d", phase: "refine", taskId: refineTaskId },
      retryAfterMs: 0,
    };
  }

  const body = await meshyRequest({
    apiKey: options.apiKey,
    fetch: options.fetch,
    method: "GET",
    path: `/v2/text-to-3d/${encodeURIComponent(state.taskId)}`,
    operation: "poll",
    label: "Meshy text-to-3d refine",
  });
  if (ensureTaskOutcome(body, "Meshy text-to-3d refine") === "pending") {
    return { status: "accepted", pollState: state, retryAfterMs: PREVIEW_RETRY_MS };
  }
  return { status: "completed", media: glbFromModelUrls(body.model_urls, "Meshy text-to-3d refine") };
}

export async function meshySubmitImageToThreeD(options: {
  apiKey: string;
  fetch: FetchLike;
  input: MeshyImageToThreeDInput;
}): Promise<MeshySubmitResult> {
  const body = buildImageToThreeDBody(options.input);
  const response = await meshyRequest({
    apiKey: options.apiKey,
    fetch: options.fetch,
    method: "POST",
    path: "/v1/image-to-3d",
    body,
    operation: "submit",
    label: "Meshy image-to-3d",
  });
  const taskId = requireResultId(response, "Meshy image-to-3d");
  return { status: "accepted", pollState: { kind: "image-to-3d", taskId } };
}

export async function meshyPollImageToThreeD(options: {
  apiKey: string;
  fetch: FetchLike;
  state: MeshyPollState & { kind: "image-to-3d" };
}): Promise<MeshyPollResult> {
  const body = await meshyRequest({
    apiKey: options.apiKey,
    fetch: options.fetch,
    method: "GET",
    path: `/v1/image-to-3d/${encodeURIComponent(options.state.taskId)}`,
    operation: "poll",
    label: "Meshy image-to-3d",
  });
  if (ensureTaskOutcome(body, "Meshy image-to-3d") === "pending") {
    return { status: "accepted", pollState: options.state, retryAfterMs: PREVIEW_RETRY_MS };
  }
  return { status: "completed", media: glbFromModelUrls(body.model_urls, "Meshy image-to-3d") };
}

export async function meshySubmitRigging(options: {
  apiKey: string;
  fetch: FetchLike;
  input: MeshyRigInput;
}): Promise<MeshySubmitResult> {
  const body = buildRiggingBody(options.input);
  const response = await meshyRequest({
    apiKey: options.apiKey,
    fetch: options.fetch,
    method: "POST",
    path: "/v1/rigging",
    body,
    operation: "submit",
    label: "Meshy auto-rig",
  });
  const taskId = requireResultId(response, "Meshy auto-rig");
  return { status: "accepted", pollState: { kind: "rig", taskId } };
}

export async function meshyPollRigging(options: {
  apiKey: string;
  fetch: FetchLike;
  state: MeshyPollState & { kind: "rig" };
}): Promise<MeshyPollResult> {
  const body = await meshyRequest({
    apiKey: options.apiKey,
    fetch: options.fetch,
    method: "GET",
    path: `/v1/rigging/${encodeURIComponent(options.state.taskId)}`,
    operation: "poll",
    label: "Meshy auto-rig",
  });
  if (ensureTaskOutcome(body, "Meshy auto-rig") === "pending") {
    return { status: "accepted", pollState: options.state, retryAfterMs: PREVIEW_RETRY_MS };
  }
  const glbUrl = record(body.result).rigged_character_glb_url;
  if (typeof glbUrl !== "string" || !glbUrl) {
    throw invalidResponse("Meshy auto-rig returned no rigged GLB URL.");
  }
  return { status: "completed", media: { url: glbUrl, mediaType: "model/gltf-binary" } };
}
