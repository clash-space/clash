import { ProviderExecutionError } from "@clash/action-sdk";
import type {
  ExecutablePluginInvocation,
  ExecutablePluginReference,
} from "@clash/shared-types/executable-plugin";

import type { ExecutorContext, ExecutorStep, ProviderExecutor, ResolvedReference } from "./executor-contract.js";
import {
  meshyPollImageToThreeD,
  meshyPollRigging,
  meshyPollTextToThreeD,
  meshySubmitImageToThreeD,
  meshySubmitRigging,
  meshySubmitTextToThreeD,
  type MeshyPollResult,
  type MeshyPollState,
  type MeshyPoseMode,
  type MeshySubmitResult,
  type MeshyTextureResolution,
} from "./meshy-executor.js";

/**
 * Meshy's card-facing half.
 *
 * `meshy-executor.ts` knows Meshy's wire shapes and nothing about the Host. This file knows the
 * Host: which invocation values name which route, how a reference becomes a URL Meshy can fetch,
 * and which stored field holds the account's key. Neither file could stand in for the other
 * without smuggling one concern into the wrong test.
 */

const RIG_UPSTREAM_MODEL = "rig";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function modelParam(values: Record<string, unknown>, id: string): unknown {
  const params = record(values.modelParams);
  return id in params ? params[id] : values[id];
}

function booleanParam(values: Record<string, unknown>, id: string): boolean {
  return modelParam(values, id) === true;
}

function stringParam(values: Record<string, unknown>, id: string): string | undefined {
  const raw = modelParam(values, id);
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function numberParam(values: Record<string, unknown>, id: string): number | undefined {
  const raw = modelParam(values, id);
  return typeof raw === "number" ? raw : undefined;
}

function invalidRequest(message: string): ProviderExecutionError {
  return new ProviderExecutionError({
    code: "invalid_request",
    message,
    retryable: false,
    requestState: "rejected",
  });
}

async function requireApiKey(
  context: ExecutorContext,
  requestState: "rejected" | "accepted",
): Promise<string> {
  const apiKey = await context.store?.get("apiKey");
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Meshy account has no apiKey stored.",
      retryable: false,
      requestState,
    });
  }
  return apiKey;
}

function assetReferencesOfKind(
  references: readonly ExecutablePluginReference[],
  kind: "image" | "model",
): ExecutablePluginReference[] {
  return references.filter((reference) => "asset" in reference && reference.asset.kind === kind);
}

/**
 * A reference resolved into exactly what Meshy's own `image_url` / `model_url` fields accept: a
 * publicly fetchable URL, or a base64 data URI. Never the Host's internal `clash-asset://` handle,
 * and never a Host-local `executor-url` capability an external Provider cannot reach.
 */
async function resolveMeshyMediaUrl(
  context: ExecutorContext,
  reference: ExecutablePluginReference,
  label: string,
): Promise<string> {
  const resolved: ResolvedReference = await context.reference(reference);
  if (resolved.form === "provider-url") return resolved.providerUrl;
  if (resolved.form === "bytes") {
    const mediaType = resolved.mediaType ?? "application/octet-stream";
    return `data:${mediaType};base64,${Buffer.from(resolved.bytes).toString("base64")}`;
  }
  throw invalidRequest(`${label} must resolve to a fetchable URL or bytes, not ${resolved.form}.`);
}

function generateInputFromValues(values: Record<string, unknown>): {
  aiModel: string;
  pbr: boolean;
  textureResolution?: MeshyTextureResolution;
  poseMode?: MeshyPoseMode;
  targetPolycount?: number;
} {
  const aiModel = typeof values.upstreamModel === "string" ? values.upstreamModel : "";
  const textureResolution = stringParam(values, "textureResolution") as MeshyTextureResolution | undefined;
  const poseMode = stringParam(values, "poseMode") as MeshyPoseMode | undefined;
  const targetPolycount = numberParam(values, "targetPolycount");
  return {
    aiModel,
    pbr: booleanParam(values, "PBR"),
    ...(textureResolution ? { textureResolution } : {}),
    ...(poseMode !== undefined ? { poseMode } : {}),
    ...(targetPolycount !== undefined ? { targetPolycount } : {}),
  };
}

