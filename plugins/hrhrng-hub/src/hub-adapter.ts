import {
  collectReferences,
  createHubRequest,
  pollHubModel,
  readPollState,
  readSubmitRoute,
  submitHubModel,
  type HubReferences,
} from "./hub-executor";
import type {
  ExecutorContext,
  ExecutorStep,
  ProviderExecutor,
} from "./executor-contract";
import { ProviderExecutionError } from "@clash/action-sdk";
import { valueOutput } from "./executor-contract";

/**
 * The credential, read by the key this plugin's own declaration names.
 *
 * `providers/hilo-hub.json` calls it `accessToken`, and this is the only place that name is spelled
 * in code -- the host scopes the store to this plugin and this account from the spawn, so the read
 * carries no plugin id or account id that could name somebody else's.
 *
 * The Host may have no value yet while an account is being configured; that does not make an empty
 * token usable. An empty string travels to Hub as `authorization: Bearer ` and comes back as an
 * authentication failure that names the token rather than its absence, which sends the reader
 * looking for a revoked credential instead of an unconfigured one.
 */
async function requireAccessToken(
  context: ExecutorContext,
  requestState: "rejected" | "accepted",
): Promise<string> {
  const accessToken = await context.store?.get("accessToken");
  if (!accessToken) {
    throw new ProviderExecutionError({
      code: "authentication_failed",
      message:
        "This MiniMax Hub account has no accessToken stored. Sign in, or paste a token into the " +
        "account's Access token field.",
      retryable: false,
      requestState,
    });
  }
  return accessToken;
}

function hubRequest(
  context: ExecutorContext,
  operation: "submit" | "poll",
  origin?: string,
) {
  return requireAccessToken(
    context,
    operation === "submit" ? "rejected" : "accepted",
  ).then((accessToken) =>
    createHubRequest(globalThis.fetch, accessToken, operation, origin),
  );
}

function references(
  invocation: Parameters<ProviderExecutor["submit"]>[0],
  context: ExecutorContext,
): Promise<HubReferences> {
  // `context.reference` tells us whether bytes are already local or must first be fetched from a
  // public URL. Upload-based Hub families normalize both forms through the upload endpoint.
  return collectReferences(invocation, (reference) =>
    context.reference(
      reference as Parameters<ExecutorContext["reference"]>[0],
    ),
  );
}

function isMediaAnalysis(
  invocation: Parameters<ProviderExecutor["submit"]>[0],
): boolean {
  return invocation.input.values.apiShape === "hub-analyse-media";
}

async function analyzeMedia(
  invocation: Parameters<ProviderExecutor["submit"]>[0],
  context: ExecutorContext,
): Promise<ExecutorStep> {
  const prompt = invocation.input.values.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new ProviderExecutionError({
      code: "invalid_request",
      message: "Hilo media analysis requires a question.",
      retryable: false,
      requestState: "rejected",
    });
  }
  const mediaReferences = invocation.input.references.filter(
    (reference) => "asset" in reference,
  );
  if (mediaReferences.length !== 1) {
    throw new ProviderExecutionError({
      code: "invalid_request",
      message: "Hilo media analysis requires exactly one media reference.",
      retryable: false,
      requestState: "rejected",
    });
  }
  const resolved = await context.reference(mediaReferences[0]!);
  if (resolved.form !== "bytes" || !resolved.mediaType) {
    throw new ProviderExecutionError({
      code: "invalid_request",
      message: "Hilo media analysis requires media bytes with a MIME type.",
      retryable: false,
      requestState: "rejected",
    });
  }
  const response = await (await hubRequest(
    context,
    "submit",
    "https://design.minimax.io",
  ))(
    "/api/v1/tool/analyze_media",
    "POST",
    {
      media_data: Buffer.from(resolved.bytes).toString("base64"),
      mime_type: resolved.mediaType,
      question: prompt.trim(),
    },
  );
  if (typeof response.text !== "string" || !response.text.trim()) {
    throw new ProviderExecutionError({
      code: "invalid_response",
      message: "Hilo media analysis returned no text.",
      retryable: false,
      requestState: "accepted",
    });
  }
  return { status: "completed", outputs: valueOutput(response.text, "text") };
}

/**
 * Hub's two halves.
 *
 * Nothing here frames a response, dispatches on an export id, or splits submit from poll: the SDK
 * owns all three. What is left is the vendor's shape -- a token in two headers, media Hub can read,
 * and a task id the host holds between calls.
 */
export const hubAdapter: ProviderExecutor = {
  async submit(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    if (isMediaAnalysis(invocation)) {
      return analyzeMedia(invocation, context);
    }
    // The route first, then the token. An unsupported model is a wiring fault that no credential
    // fixes, and answering it with "no accessToken" sends the reader to the account screen for a
    // problem that is not there.
    readSubmitRoute(invocation);
    const resolved = await references(invocation, context);
    const request = await hubRequest(context, "submit");
    return submitHubModel(invocation, request, resolved, {
      fetch: globalThis.fetch,
    });
  },
  async poll(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    readPollState(invocation);
    return pollHubModel(invocation, await hubRequest(context, "poll"));
  },
};
