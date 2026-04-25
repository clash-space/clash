/**
 * Type stub for the `cloudflare:workers` runtime module — the official
 * way to reach Worker bindings in TanStack Start server handlers without
 * threading them through every layer.
 */
declare module "cloudflare:workers" {
  interface Env {
    DB: D1Database;
    R2_BUCKET: R2Bucket;
    API_CF: { fetch: (req: Request) => Promise<Response> };
    BETTER_AUTH_BASE_PATH?: string;
    BETTER_AUTH_SECRET?: string;
    AUTH_GOOGLE_ID?: string;
    AUTH_GOOGLE_SECRET?: string;
  }
  export const env: Env;
}
