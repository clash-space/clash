/**
 * Single source of truth for the session query. Disabled on the server
 * because Better Auth's client doesn't have request cookies during SSR
 * (the `http://localhost/api/better-auth` placeholder baseURL would just
 * fail to resolve in the Worker runtime). On hydration the query runs
 * with the real origin and resolves against the real cookie.
 */
import { useQuery } from "@tanstack/react-query";
import { authClient } from "./auth-client";

export const sessionQueryKey = ["auth", "session"] as const;

export function useSession() {
  return useQuery({
    queryKey: sessionQueryKey,
    queryFn: async () => (await authClient.getSession()).data ?? null,
    staleTime: 30_000,
    // Skip SSR — only run after the browser hydrates.
    enabled: typeof window !== "undefined",
  });
}
