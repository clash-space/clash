import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../config";
import { modelProviderRoutes } from "./model-providers";

type Row = Record<string, any>;

class MemoryD1 {
  rows: Row[] = [];

  prepare(sql: string) {
    const db = this;
    return {
      bind(...args: unknown[]) {
        return {
          async first<T>() {
            if (sql.includes("SELECT id FROM provider_account")) {
              const [userId, providerId, upstreamId, region] = args;
              return (db.rows.find(
                (row) =>
                  row.user_id === userId &&
                  row.provider_id === providerId &&
                  (row.upstream_id ?? "") === upstreamId &&
                  (row.region ?? "") === region,
              ) ?? null) as T | null;
            }
            if (sql.includes("WHERE user_id = ? AND id = ?")) {
              const [userId, id] = args;
              return (db.rows.find((row) => row.user_id === userId && row.id === id) ?? null) as T | null;
            }
            return null;
          },
          async all<T>() {
            const [userId] = args;
            return {
              results: db.rows
                .filter((row) => row.user_id === userId)
                .sort((a, b) => `${a.provider_id}:${a.upstream_id ?? ""}`.localeCompare(`${b.provider_id}:${b.upstream_id ?? ""}`)),
            } as T;
          },
          async run() {
            if (sql.includes("UPDATE provider_account")) {
              const [
                providerId,
                upstreamId,
                region,
                label,
                enabled,
                priority,
                weight,
                encryptedCredentials,
                configuredCredentials,
                supportedModelIds,
                modelPriorities,
                updatedAt,
                userId,
                id,
              ] = args;
              const row = db.rows.find((candidate) => candidate.user_id === userId && candidate.id === id);
              if (row) {
                Object.assign(row, {
                  provider_id: providerId,
                  upstream_id: upstreamId,
                  region,
                  label,
                  enabled,
                  priority,
                  weight,
                  encrypted_credentials: encryptedCredentials,
                  configured_credentials: configuredCredentials,
                  supported_model_ids: supportedModelIds,
                  model_priorities: modelPriorities,
                  updated_at: updatedAt,
                });
              }
              return {};
            }
            const [
              id,
              userId,
              providerId,
              upstreamId,
              region,
              label,
              enabled,
              priority,
              weight,
              encryptedCredentials,
              configuredCredentials,
              supportedModelIds,
              modelPriorities,
              createdAt,
              updatedAt,
            ] = args;
            db.rows.push({
              id,
              user_id: userId,
              provider_id: providerId,
              upstream_id: upstreamId,
              region,
              label,
              enabled,
              priority,
              weight,
              encrypted_credentials: encryptedCredentials,
              configured_credentials: configuredCredentials,
              supported_model_ids: supportedModelIds,
              model_priorities: modelPriorities,
              created_at: createdAt,
              updated_at: updatedAt,
            });
            return {};
          },
        };
      },
    };
  }
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.route("/api/v1", modelProviderRoutes);
  return app;
}

describe("modelProviderRoutes", () => {
  it("checks a saved live provider config against a selected model", async () => {
    const app = makeApp();
    const env = {
      DB: new MemoryD1() as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    const save = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-primary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            credentials: { apiKey: "r8-api-cf-key" },
          },
        ],
      }),
    }, env);

    expect(save.status).toBe(200);

    const test = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: { id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", enabled: true },
        modelId: "nano-banana-2",
      }),
    }, env);

    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({
      ok: true,
      providerId: "replicate",
      upstreamId: "replicate",
      modelId: "nano-banana-2",
      message: "Replicate configuration is ready for Nano Banana 2.",
    });
  });
});
