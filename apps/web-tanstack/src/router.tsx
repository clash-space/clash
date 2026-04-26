import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { routeTree } from "./routeTree.gen";
import { queryClient } from "./lib/query-client";

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    // Run as pure SPA — no SSR. Most pages are session-aware (Landing vs
    // HomePageClient, /projects list, etc.); SSR'ing them produced a logged-
    // out HTML that flipped on the client, hence the universal flash.
    defaultSsr: false,
    context: { queryClient },
  });
  return routerWithQueryClient(router, queryClient);
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
