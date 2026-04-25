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
    const isWebSocket = request.headers.get("upgrade")?.toLowerCase() === "websocket";

    // Force HTTPS — browser-set Secure cookies (Better Auth session) won't
    // store on http://, and CF custom domain doesn't auto-upgrade.
    // Skip for WS upgrades: a 301 makes the browser drop the upgrade.
    if (url.protocol === "http:" && !isWebSocket) {
      url.protocol = "https:";
      return Response.redirect(url.toString(), 301);
    }
    if (PROXY_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      if (!env.API_CF) {
        return new Response("api-cf service binding missing", { status: 503 });
      }
      if (isWebSocket) {
        // Pass the WS upgrade through unchanged — protocol rewriting can
        // strip the upgrade headers some runtimes rely on.
        return env.API_CF.fetch(request);
      }
      // CF service binding rewrites the request URL's scheme to http on the
      // way in. Force https:// in the inner request URL so Better Auth's
      // session cookie keeps its __Secure- prefix and the Secure flag.
      url.protocol = "https:";
      const forwarded = new Request(url.toString(), request);
      forwarded.headers.set("X-Forwarded-Proto", "https");
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
