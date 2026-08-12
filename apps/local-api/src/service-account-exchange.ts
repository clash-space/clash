import { parseServiceAccountKey, serviceAccountToken } from "./service-account.js";

/**
 * Turning what an account stored into what a plugin can present.
 *
 * `serviceAccountToken` had existed since August, with eleven tests and a real 1408x768 PNG to its
 * name, and nothing ever called it. An account configured with the service-account method therefore
 * arrived at its plugin as a JSON key file, and clash.google reported "neither an accessToken nor
 * an apiKey stored" -- true, and describing the host having done nothing rather than the user
 * having configured nothing.
 *
 * Signing belongs on this side. The assertion is signed with the private key, and a plugin that did
 * it would need the key; this way the plugin only ever sees a bearer token with an hour to live.
 * It is also the same exchange for every vendor speaking RFC 7523, so a copy per plugin would be
 * the same code written repeatedly and got subtly wrong in different places.
 *
 * Everything the host does not understand passes through untouched. `region` means something to
 * Google and nothing here, and a host that dropped what it could not interpret would silently
 * unconfigure half of every account.
 */

export interface ServiceAccountExchange {
  (key: ReturnType<typeof parseServiceAccountKey>): Promise<{
    accessToken: string;
    expiresAt: string;
  }>;
}

export interface ResolveStoredCredentialsOptions {
  exchange?: ServiceAccountExchange;
  /** Tokens already obtained, so a generation does not sign a fresh assertion every time. */
  cache?: Map<string, { accessToken: string; expiresAt: number }>;
  cacheKey?: string;
  /** What the assertion is signed for. Google refuses one without a scope as `invalid_scope`. */
  scope?: string;
  /** Injected for tests; the default path uses the platform's. */
  fetchImpl?: typeof globalThis.fetch;
}

/** Refresh this long before expiry, so a token cannot lapse mid-request. */
const EXPIRY_MARGIN_MS = 60_000;

export async function resolveStoredCredentials(
  stored: Record<string, string>,
  options: ResolveStoredCredentialsOptions = {},
): Promise<Record<string, string>> {
  const { serviceAccountKey, ...rest } = stored;
  if (!serviceAccountKey?.trim()) return stored;

  const cacheKey = options.cacheKey ?? serviceAccountKey;
  // Everything the account resolves to, not just the token. The project id is part of every Agent
  // Platform URL and it is read out of the key, so a cached branch that returned only the token left
  // every lookup after the first one short of it -- and the failure surfaced as "This Google account
  // stored no service", about an account whose key names its project on line three.
  const projectId = parseServiceAccountKey(serviceAccountKey).projectId;
  const resolved = (accessToken: string) => ({
    ...rest,
    accessToken,
    ...(projectId ? { projectId } : {}),
  });

  const cached = options.cache?.get(cacheKey);
  if (cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return resolved(cached.accessToken);
  }

  const exchange = options.exchange
    // `serviceAccountToken` takes its options as a required parameter and reads `options.now` while
    // building the assertion. Calling it with the key alone type-checks -- the field has a default
    // inside -- and then dies at runtime as "Cannot read properties of undefined (reading 'now')",
    // which surfaces inside the plugin's broker round trip and reads as a broker fault.
    ?? (async (key) => await serviceAccountToken(key, {
      // The scope the assertion is signed for. Google refuses an assertion without one as
      // `invalid_scope`, which reads like a configuration problem in the key rather than an
      // omission on this side. `cloud-platform` is what Agent Platform requires and what the
      // 1408x768 PNG this path first produced was signed for.
      scope: options.scope ?? "https://www.googleapis.com/auth/cloud-platform",
      ...(options.fetchImpl ? { fetch: options.fetchImpl } : {}),
    }));
  // A failure here is not something to swallow: returning the stored values unchanged hands the
  // plugin a JSON key it cannot present, and the vendor's refusal is then reported as an
  // unconfigured account.
  const token = await exchange(parseServiceAccountKey(serviceAccountKey));

  options.cache?.set(cacheKey, {
    accessToken: token.accessToken,
    // The vendor states expiry either as a timestamp or as seconds-from-now, so this is normalised
    // rather than parsed blindly: `Date.parse` of a number yields NaN, and a NaN expiry compares
    // false against every clock, which would re-sign an assertion on every single lookup.
    expiresAt: typeof token.expiresAt === "number"
      ? token.expiresAt
      : Date.parse(String(token.expiresAt)),
  });

  // The key does not travel on. A plugin holding it could sign anything for as long as the key
  // lives, rather than for the hour the token lasts.
  return resolved(token.accessToken);
}
