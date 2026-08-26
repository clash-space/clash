/**
 * Route selection and reference resolution for the Tripo Provider executor.
 *
 * This plugin binds exactly two built-in Cards, neither of which it contributes: `tripo-h3.1`
 * (text-to-3D and image-to-3D behind one identity) and `tripo-auto-rig` (model-to-model). Card
 * ownership and parameters live in `packages/shared-types`; this file only knows how to invoke
 * Tripo for the values and references a bound invocation carries.
 *
 * `tripo-h3.1` picks its route by presence, not by a card-level mode switch: a reference in slot
 * `image` means `POST /generation/image-to-model` (which has no prompt field at all), and its
 * absence means `POST /generation/text-to-model`. `tripo-auto-rig` always resolves a required
 * `model` slot and always requests biped/mixamo/glb -- Tripo's other rig topologies are not
 * offered by this contract.
 */

import {
  ProviderExecutionError,
  providerHttpError,
  type ExecutorContext,
  type ExecutorStep,
  type Executor as ProviderExecutor,
} from "@clash/action-sdk";
import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

import {
  buildTripoImageToModelBody,
  buildTripoRigBody,
  buildTripoTextToModelBody,
  tripoPollTask,
  tripoSubmitTask,
  tripoUploadFile,
  type TripoPollState,
  type TripoQualityInput,
} from "./tripo-client.js";
import { tripoBaseUrl } from "./tripo-region.js";

const TEXT_IMAGE_MODEL_ID = "tripo-h3.1";
const AUTO_RIG_MODEL_ID = "tripo-auto-rig";

type ReferenceLike = ExecutablePluginInvocation["input"]["references"][number];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function invalidRequest(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_request",
    message,
    retryable: false,
    requestState: "rejected",
  });
}

function requiredString(values: Record<string, unknown>, key: string): string {
  const value = values[key];
  if (typeof value !== "string" || !value.trim()) {
    throw invalidRequest(`Tripo request is missing ${key}.`);
  }
  return value;
}

async function accountApiKey(context: ExecutorContext): Promise<string> {
  return (await context.store.get("apiKey"))?.trim() ?? "";
}

/**
 * The host to call for this account. Region is an account/plugin-store fact -- who issued the
 * key -- never a Card parameter, so it is read from the same scoped store as `apiKey` and
 * resolved once per operation before any request is built.
 */
async function accountBaseUrl(
  context: ExecutorContext,
  requestState: "rejected" | "accepted",
): Promise<string> {
  const region = await context.store.get("region");
  return tripoBaseUrl({
    ...(region ? { region } : {}),
    requestState,
  });
}

function qualityInput(values: Record<string, unknown>): TripoQualityInput {
  const params = record(values.modelParams);
  const pick = (key: string): unknown =>
    params[key] !== undefined ? params[key] : values[key];
  const input: TripoQualityInput = {};
  for (const key of [
    "pbr",
    "textureQuality",
    "geometryQuality",
    "faceLimit",
    "autoSize",
  ] as const) {
    const value = pick(key);
    if (value !== undefined) input[key] = value;
  }
  return input;
}

function defaultMediaType(kind: "image" | "model"): string {
  return kind === "image" ? "image/png" : "model/gltf-binary";
}

function defaultExtension(mediaType: string): string {
  if (mediaType === "image/png") return ".png";
  if (mediaType === "image/jpeg" || mediaType === "image/jpg") return ".jpg";
  if (mediaType === "image/webp") return ".webp";
  if (mediaType === "model/gltf-binary") return ".glb";
  return "";
}

/**
 * Resolve one reference into a string Tripo's `input` field can consume: a Provider-fetchable
 * URL passed through unchanged, or bytes (the Host's own or fetched from a short-lived
 * executor-scoped URL) uploaded through Tripo's own Files API to get a `file_token`. A
 * `clash-asset://` URI never reaches either path.
 */
async function resolvedTripoInput(options: {
  reference: ReferenceLike;
  kind: "image" | "model";
  apiKey: string;
  baseUrl: string;
  context: ExecutorContext;
}): Promise<string> {
  const resolved = await options.context.reference(options.reference);
  if (resolved.form === "text" || resolved.form === "document") {
    throw invalidRequest(
      `Tripo ${options.kind} reference resolved to ${resolved.form} instead of media.`,
    );
  }
  if (resolved.kind && resolved.kind !== options.kind) {
    throw invalidRequest(
      `Tripo ${options.reference.slot} reference must be ${options.kind}.`,
    );
  }
  if (resolved.form === "provider-url") return resolved.providerUrl;

  let bytes: Uint8Array;
  let mediaType: string;
  if (resolved.form === "bytes") {
    bytes = resolved.bytes;
    mediaType = resolved.mediaType ?? defaultMediaType(options.kind);
  } else {
    // executor-url: reachable by this executor, but not a Provider URL and not Asset identity.
    // Fetch the bytes ourselves and upload them, exactly as if the Host had handed us bytes.
    const response = await globalThis.fetch(resolved.executorUrl);
    if (!response.ok) {
      throw providerHttpError({
        status: response.status,
        message: `Tripo could not fetch the executor-scoped ${options.kind} reference.`,
        operation: "submit",
      });
    }
    bytes = new Uint8Array(await response.arrayBuffer());
    mediaType = resolved.mediaType ?? defaultMediaType(options.kind);
  }
  return tripoUploadFile({
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    bytes,
    filename: `${options.kind}${defaultExtension(mediaType)}`,
    contentType: mediaType,
    fetch: globalThis.fetch,
  });
}

