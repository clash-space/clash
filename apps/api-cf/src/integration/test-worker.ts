/**
 * Lean Worker entrypoint for integration tests.
 *
 * The full src/index.ts pulls in agents → loro-crdt → wasm, which the
 * vitest-pool-workers Vite layer can't resolve. For HTTP-route integration
 * tests we don't need any of that — just Hono + the routes that touch D1/R2.
 *
 * Re-exports the durable object / workflow stubs so the bindings declared in
 * wrangler.toml resolve. They're never instantiated in route tests.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";

import type { Env } from "../config";
import { assetsRoutes } from "../routes/v1/assets";

// Minimal Hono app for asset-route integration tests. Avoids importing the full
// router tree (which transitively pulls @clash/shared-types → loro-crdt → wasm,
// blocking pool-workers). Only the routes under exercise are mounted.
const app = new Hono<{ Bindings: Env }>();

app.use("/*", cors());
app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/v1/assets", assetsRoutes);

export default app;

// ─── Stub bindings declared in wrangler.toml ────────────────
// pool-workers needs these classes to exist; tests never instantiate them.
class StubDO {
  constructor(_state: unknown, _env: unknown) {}
  async fetch(_req: Request): Promise<Response> {
    return new Response("stub", { status: 501 });
  }
}
export const ProjectRoom = StubDO;
export const SupervisorAgent = StubDO;
export const RenderContainer = StubDO;
export const GenerationWorkflow = class {
  async run(): Promise<void> {}
};
