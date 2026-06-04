import { createAuthClient } from "better-auth/react";
import { cloudflareClient } from "better-auth-cloudflare/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { runtimeApiUrl } from "./runtimeConfig";

type AuthClient = ReturnType<
  typeof createAuthClient<{
    plugins: [
      ReturnType<typeof cloudflareClient>,
      ReturnType<typeof emailOTPClient>,
    ];
  }>
>;

let _client: AuthClient | null = null;

function authBaseUrl(): string {
  const url = runtimeApiUrl("/api/better-auth");
  if (/^https?:/.test(url)) return url;
  return `${window.location.origin}${url}`;
}

function getClient(): AuthClient {
  if (_client) return _client;
  if (typeof window === "undefined") {
    return SSR_STUB as unknown as AuthClient;
  }
  _client = createAuthClient({
    baseURL: authBaseUrl(),
    plugins: [cloudflareClient(), emailOTPClient()],
  }) as AuthClient;
  return _client;
}

// On SSR there's no `window.location.origin`, so we can't construct a real
// client. Components that call `useSession()` during render get an empty
// session; the real client takes over after hydration. Mutating calls
// (signIn, signOut, …) only fire from event handlers, never during SSR,
// so we don't need to stub those — accessing them on SSR throws, which is
// what we want.
const SSR_STUB = {
  useSession: () => ({
    data: null,
    isPending: false,
    error: null,
    refetch: () => Promise.resolve(),
  }),
};

const betterAuthClient = new Proxy(
  {},
  {
    get(_target, prop) {
      return (getClient() as any)[prop as any];
    },
  },
) as AuthClient;

export default betterAuthClient;
