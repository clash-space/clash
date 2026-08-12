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

/**
 * The credential, read by the key this plugin's own declaration names.
 *
 * `providers/hilo-hub.json` calls it `accessToken`, and this is the only place that name is spelled
 * in code -- the host scopes the store to this plugin and this account from the spawn, so the read
 * carries no plugin id or account id that could name somebody else's.
 *
 * The declaration gives the field `default: ""`, which makes it optional to *store*; it does not
 * make an empty token usable. An empty string travels to Hub as `authorization: Bearer ` and comes
 * back as an authentication failure that names the token rather than its absence, which sends the
 * reader looking for a revoked credential instead of an unconfigured one.
 */
async function requireAccessToken(context: ExecutorContext): Promise<string> {
  const accessToken = await context.store?.get("accessToken");
  if (!accessToken) {
    throw new Error(
      "This MiniMax Hub account has no accessToken stored. Sign in, or paste a token into the " +
        "account's Access token field.",
    );
  }
  return accessToken;
}

function hubRequest(context: ExecutorContext) {
  return requireAccessToken(context).then((accessToken) =>
    createHubRequest(globalThis.fetch, accessToken),
  );
}

function references(
  invocation: Parameters<ProviderExecutor["submit"]>[0],
  context: ExecutorContext,
): Promise<HubReferences> {
  // `context.reference` tells us whether bytes are already local or must first be fetched from a
  // public URL. Upload-based Hub families normalize both forms through the upload endpoint.
  return collectReferences(invocation, context.reference);
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
    // The route first, then the token. An unsupported model is a wiring fault that no credential
    // fixes, and answering it with "no accessToken" sends the reader to the account screen for a
    // problem that is not there.
    readSubmitRoute(invocation);
    const resolved = await references(invocation, context);
    const request = await hubRequest(context);
    return submitHubModel(invocation, request, resolved, {
      fetch: globalThis.fetch,
    });
  },
  async poll(invocation, context: ExecutorContext): Promise<ExecutorStep> {
    readPollState(invocation);
    return pollHubModel(invocation, await hubRequest(context));
  },
};
