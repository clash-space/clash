/**
 * Reference resolution and the submit/poll Executor for the Move AI Provider.
 *
 * This plugin binds exactly one built-in Card, `move-ai-s2`, which it never contributes: Card
 * ownership and parameters live in `packages/shared-types`. `move-ai-s2` takes no prompt --
 * exactly one reference video is the only input, and Move AI's `S2` single-cam mocap model
 * always produces one rigged, animated `MAIN_GLB` output.
 *
 * Move AI's upload flow (`createFile` -> presigned PUT -> `createSingleCamTake`) requires raw
 * bytes it can PUT directly; there is no "give Move AI a URL and let it fetch" mode. So unlike
 * Tripo, a `provider-url` or `executor-url` resolved reference is rejected here rather than
 * fetched or forwarded -- only `bytes` is a supported delivery form, and only a supported video
 * `mediaType` within that.
 */

import { ProviderExecutionError } from "@clash/action-sdk";
import {
  type ExecutorContext,
  type ExecutorStep,
  type ExecutablePluginInvocation,
  type ExecutablePluginReference,
  type ProviderExecutor,
} from "./executor-contract.js";

import {
  moveAiPollJob,
  moveAiSubmitTake,
  type MoveAiPollState,
} from "./move-ai-client.js";

const UPSTREAM_MODEL = "S2";

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
    throw invalidRequest(`Move AI request is missing ${key}.`);
  }
  return value;
}

async function accountApiKey(context: ExecutorContext): Promise<string> {
  return (await context.store.get("apiKey"))?.trim() ?? "";
}

/**
 * Exactly one reference of kind video, checked against the invocation's own reference list --
 * no `context.reference` call, no store read, no fetch -- so a malformed invocation fails before
 * any account or network work happens at all.
 */
function requiredSingleVideoReference(
  invocation: ExecutablePluginInvocation,
): ExecutablePluginReference {
  const references = invocation.input.references;
  if (references.length !== 1) {
    throw invalidRequest(
      `Move AI requires exactly one reference of kind video, received ${references.length}.`,
    );
  }
  const [reference] = references;
  if (!reference || !("asset" in reference) || reference.asset.kind !== "video") {
    throw invalidRequest(
      "Move AI requires exactly one reference of kind video, received a non-video reference.",
    );
  }
  return reference;
}

/** Reads a boolean option from `modelParams` first, falling back to the top-level value. */
function optionalBoolean(
  values: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const params = record(values.modelParams);
  const raw = params[key] !== undefined ? params[key] : values[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== "boolean") {
    throw invalidRequest(`Move AI ${key} must be a boolean.`);
  }
  return raw;
}

async function submit(
  invocation: ExecutablePluginInvocation,
  context: ExecutorContext,
): Promise<ExecutorStep> {
  // Reference shape is validated before any credential or network work happens.
  const videoReference = requiredSingleVideoReference(invocation);

  const values = record(invocation.input.values);
  const upstreamModel = requiredString(values, "upstreamModel");
  if (upstreamModel !== UPSTREAM_MODEL) {
    throw invalidRequest(
      `Move AI only supports upstreamModel ${UPSTREAM_MODEL}, received ${JSON.stringify(upstreamModel)}.`,
    );
  }

  const apiKey = await accountApiKey(context);
  if (!apiKey) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message: "This Move AI account has no apiKey stored.",
      retryable: false,
      requestState: "rejected",
    });
  }

  const trackFingers = optionalBoolean(values, "trackFingers");
  const floorPlane = optionalBoolean(values, "floorPlane");
  const trackBall = optionalBoolean(values, "trackBall");

  const resolved = await context.reference(videoReference);
  if (resolved.form !== "bytes") {
    throw invalidRequest(
      `Move AI requires uploaded video bytes; received ${resolved.form} instead of bytes.`,
    );
  }

  return moveAiSubmitTake({
    apiKey,
    bytes: resolved.bytes,
    mediaType: resolved.mediaType ?? "",
    ...(trackFingers !== undefined ? { trackFingers } : {}),
    ...(floorPlane !== undefined ? { floorPlane } : {}),
    ...(trackBall !== undefined ? { trackBall } : {}),
    fetch: globalThis.fetch,
  });
}

function pollState(value: unknown): MoveAiPollState {
  const state = record(value);
  if (typeof state.jobId !== "string" || !state.jobId) {
    throw new ProviderExecutionError({
      code: "contract_violation",
      message: "Move AI poll state is missing its jobId.",
      retryable: false,
      requestState: "accepted",
    });
  }
  return { jobId: state.jobId };
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
  const result = await moveAiPollJob({ apiKey, state, fetch: globalThis.fetch });
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

export const moveAiAdapter: ProviderExecutor = { submit, poll };