async function submitTextOrImageToModel(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
  apiKey: string,
  baseUrl: string,
  upstreamModel: string,
): Promise<ExecutorStep> {
  const values = record(invocation.input.values);
  const imageReference = invocation.input.references.find(
    (reference) => reference.slot === "image",
  );

  if (imageReference) {
    const inputImage = await resolvedTripoInput({
      reference: imageReference,
      kind: "image",
      apiKey,
      baseUrl,
      context,
    });
    const body = buildTripoImageToModelBody({
      inputImage,
      model: upstreamModel,
      ...qualityInput(values),
    });
    return tripoSubmitTask({
      apiKey,
      baseUrl,
      path: "/generation/image-to-model",
      body,
      fetch: globalThis.fetch,
    });
  }

  const prompt = typeof values.prompt === "string" ? values.prompt : "";
  const body = buildTripoTextToModelBody({
    prompt,
    model: upstreamModel,
    ...qualityInput(values),
  });
  return tripoSubmitTask({
    apiKey,
    baseUrl,
    path: "/generation/text-to-model",
    body,
    fetch: globalThis.fetch,
  });
}

async function submitAutoRig(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
  apiKey: string,
  baseUrl: string,
  upstreamModel: string,
): Promise<ExecutorStep> {
  const modelReference = invocation.input.references.find(
    (reference) => reference.slot === "model",
  );
  if (!modelReference) {
    throw invalidRequest("Tripo auto-rig requires a reference in slot model.");
  }
  const inputModel = await resolvedTripoInput({
    reference: modelReference,
    kind: "model",
    apiKey,
    baseUrl,
    context,
  });
  const body = buildTripoRigBody({ inputModel, model: upstreamModel });
  return tripoSubmitTask({
    apiKey,
    baseUrl,
    path: "/animations/rig",
    body,
    fetch: globalThis.fetch,
  });
}

async function submit(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  const apiKey = await accountApiKey(context);
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Tripo account has no apiKey stored.",
      retryable: false,
      requestState: "rejected",
    });
  }
  // Resolved once per submit, from the same account, and threaded unchanged into every request
  // this operation makes (upload and generation alike) -- never re-derived, retried against the
  // other documented host, or mixed across a single invocation.
  const baseUrl = await accountBaseUrl(context, "rejected");
  const values = record(invocation.input.values);
  const modelId = requiredString(values, "modelId");
  const upstreamModel = requiredString(values, "upstreamModel");

  if (modelId === TEXT_IMAGE_MODEL_ID) {
    return submitTextOrImageToModel(invocation, context, apiKey, baseUrl, upstreamModel);
  }
  if (modelId === AUTO_RIG_MODEL_ID) {
    return submitAutoRig(invocation, context, apiKey, baseUrl, upstreamModel);
  }
  throw invalidRequest(`Unsupported Tripo model: ${modelId}.`);
}

function pollState(value: unknown): TripoPollState {
  const state = record(value);
  if (typeof state.taskId !== "string" || !state.taskId) {
    throw new ProviderExecutionError({
      code: "contract_violation",
      message: "Tripo poll state is missing its taskId.",
      retryable: false,
      requestState: "accepted",
    });
  }
  return { taskId: state.taskId };
}

async function poll(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  // Durable state is provider-owned evidence that submission already happened. Validate it
  // before reading account secrets so a corrupt journal entry fails independently of which
  // account it belongs to.
  const state = pollState(invocation.pollState);
  const apiKey = await accountApiKey(context);
  const baseUrl = await accountBaseUrl(context, "accepted");
  const result = await tripoPollTask({ apiKey, baseUrl, state, fetch: globalThis.fetch });
  if (result.status === "accepted") return result;
  return {
    status: "completed",
    media: {
      media: {
        url: result.media.url,
        mediaType: result.media.mediaType,
        kind: "model",
      },
    },
  };
}

export const tripoAdapter: ProviderExecutor = { submit, poll };
