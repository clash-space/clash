/**
 * Runs once per worker before tests. Applies all D1 migrations to the in-memory
 * database so the integration tests can hit a fully-built schema.
 */

import { beforeAll } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";

declare module "cloudflare:test" {
  interface ProvidedEnv {
    TEST_MIGRATIONS: any;
    DB: D1Database;
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
