import startEntry from "@tanstack/react-start/server-entry";

const PROXY_PREFIXES = [
  "/api/",
  "/sync/",
  "/upload",
  "/assets/",
  "/thumbnails/",
  "/agents/",
];

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (PROXY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      if (!env.API_CF) {
        return new Response("api-cf service binding missing", { status: 503 });
      }
      return env.API_CF.fetch(request);
    }
    return (startEntry as { fetch: ExportedHandlerFetchHandler<Env> }).fetch(
      request,
      env,
      ctx,
    );
  },
} satisfies ExportedHandler<Env>;

interface Env {
  API_CF?: { fetch: (req: Request) => Promise<Response> };
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}
