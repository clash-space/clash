/**
 * Cloudflare Worker Environment bindings
 */
export interface Env {
  // Durable Object bindings
  LORO_ROOM: DurableObjectNamespace;

  // D1 Database binding
  DB: D1Database;

  // R2 bucket for generated assets
  ASSETS: R2Bucket;

  // R2 public URL prefix (e.g., 'https://pub-xxx.r2.dev')
  // DEPRECATED: Use WORKER_PUBLIC_URL instead for better performance
  R2_PUBLIC_URL?: string;
  
  // Worker's own public URL (e.g., 'https://loro-sync.your-domain.workers.dev')
  // Used for /assets/* endpoint to serve R2 files without rate limiting
  WORKER_PUBLIC_URL?: string;

  // Environment variables
  ENVIRONMENT?: string;
  JWT_SECRET?: string;
  BETTER_AUTH_ORIGIN?: string;
  BETTER_AUTH_BASE_PATH?: string;

  // api-cf Service Binding (production)
  API_CF?: Fetcher;

  // Fallback URL for local dev when Service Binding is unavailable
  BACKEND_API_URL?: string;

  // Loro Sync Server's own public URL for callbacks
  LORO_SYNC_URL?: string;
}

/**
 * Hono context variables for middleware
 */
export interface HonoVariables {
  requestId: string;
}

/**
 * JWT Payload for authentication
 */
export interface JWTPayload {
  sub: string;        // User ID
  projectId: string;  // Project ID
  iat?: number;       // Issued at
  exp?: number;       // Expiration
}

/**
 * Auth result from onAuth hook
 */
export interface AuthResult {
  userId: string;
  projectId: string;
}

/**
 * Snapshot data from D1
 */
export interface SnapshotData {
  project_id: string;
  snapshot: ArrayBuffer;
  version: number;
  updated_at: number;
}

