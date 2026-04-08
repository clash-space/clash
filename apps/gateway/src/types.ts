export interface Env {
  // D1 Database for project ownership checks
  DB: D1Database;

  // Service Bindings
  API_CF: Fetcher;       // api-cf (ProjectRoom + Generation + assets)
  FRONTEND?: Fetcher;    // Next.js frontend (production)

  // URL-based proxies (local development)
  API_CF_URL?: string;        // api-cf fallback URL (e.g., http://localhost:8789)
  FRONTEND_URL?: string;      // Frontend (e.g., http://localhost:3000)

  // Better Auth config
  BETTER_AUTH_ORIGIN?: string;
  BETTER_AUTH_BASE_PATH?: string;
}
