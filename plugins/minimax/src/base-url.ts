/**
 * Which MiniMax host to call, from what the account stored.
 *
 * The executor used to take a `baseUrl` that "arrives from whoever holds the account" -- and nothing
 * ever sent one. It came from `context.endpoint`: declared on the SDK context, read by two plugins,
 * written by no layer at all, and absent from the invocation schema, so a caller supplying one had
 * it dropped before the plugin ran.
 *
 * The account does say which host, in the terms its own auth method declares. `service` is that
 * term, and turning it into a URL is API shape translation -- this plugin's whole job. The host must
 * not know that a field called `service` names a MiniMax deployment.
 */

export interface MinimaxBaseUrlInput {
  service?: string;
  /** A proxy in front of the vendor, stored under the key the declaration names. */
  baseUrl?: string;
}

const HOSTS: Record<string, string> = {
  international: "https://api.minimax.io",
  domestic: "https://api.minimaxi.com",
};

export function minimaxBaseUrl(input: MinimaxBaseUrlInput): string {
  if (input.baseUrl?.trim()) return input.baseUrl.trim().replace(/\/+$/, "");

  // `international` is the Provider declaration's visible default. The CLI stores only values the
  // operator supplied explicitly, so an omitted choice must resolve the same way as the rendered
  // form instead of turning that declared default into a runtime error.
  const service = input.service?.trim() || "international";
  const host = HOSTS[service];
  if (!host) {
    throw new Error(
      `This MiniMax account stored service ${JSON.stringify(service)}; expected `
        + `"international" or "domestic".`,
    );
  }
  return host;
}
