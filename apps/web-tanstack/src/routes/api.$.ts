/**
 * Catch-all API proxy. Any `/api/*` request lands here (TanStack Start
 * dispatches based on file route shape; the `$` segment captures the rest).
 *
 * For migration parity: routes that the OSS apps/web Worker handled
 * specially are mostly implemented in master-clash-api-hosted now (auth,
 * v1 routes, generation, assets, sync, agents). We forward everything
 * to the API_CF service binding by default. Auth (`/api/better-auth/*`)
 * gets its own file so it doesn't go through this proxy.
 *
 * Cloudflare bindings come from `cloudflare:workers` (only available
 * during the workerd runtime; type stub in src/cloudflare.d.ts).
 */
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET:    ({ request }) => proxy(request),
      POST:   ({ request }) => proxy(request),
      PUT:    ({ request }) => proxy(request),
      PATCH:  ({ request }) => proxy(request),
      DELETE: ({ request }) => proxy(request),
    },
  },
});

async function proxy(request: Request): Promise<Response> {
  const apiCf = (env as unknown as { API_CF?: { fetch: (req: Request) => Promise<Response> } }).API_CF;
  if (!apiCf) {
    return new Response("API_CF service binding missing", { status: 503 });
  }
  return apiCf.fetch(request);
}
