/**
 * Cloudflare Worker Environment bindings
 */
export interface Env {
  // Durable Object bindings
  LORO_ROOM: DurableObjectNamespace;

  // D1 Database binding
  DB: D1Database;

  // Environment variables
  ENVIRONMENT?: string;
  JWT_SECRET?: string;
  BETTER_AUTH_ORIGIN?: string;
  BETTER_AUTH_BASE_PATH?: string;

  // api-cf Service Binding (production)
  API_CF?: Fetcher;

  // Fallback URL for local dev when Service Binding is unavailable
  BACKEND_API_URL?: string;

  // Legacy sync callbacks may still identify this worker's public origin.
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
  sub: string; // User ID
  projectId: string; // Project ID
  iat?: number; // Issued at
  exp?: number; // Expiration
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
