import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { Env } from "../../config";
import { modelProviderRoutes } from "./model-providers";

type Row = Record<string, any>;

class MemoryD1 {
  rows: Row[] = [];
  oauthRows: Row[] = [];
  modelRows: Row[] = [];
  bindingRows: Row[] = [];

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
            if (sql.includes("FROM model_card_provider_binding")) {
              return {
                results: db.bindingRows
                  .filter((row) => row.user_id === userId)
                  .sort((a, b) => `${a.model_id}:${a.position}`.localeCompare(`${b.model_id}:${b.position}`)),
              } as T;
            }
            if (sql.includes("FROM model_card_config")) {
              return {
                results: db.modelRows
                  .filter((row) => row.user_id === userId)
                  .sort((a, b) => a.model_id.localeCompare(b.model_id)),
              } as T;
            }
            return {
              results: db.rows
                .filter((row) => row.user_id === userId)
                .sort((a, b) => `${a.provider_id}:${a.upstream_id ?? ""}`.localeCompare(`${b.provider_id}:${b.upstream_id ?? ""}`)),
            } as T;
          },
          async run() {
            if (sql.includes("DELETE FROM model_card_provider_binding")) {
              const [userId, second] = args;
              db.bindingRows = db.bindingRows.filter((row) => !(
                row.user_id === userId &&
                (
                  sql.includes("provider_account_id = ?")
                    ? row.provider_account_id === second
                    : row.model_id === second
                )
              ));
              return {};
            }
            if (sql.includes("DELETE FROM model_card_config")) {
              const [userId, modelId] = args;
              db.modelRows = db.modelRows.filter(
                (row) => !(row.user_id === userId && row.model_id === modelId),
              );
              return {};
            }
            if (sql.includes("INSERT INTO model_card_config")) {
              const [
                userId,
                modelId,
                custom,
                kind,
                name,
                description,
                promptGuidance,
                createdAt,
                updatedAt,
              ] = args;
              const previous = db.modelRows.find(
                (row) => row.user_id === userId && row.model_id === modelId,
              );
              const values = {
                user_id: userId,
                model_id: modelId,
                custom,
                kind,
                name,
                description,
                prompt_guidance: promptGuidance,
                created_at: previous?.created_at ?? createdAt,
                updated_at: updatedAt,
              };
              if (previous) Object.assign(previous, values);
              else db.modelRows.push(values);
              return {};
            }
            if (sql.includes("INSERT INTO model_card_provider_binding")) {
              const [userId, modelId, providerAccountId, upstreamModel, position] = args;
              db.bindingRows.push({
                user_id: userId,
                model_id: modelId,
                provider_account_id: providerAccountId,
                upstream_model: upstreamModel,
                position,
              });
              return {};
            }
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
                apiShape,
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
                  api_shape: apiShape,
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
              apiShape,
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
              api_shape: apiShape,
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
  it("persists a hosted custom text model card mounted to a compatible provider account", async () => {
    const app = makeApp();
    const db = new MemoryD1();
    const env = {
      DB: db as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    const provider = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          {
            id: "hosted-custom-openai",
            providerId: "custom",
            upstreamId: "openai",
            apiShape: "openai-compatible",
            label: "Hosted proxy",
            enabled: true,
            credentials: {
              apiKey: "sk-hosted",
              baseUrl: "https://hosted-proxy.example/v1",
            },
          },
        ],
      }),
    }, env);
    expect(provider.status).toBe(200);
    expect(await provider.json()).toMatchObject({
      providers: [
        {
          id: "hosted-custom-openai",
          apiShape: "openai-compatible",
        },
      ],
    });

    const saved = await app.request("/api/v1/model-cards/hosted-editorial", {
      method: "PUT",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        custom: true,
        name: "Hosted Editorial",
        kind: "text",
        description: "A hosted custom model.",
        promptGuidance: "Describe the audience before the deliverable.",
        providerBindings: [
          {
            providerAccountId: "hosted-custom-openai",
            upstreamModel: "hosted/editorial-v1",
          },
        ],
      }),
    }, env);
    expect(saved.status).toBe(200);

    const catalog = await app.request("/api/v1/models/catalog", {
      headers: { "x-user-id": "user-1" },
    }, env);
    expect(catalog.status).toBe(200);
    const json = await catalog.json() as {
      models: Array<{
        model: { id: string; promptGuidance?: string; custom?: boolean };
        selectedRoute?: { accountId?: string; upstreamModel?: string } | null;
      }>;
    };
    expect(json.models.find((entry) => entry.model.id === "hosted-editorial")).toMatchObject({
      model: {
        id: "hosted-editorial",
        custom: true,
        promptGuidance: "Describe the audience before the deliverable.",
      },
      selectedRoute: {
        accountId: "hosted-custom-openai",
        upstreamModel: "hosted/editorial-v1",
      },
    });

    const tested = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: {
          id: "hosted-custom-openai",
          providerId: "custom",
          upstreamId: "openai",
          apiShape: "openai-compatible",
          enabled: true,
        },
        modelId: "hosted-editorial",
      }),
    }, env);
    expect(tested.status).toBe(200);
    expect(await tested.json()).toMatchObject({
      ok: true,
      providerId: "custom",
      modelId: "hosted-editorial",
    });
  });

  it("persists plugin-owned provider account ids", async () => {
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
            id: "acme-primary",
            providerId: "acme-provider",
            upstreamId: "acme-upstream",
            enabled: true,
          },
        ],
      }),
    }, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      providers: [{
        id: "acme-primary",
        providerId: "acme-provider",
        upstreamId: "acme-upstream",
        enabled: true,
      }],
    });
    expect(db.rows).toHaveLength(1);
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
            upstreamId: "google-ai-studio",
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
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
        },
        modelId: "gemini-3.1-flash-image",
      }),
    }, env);

    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({
      ok: true,
      providerId: "official",
      upstreamId: "google-ai-studio",
      region: "global",
      modelId: "nano-banana-2",
      message: "Google AI Studio configuration is ready for Nano Banana 2.",
    });
  });

  it("tests Gemini Omni with a credential accepted by its declared Google route", async () => {
    const app = makeApp();
    const env = {
      DB: new MemoryD1() as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    const incomplete = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: {
          id: "google-omni",
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
        },
        modelId: "gemini-omni-flash",
      }),
    }, env);
    const incompleteBody = await incomplete.json() as { ok: boolean; missingCredentials: string[] };
    expect(incompleteBody.ok).toBe(false);
    expect(incompleteBody.missingCredentials.length).toBeGreaterThan(0);

    const ready = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: {
          id: "google-omni",
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
          credentials: { apiKey: "gemini-api-key" },
        },
        modelId: "gemini-omni-flash",
      }),
    }, env);
    expect(await ready.json()).toMatchObject({
      ok: true,
      modelId: "gemini-omni-flash",
    });
  });

  it("tests the unified Google provider with only service account credentials", async () => {
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
            id: "google-primary",
            providerId: "official",
            upstreamId: "google-ai-studio",
            region: "global",
            enabled: true,
            credentials: { serviceAccountKey: "{\"project\":\"demo\",\"clientEmail\":\"svc@example.com\",\"privateKey\":\"key\"}" },
          },
        ],
      }),
    }, env);

    const test = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        provider: {
          id: "google-primary",
          providerId: "official",
          upstreamId: "google-ai-studio",
          region: "global",
          enabled: true,
        },
        modelId: "veo-3.1",
      }),
    }, env);

    expect(test.status).toBe(200);
    expect(await test.json()).toEqual({
      ok: true,
      providerId: "official",
      upstreamId: "google-ai-studio",
      region: "global",
      modelId: "veo-3.1",
      message: "Google AI Studio configuration is ready for Veo 3.1.",
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

  it("keeps mock provider routes out of the hosted model catalog", async () => {
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
            id: "mock-primary",
            providerId: "mock",
            upstreamId: "mock",
            enabled: true,
          },
        ],
      }),
    }, env);

    const catalog = await app.request("/api/v1/models/catalog", {
      headers: { "x-user-id": "user-1" },
    }, env);

    expect(catalog.status).toBe(200);
    const catalogJson = (await catalog.json()) as {
      models: Array<{
        model: { id: string };
        tier: string;
        selectedRoute?: { providerId?: string; upstreamId?: string } | null;
      }>;
    };
    const nanoBanana = catalogJson.models.find((entry) => entry.model.id === "nano-banana-2");
    expect(nanoBanana?.selectedRoute?.providerId).not.toBe("mock");
    expect(nanoBanana?.selectedRoute?.upstreamId).not.toBe("mock");
  });

  it("appends a second provider key without replacing an existing id-less account", async () => {
    const app = makeApp();
    const env = {
      DB: new MemoryD1() as unknown as D1Database,
      ACTION_SECRET_KEY: "secret-key",
    } as Env;

    const firstSave = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          {
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            credentials: { apiKey: "r8-primary" },
          },
        ],
      }),
    }, env);
    expect(firstSave.status).toBe(200);
    const firstJson = (await firstSave.json()) as { providers: Array<Record<string, unknown>> };
    expect(firstJson.providers).toHaveLength(1);

    const secondSave = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-user-id": "user-1" },
      body: JSON.stringify({
        providers: [
          firstJson.providers[0],
          {
            id: "replicate-secondary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            credentials: { apiKey: "r8-secondary" },
          },
        ],
      }),
    }, env);

    expect(secondSave.status).toBe(200);
    const secondJson = (await secondSave.json()) as { providers: Array<Record<string, unknown>> };
    expect(secondJson.providers).toHaveLength(2);
    expect(secondJson.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "replicate",
        upstreamId: "replicate",
        configuredCredentials: ["apiKey"],
      }),
      expect.objectContaining({
        id: "replicate-secondary",
        providerId: "replicate",
        upstreamId: "replicate",
        configuredCredentials: ["apiKey"],
      }),
    ]));
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

});
