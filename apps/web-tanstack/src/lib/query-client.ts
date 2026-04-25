import { QueryClient } from "@tanstack/react-query";

/**
 * Module-singleton QueryClient. Shared by `getRouter()` and the
 * `<QueryClientProvider>` we mount in `__root.tsx`.
 *
 * This means the SAME QueryClient is reused across SSR requests in a
 * single Worker isolate — fine for caching public data (plans / packs),
 * but session/balance queries are gated by `enabled: typeof window !== "undefined"`
 * so they never run server-side and never leak between users.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});
