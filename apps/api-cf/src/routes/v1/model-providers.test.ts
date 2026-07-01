import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../config";
import { modelProviderRoutes } from "./model-providers";

type Row = Record<string, any>;

class MemoryD1 {
  rows: Row[] = [];
  oauthRows: Row[] = [];

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
            if (sql.includes("FROM provider_oauth")) {
              return {
                results: db.oauthRows
                  .filter((row) => row.user_id === userId)
                  .sort((a, b) => `${a.provider_id}:${a.account_id ?? ""}`.localeCompare(`${b.provider_id}:${b.account_id ?? ""}`)),
              } as T;
            }
            return {
              results: db.rows
                .filter((row) => row.user_id === userId)
                .sort((a, b) => `${a.provider_id}:${a.upstream_id ?? ""}`.localeCompare(`${b.provider_id}:${b.upstream_id ?? ""}`)),
            } as T;
          },
          async run() {
            if (sql.includes("DELETE FROM provider_account")) {
              const [userId, id] = args;
              db.rows = db.rows.filter((row) => !(row.user_id === userId && row.id === id));
              return {};
            }
            if (sql.includes("DELETE FROM provider_oauth")) {
              const [userId, rawSecond, rawThird] = args;
              if (sql.includes("account_id = ?")) {
                db.oauthRows = db.oauthRows.filter((row) => !(row.user_id === userId && row.account_id === rawSecond));
              } else {
                db.oauthRows = db.oauthRows.filter((row) =>
                  !(row.user_id === userId && row.provider_id === rawSecond && (row.account_id ?? "") === rawThird)
                );
              }
              return {};
            }
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
  it("rejects provider account rows with unsupported provider ids", async () => {
    const app = makeApp();
    const db = new MemoryD1();
    const env = {
      DB: db as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    const response = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          {
            id: "not-real",
            providerId: "not-a-provider",
            upstreamId: "not-an-upstream",
            enabled: true,
          },
        ],
      }),
    }, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid providers" });
    expect(db.rows).toEqual([]);
  });

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

  it("does not test a disabled hosted provider config", async () => {
    const app = makeApp();
    const env = {
      DB: new MemoryD1() as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-disabled",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: false,
            credentials: { apiKey: "r8-api-cf-key" },
          },
        ],
      }),
    }, env);

    const test = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: { id: "replicate-disabled", providerId: "replicate", upstreamId: "replicate", enabled: false },
        modelId: "nano-banana-2",
      }),
    }, env);

    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({
      ok: false,
      providerId: "replicate",
      upstreamId: "replicate",
      modelId: "nano-banana-2",
      disabled: true,
      message: "Replicate is disabled for Nano Banana 2.",
    });
  });

  it("tests Google AI Studio models with only the API key credential", async () => {
    const app = makeApp();
    const env = {
      DB: new MemoryD1() as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          {
            id: "google-ai-studio",
            providerId: "official",
            upstreamId: "google",
            region: "global",
            enabled: true,
            credentials: { apiKey: "gemini-api-key" },
          },
        ],
      }),
    }, env);

    const test = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: {
          id: "google-ai-studio",
          providerId: "official",
          upstreamId: "google",
          region: "global",
          enabled: true,
        },
        modelId: "gemini-flash-image-2",
      }),
    }, env);

    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({
      ok: true,
      providerId: "official",
      upstreamId: "google",
      region: "global",
      modelId: "gemini-flash-image-2",
      message: "Google configuration is ready for Gemini Flash Image 2.",
    });
  });

  it("does not fake mock provider execution in the hosted API", async () => {
    const app = makeApp();
    const env = {
      DB: new MemoryD1() as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    const test = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true },
        modelId: "nano-banana-2",
      }),
    }, env);

    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({
      ok: false,
      providerId: "mock",
      upstreamId: "mock",
      modelId: "nano-banana-2",
      skipped: true,
      message: "Mock provider tests run through the local desktop runtime for Nano Banana 2.",
    });
  });

  it("rejects provider account model filters outside the provider support list", async () => {
    const app = makeApp();
    const db = new MemoryD1();
    const env = {
      DB: db as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    const response = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-text",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            supportedModelIds: ["claude-sonnet-4"],
            credentials: { apiKey: "r8-api-cf-key" },
          },
        ],
      }),
    }, env);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Invalid provider model filters",
      invalidProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          unsupportedModelIds: ["claude-sonnet-4"],
        },
      ],
    });
    expect(db.rows).toEqual([]);
  });

  it("deletes a saved provider account config", async () => {
    const app = makeApp();
    const db = new MemoryD1();
    const env = {
      DB: db as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;
    db.rows.push(
      {
        id: "replicate-primary",
        user_id: "user-1",
        provider_id: "replicate",
        upstream_id: "replicate",
        region: null,
        label: "Primary",
        enabled: 1,
        priority: 10,
        weight: null,
        encrypted_credentials: null,
        configured_credentials: JSON.stringify(["apiKey"]),
        supported_model_ids: null,
        model_priorities: null,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: "replicate-secondary",
        user_id: "user-1",
        provider_id: "replicate",
        upstream_id: "replicate",
        region: null,
        label: "Secondary",
        enabled: 1,
        priority: 20,
        weight: null,
        encrypted_credentials: null,
        configured_credentials: JSON.stringify(["apiKey"]),
        supported_model_ids: null,
        model_priorities: null,
        created_at: 1,
        updated_at: 1,
      },
    );

    const deleted = await app.request("/api/v1/model-providers/replicate-primary", {
      method: "DELETE",
      headers: { "x-user-id": "user-1" },
    }, env);

    expect(deleted.status).toBe(204);
    expect(db.rows.map((row) => row.id)).toEqual(["replicate-secondary"]);
  });

  it("checks OAuth-backed provider configs against account-scoped authorization", async () => {
    const app = makeApp();
    const db = new MemoryD1();
    const env = {
      DB: db as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    db.rows.push(
      {
        id: "jimeng-primary",
        user_id: "user-1",
        provider_id: "jimeng",
        upstream_id: "jimeng",
        region: null,
        label: "Primary Dreamina",
        enabled: 1,
        priority: 10,
        weight: null,
        encrypted_credentials: null,
        configured_credentials: null,
        supported_model_ids: null,
        model_priorities: null,
        created_at: 1,
        updated_at: 1,
      },
      {
        id: "jimeng-secondary",
        user_id: "user-1",
        provider_id: "jimeng",
        upstream_id: "jimeng",
        region: null,
        label: "Secondary Dreamina",
        enabled: 1,
        priority: 20,
        weight: null,
        encrypted_credentials: null,
        configured_credentials: null,
        supported_model_ids: null,
        model_priorities: null,
        created_at: 1,
        updated_at: 1,
      },
    );
    db.oauthRows.push({
      id: "oauth-primary",
      user_id: "user-1",
      provider_id: "dreamina",
      account_id: "jimeng-primary",
      status: "authorized",
      account_label: "Primary Dreamina",
      verification_uri: null,
      user_code: null,
      device_code: null,
      interval_seconds: null,
      expires_at: null,
      error: null,
      has_tokens: 1,
      encrypted_tokens: "encrypted-secret-payload",
      created_at: 1,
      updated_at: 1,
    });

    const oauth = await app.request("/api/v1/provider-oauth", {
      headers: { "x-user-id": "user-1" },
    }, env);
    expect(oauth.status).toBe(200);
    expect(await oauth.json()).toEqual({
      providers: [
        {
          providerId: "dreamina",
          accountId: "jimeng-primary",
          status: "authorized",
          accountLabel: "Primary Dreamina",
          hasAccessToken: true,
        },
      ],
    });

    const providers = await app.request("/api/v1/model-providers", {
      headers: { "x-user-id": "user-1" },
    }, env);
    expect(providers.status).toBe(200);
    expect(await providers.json()).toEqual({
      providers: [
        expect.objectContaining({
          id: "jimeng-primary",
          providerId: "jimeng",
          availableOAuth: ["dreamina"],
        }),
        expect.objectContaining({
          id: "jimeng-secondary",
          providerId: "jimeng",
          availableOAuth: [],
        }),
      ],
    });

    const primary = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: { id: "jimeng-primary", providerId: "jimeng", upstreamId: "jimeng", enabled: true },
        modelId: "seedance-2-text",
      }),
    }, env);
    expect(primary.status).toBe(200);
    expect(await primary.json()).toMatchObject({
      ok: true,
      providerId: "jimeng",
      upstreamId: "jimeng",
      modelId: "seedance-2-text",
      message: "Dreamina configuration is ready for Seedance 2.0 (Text).",
    });

    const secondary = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: { id: "jimeng-secondary", providerId: "jimeng", upstreamId: "jimeng", enabled: true },
        modelId: "seedance-2-text",
      }),
    }, env);
    expect(secondary.status).toBe(200);
    expect(await secondary.json()).toEqual({
      ok: false,
      providerId: "jimeng",
      upstreamId: "jimeng",
      modelId: "seedance-2-text",
      missingOAuth: ["dreamina"],
      message: "Dreamina needs authorization before testing Seedance 2.0 (Text).",
    });

    const catalog = await app.request("/api/v1/models/catalog", {
      headers: { "x-user-id": "user-1" },
    }, env);
    expect(catalog.status).toBe(200);
    const catalogJson = (await catalog.json()) as {
      models: Array<{
        model: { id: string };
        selectedRoute?: { providerId?: string; upstreamId?: string } | null;
      }>;
    };
    expect(catalogJson.models.find((entry) => entry.model.id === "seedance-2-text")).toMatchObject({
      selectedRoute: expect.objectContaining({
        providerId: "jimeng",
        upstreamId: "jimeng",
      }),
    });
  });
});
