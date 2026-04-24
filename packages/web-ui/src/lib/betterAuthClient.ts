import { createAuthClient } from "better-auth/react";
import { cloudflareClient } from "better-auth-cloudflare/client";
import { emailOTPClient } from "better-auth/client/plugins";

/**
 * Lazy better-auth client. Created on first use in the browser.
 *
 * We defer construction because `createAuthClient` throws when given a
 * relative baseURL, and on the server we don't have `window.location.origin`.
 */
type AuthClient = ReturnType<
  typeof createAuthClient<{
    plugins: [
      ReturnType<typeof cloudflareClient>,
      ReturnType<typeof emailOTPClient>,
    ];
  }>
>;

let _client: AuthClient | null = null;

function getClient(): AuthClient {
  if (_client) return _client;
  if (typeof window === "undefined") {
    throw new Error(
      "betterAuthClient can't be used during server rendering — wrap in useEffect or an event handler.",
    );
  }
  _client = createAuthClient({
    baseURL: `${window.location.origin}/api/better-auth`,
    plugins: [cloudflareClient(), emailOTPClient()],
  }) as AuthClient;
  return _client;
}

const betterAuthClient = new Proxy(
  {},
  {
    get(_target, prop) {
      return (getClient() as any)[prop as any];
    },
  },
) as AuthClient;

export default betterAuthClient;
