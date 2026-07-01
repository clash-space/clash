import { describe, expect, it } from "vitest";
import {
  getProviderCredentials,
  listProviderAccounts,
  upsertProviderAccount,
} from "./provider-accounts";

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
            if (sql.includes("WHERE user_id = ? AND provider_id = ? AND enabled = 1")) {
              const [userId, providerId, upstreamId] = args;
              return {
                results: db.rows
                  .filter((row) => row.user_id === userId && row.provider_id === providerId && row.enabled === 1)
                  .filter((row) => upstreamId === null || row.upstream_id === upstreamId)
                  .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000)),
              } as T;
            }
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

describe("provider accounts", () => {
  it("stores provider credentials encrypted and exposes only configured credential names", async () => {
    const db = new MemoryD1();

    await upsertProviderAccount(
      { DB: db as unknown as D1Database, ACTION_SECRET_KEY: "secret-key" },
      "user-1",
      {
        providerId: "volcengine",
        upstreamId: "volcengine",
        credentials: {
          apiKey: "ark-key",
          baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        },
      },
    );

    expect(db.rows[0].encrypted_credentials).not.toContain("ark-key");
    await expect(listProviderAccounts(db as unknown as D1Database, "user-1")).resolves.toEqual([
      expect.objectContaining({
        providerId: "volcengine",
        upstreamId: "volcengine",
        configuredCredentials: ["apiKey", "baseUrl"],
      }),
    ]);
    await expect(
      getProviderCredentials(
        { DB: db as unknown as D1Database, ACTION_SECRET_KEY: "secret-key" },
        "user-1",
        { providerId: "volcengine", upstreamId: "volcengine", requiredCredentials: ["apiKey"] },
      ),
    ).resolves.toMatchObject({
      apiKey: "ark-key",
      baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    });
  });

  it("supports multiple accounts for the same provider and selects the highest priority account", async () => {
    const db = new MemoryD1();
    const env = { DB: db as unknown as D1Database, ACTION_SECRET_KEY: "secret-key" };

    await upsertProviderAccount(env, "user-1", {
      id: "slow-key",
      providerId: "volcengine",
      upstreamId: "volcengine",
      priority: 10,
      credentials: { apiKey: "slow" },
    });
    await upsertProviderAccount(env, "user-1", {
      id: "fast-key",
      providerId: "volcengine",
      upstreamId: "volcengine",
      priority: 1,
      credentials: { apiKey: "fast" },
    });

    await expect(listProviderAccounts(db as unknown as D1Database, "user-1")).resolves.toHaveLength(2);
    await expect(
      getProviderCredentials(env, "user-1", {
        providerId: "volcengine",
        upstreamId: "volcengine",
        requiredCredentials: ["apiKey"],
      }),
    ).resolves.toMatchObject({ apiKey: "fast" });
  });

  it("stores and exposes per-account supported model filters", async () => {
    const db = new MemoryD1();

    await upsertProviderAccount(
      { DB: db as unknown as D1Database, ACTION_SECRET_KEY: "secret-key" },
      "user-1",
      {
        id: "mock-primary",
        providerId: "mock",
        upstreamId: "mock",
        supportedModelIds: ["nano-banana-2", "gpt-image-2"],
      },
    );

    expect(db.rows[0].supported_model_ids).toBe(JSON.stringify(["nano-banana-2", "gpt-image-2"]));
    await expect(listProviderAccounts(db as unknown as D1Database, "user-1")).resolves.toEqual([
      expect.objectContaining({
        id: "mock-primary",
        providerId: "mock",
        upstreamId: "mock",
        supportedModelIds: ["nano-banana-2", "gpt-image-2"],
      }),
    ]);

    await upsertProviderAccount(
      { DB: db as unknown as D1Database, ACTION_SECRET_KEY: "secret-key" },
      "user-1",
      {
        id: "mock-primary",
        providerId: "mock",
        upstreamId: "mock",
        supportedModelIds: [],
      },
    );

    expect(db.rows[0].supported_model_ids).toBeNull();
    await expect(listProviderAccounts(db as unknown as D1Database, "user-1")).resolves.toEqual([
      expect.not.objectContaining({ supportedModelIds: expect.any(Array) }),
    ]);
  });

  it("skips disabled higher-priority accounts when loading provider credentials", async () => {
    const db = new MemoryD1();
    const env = { DB: db as unknown as D1Database, ACTION_SECRET_KEY: "secret-key" };

    await upsertProviderAccount(env, "user-1", {
      id: "disabled-key",
      providerId: "replicate",
      upstreamId: "replicate",
      enabled: false,
      priority: 1,
      credentials: { apiKey: "disabled-token" },
    });
    await upsertProviderAccount(env, "user-1", {
      id: "enabled-key",
      providerId: "replicate",
      upstreamId: "replicate",
      enabled: true,
      priority: 20,
      credentials: { apiKey: "enabled-token" },
    });

    await expect(
      getProviderCredentials(env, "user-1", {
        providerId: "replicate",
        upstreamId: "replicate",
        requiredCredentials: ["apiKey"],
      }),
    ).resolves.toMatchObject({ apiKey: "enabled-token" });
  });

  it("skips higher-priority accounts missing the requested credential", async () => {
    const db = new MemoryD1();
    const env = { DB: db as unknown as D1Database, ACTION_SECRET_KEY: "secret-key" };

    await upsertProviderAccount(env, "user-1", {
      id: "base-url-only",
      providerId: "official",
      upstreamId: "openai",
      priority: 1,
      credentials: { baseUrl: "https://openai-compatible.test/v1" },
    });
    await upsertProviderAccount(env, "user-1", {
      id: "api-key",
      providerId: "official",
      upstreamId: "openai",
      priority: 20,
      credentials: { apiKey: "sk-working" },
    });

    await expect(
      getProviderCredentials(env, "user-1", {
        providerId: "official",
        upstreamId: "openai",
        requiredCredentials: ["apiKey"],
      }),
    ).resolves.toMatchObject({ apiKey: "sk-working" });
  });
});
