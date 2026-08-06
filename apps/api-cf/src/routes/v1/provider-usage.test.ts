import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../config";
import { providerUsageRoutes } from "./provider-usage";

describe("provider usage routes", () => {
  it("requires an authenticated user and lists only that user's audit events", async () => {
    const db = {
      prepare() {
        return {
          bind(userId: string) {
            return {
              async all() {
                return { results: [{
                  id: "task-1:pika:req-1:completed",
                  user_id: userId,
                  provider_id: "pika",
                  provider_account_id: null,
                  model_id: "nano-banana-2",
                  operation: "google/gemini-3.1-flash-image/text-to-image",
                  task_id: "task-1",
                  project_id: null,
                  node_id: null,
                  actor_type: "user",
                  actor_user_id: userId,
                  actor_agent_id: null,
                  provider_request_id: "req-1",
                  idempotency_key: "task-1",
                  status: "completed",
                  estimated_cost_micro_usd: 25_000,
                  estimate_complete: 1,
                  currency: "USD",
                  pricing_source: "pika-catalog",
                  billing_basis: "{\"resolution\":\"2K\"}",
                  error_code: null,
                  error_message: null,
                  occurred_at: Date.parse("2026-08-05T10:00:00.000Z"),
                }] };
              },
            };
          },
        };
      },
    };
    const app = new Hono<{ Bindings: Env }>();
    app.route("/api/v1", providerUsageRoutes);

    expect((await app.request("/api/v1/provider-usage", {}, { DB: db } as unknown as Env)).status).toBe(401);
    const response = await app.request("/api/v1/provider-usage?limit=10", {
      headers: { "x-user-id": "user-1" },
    }, { DB: db } as unknown as Env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      events: [expect.objectContaining({
        userId: "user-1",
        status: "completed",
        estimatedCostMicroUsd: 25_000,
      })],
    });
  });
});
