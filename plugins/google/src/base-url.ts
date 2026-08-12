/**
 * Which Google host to call, from what the account stored.
 *
 * The executor used to read `context.endpoint` and refuse without it. But `endpoint` is optional on
 * the SDK context and means "where this account points, when it is not the vendor's default" -- no
 * host fills it for an ordinary account, so a service account that had just successfully exchanged
 * its key for a token then failed with "Google executor needs the account's base url".
 *
 * The account does say which host, in the terms its auth method declares: `service` picks between
 * the two Google runs, and Agent Platform additionally needs `region`. Turning those into a URL is
 * API shape translation, which is this plugin's whole job. The host must not know that a field
 * called `service` names a Google deployment.
 */

export interface GoogleBaseUrlInput {
  service?: string;
  region?: string;
  /** Set when the account authenticates with a service account key, which is Agent Platform only. */
  hasServiceAccount?: boolean;
  /** A proxy in front of the vendor: the case `endpoint` exists for. */
  endpoint?: string;
}

const AI_STUDIO = "https://generativelanguage.googleapis.com/v1beta";

export function googleBaseUrl(input: GoogleBaseUrlInput): string {
  if (input.endpoint?.trim()) return input.endpoint.trim();

  // The service-account method forbids configuring `service`: it is only for Agent Platform, so
  // asking would be a question with one answer.
  const service = input.service ?? (input.hasServiceAccount ? "agent-platform" : undefined);

  if (service === "ai-studio") {
    // AI Studio is one global host. Its auth method does not offer `region`, and one arriving
    // anyway is stale storage rather than a different host.
    return AI_STUDIO;
  }

  if (service === "agent-platform") {
    const region = input.region?.trim();
    // Picking a default region would send the request somewhere the user did not choose, and both
    // quota and data residency are per-region.
    if (!region) throw new Error("This Agent Platform account has no region stored.");
    // `global` is a real Vertex region, spelled without a prefix. Interpolating it the usual way
    // yields `global-aiplatform.googleapis.com`, which does not resolve.
    return region === "global"
      ? "https://aiplatform.googleapis.com/v1"
      : `https://${region}-aiplatform.googleapis.com/v1`;
  }

  throw new Error(
    `This Google account stored no service; expected "ai-studio" or "agent-platform".`,
  );
}
