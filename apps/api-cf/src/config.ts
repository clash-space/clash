export interface Env {
  /** Cloudflare Workers AI binding */
  AI: Ai;
  GOOGLE_API_KEY: string;
  GOOGLE_AI_STUDIO_BASE_URL?: string;
  /** Cloudflare AI Gateway token — used for OpenAI unified billing */
  CF_AIG_TOKEN: string;
  /** AI Gateway base URL for OpenAI, e.g. https://gateway.ai.cloudflare.com/v1/{account}/{gw}/openai */
  CF_AIG_OPENAI_URL: string;
  FAL_API_KEY?: string;
  /** AI Gateway base URL for fal, e.g. https://gateway.ai.cloudflare.com/v1/{account}/{gw}/fal */
  FAL_GATEWAY_URL?: string;
  KLING_ACCESS_KEY: string;
  KLING_SECRET_KEY: string;
  /** Kling API base URL — defaults to Beijing endpoint */
  KLING_API_URL?: string;
  R2_BUCKET: R2Bucket;
  R2_PUBLIC_URL: string;
  ENVIRONMENT: string;
  ROOM: DurableObjectNamespace;
  SUPERVISOR: DurableObjectNamespace;
  GENERATION_WORKFLOW: Workflow;
  RENDER_CONTAINER: DurableObjectNamespace;
  /** For local dev: direct URL to render-server (bypasses Container) */
  RENDER_SERVER_URL?: string;
  DB: D1Database;
  // Auth (ported from loro-sync-server)
  JWT_SECRET?: string;
  BETTER_AUTH_ORIGIN?: string;
  BETTER_AUTH_BASE_PATH?: string;
  WORKER_PUBLIC_URL?: string;
  /** AES-GCM key for encrypting/decrypting user variables (action secrets) */
  ACTION_SECRET_KEY?: string;
}