function toExecutorStep(result: MeshySubmitResult | MeshyPollResult): ExecutorStep {
  if (result.status === "accepted") {
    return {
      status: "accepted",
      pollState: result.pollState,
      ...("retryAfterMs" in result && result.retryAfterMs !== undefined
        ? { retryAfterMs: result.retryAfterMs }
        : {}),
    };
  }
  return {
    status: "completed",
    media: {
      media: { url: result.media.url, mediaType: result.media.mediaType, kind: "model" },
    },
  };
}

function parseMeshyPollState(value: unknown): MeshyPollState {
  const state = record(value);
  if (state.kind === "text-to-3d") {
    if (
      typeof state.taskId === "string" &&
      state.taskId &&
      (state.phase === "preview" || state.phase === "refine")
    ) {
      if (state.phase === "refine") {
        return { kind: "text-to-3d", phase: "refine", taskId: state.taskId };
      }
      if (typeof state.aiModel === "string" && state.aiModel && typeof state.pbr === "boolean") {
        return {
          kind: "text-to-3d",
          phase: "preview",
          taskId: state.taskId,
          aiModel: state.aiModel,
          pbr: state.pbr,
          ...(typeof state.textureResolution === "string"
            ? { textureResolution: state.textureResolution as MeshyTextureResolution }
            : {}),
        };
      }
    }
  } else if (state.kind === "image-to-3d" || state.kind === "rig") {
    if (typeof state.taskId === "string" && state.taskId) {
      return { kind: state.kind, taskId: state.taskId };
    }
  }
  throw new ProviderExecutionError({
    code: "contract_violation",
    message: "Meshy poll state is missing or invalid.",
    retryable: false,
    requestState: "accepted",
  });
}

async function submitRig(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  const modelReferences = assetReferencesOfKind(invocation.input.references, "model");
  if (modelReferences.length !== 1) {
    throw invalidRequest("Meshy auto-rig requires exactly one model reference.");
  }
  const heightMeters = numberParam(invocation.input.values, "heightMeters");
  const apiKey = await requireApiKey(context, "rejected");
  const modelUrl = await resolveMeshyMediaUrl(context, modelReferences[0]!, "Meshy auto-rig model");
  return toExecutorStep(
    await meshySubmitRigging({
      apiKey,
      fetch: globalThis.fetch as never,
      input: { modelUrl, ...(heightMeters !== undefined ? { heightMeters } : {}) },
    }),
  );
}

async function submitGenerate(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  const values = invocation.input.values;
  const imageReferences = assetReferencesOfKind(invocation.input.references, "image");
  if (imageReferences.length > 1) {
    throw invalidRequest("Meshy accepts at most one image reference.");
  }
  const generateInput = generateInputFromValues(values);
  const prompt = typeof values.prompt === "string" ? values.prompt : "";
  const apiKey = await requireApiKey(context, "rejected");

  if (imageReferences.length === 1) {
    const imageUrl = await resolveMeshyMediaUrl(context, imageReferences[0]!, "Meshy image-to-3d image");
    return toExecutorStep(
      await meshySubmitImageToThreeD({
        apiKey,
        fetch: globalThis.fetch as never,
        input: { ...generateInput, imageUrl, prompt },
      }),
    );
  }

  return toExecutorStep(
    await meshySubmitTextToThreeD({
      apiKey,
      fetch: globalThis.fetch as never,
      input: { ...generateInput, prompt },
    }),
  );
}

export const meshyAdapter: ProviderExecutor = {
  async submit(invocation, context): Promise<ExecutorStep> {
    const upstreamModel = invocation.input.values.upstreamModel;
    if (typeof upstreamModel !== "string" || !upstreamModel) {
      throw invalidRequest("Meshy executor needs a model.");
    }
    if (upstreamModel === RIG_UPSTREAM_MODEL) {
      return submitRig(invocation, context);
    }
    return submitGenerate(invocation, context);
  },

  async poll(invocation, context): Promise<ExecutorStep> {
    // The durable state names its own shape before anything asks the account for a credential; a
    // corrupt journal entry is a contract failure independent of which account owns it.
    const state = parseMeshyPollState(invocation.pollState);
    const apiKey = await requireApiKey(context, "accepted");
    const fetchImpl = globalThis.fetch as never;
    if (state.kind === "text-to-3d") {
      return toExecutorStep(await meshyPollTextToThreeD({ apiKey, fetch: fetchImpl, state }));
    }
    if (state.kind === "image-to-3d") {
      return toExecutorStep(await meshyPollImageToThreeD({ apiKey, fetch: fetchImpl, state }));
    }
    return toExecutorStep(await meshyPollRigging({ apiKey, fetch: fetchImpl, state }));
  },
};
