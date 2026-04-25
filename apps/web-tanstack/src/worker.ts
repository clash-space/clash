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
      // CF service binding rewrites the request URL's scheme to http, which
      // makes Better Auth refuse to issue __Secure- cookies. Tell api-cf the
      // real protocol + host via X-Forwarded-* (auth.ts has
      // trustedProxyHeaders: true so it'll honor them).
      const forwarded = new Request(request);
      forwarded.headers.set("X-Forwarded-Proto", url.protocol.replace(":", ""));
      forwarded.headers.set("X-Forwarded-Host", url.host);
      return env.API_CF.fetch(forwarded);
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
