import { mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { LoroDoc } from "loro-crdt";
import {
  assetReadToken,
  assetRefReadToken,
  Canvas,
  canvasBatchDeleteReadToken,
  canvasEdgeReadToken,
  canvasEdgesReadToken,
  canvasNodeReadToken,
  MODEL_CARDS,
  type Asset,
} from "@clash/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalApiApp, type LocalAcpAgentServersConfig } from "./app";
import { createLocalAudioConfigStore } from "./audio-config";
import { createMockFalQueueService } from "./fal-mock";
import { FileReplicaStore } from "./loro/file-replica-store";
import { createLocalSyncConfigStore } from "./sync-config";
import { createLocalProviderStore } from "./local-provider-store";

let dataDir = "";

function openSqlite() {
  const require = createRequire(import.meta.url);
  const { DatabaseSync } = require("node:sqlite") as {
    DatabaseSync: new (path: string) => {
      prepare(sql: string): {
        run(...params: unknown[]): unknown;
        get(...params: unknown[]): Record<string, unknown> | undefined;
        all(...params: unknown[]): Array<Record<string, unknown>>;
      };
      close(): void;
    };
  };
  return new DatabaseSync(join(dataDir, "local.sqlite"));
}

function ageDeletedProjectForPurge(projectId: string): void {
  const sqlite = openSqlite();
  const agedDeletedAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
  try {
    sqlite.prepare("UPDATE project SET deleted_at = ?, updated_at = ? WHERE id = ?")
      .run(agedDeletedAt, agedDeletedAt, projectId);
  } finally {
    sqlite.close();
  }
}

function baseReadToken(readToken: string): string {
  return readToken.split(":receipt:")[0];
}

function projectionContentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function providerModelTestMutation(providerId: string, modelId: string) {
  return {
    operation: "provider_model_test",
    entity: { kind: "provider-test", id: `${providerId}:${modelId}` },
    accepted: true,
    resultEntityId: `${providerId}:${modelId}`,
  };
}

const PROJECT_RECEIPT_READ_TOKEN_RE = /^project-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const NODE_RECEIPT_READ_TOKEN_RE = /^node-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const CANVAS_BATCH_DELETE_RECEIPT_READ_TOKEN_RE = /^canvas-batch-delete-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const EDGE_RECEIPT_READ_TOKEN_RE = /^edge-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const EDGES_RECEIPT_READ_TOKEN_RE = /^edges-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const ASSET_RECEIPT_READ_TOKEN_RE = /^asset-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const ASSET_REF_RECEIPT_READ_TOKEN_RE = /^asset-ref-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const SESSION_RECEIPT_READ_TOKEN_RE = /^session-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE = /^local-config-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const PROVIDER_ACCOUNT_RECEIPT_READ_TOKEN_RE = /^provider-account-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE = /^provider-accounts-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE = /^provider-oauth-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const ASSET_GC_RECEIPT_READ_TOKEN_RE = /^asset-gc-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const DEFAULT_SYNC_CAPABILITIES = {
  canvas: false,
  asset_metadata: false,
  revision_content: false,
};

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-"));
});

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it("lists provider usage audit events for the local user", async () => {
  const store = createLocalProviderStore(dataDir);
  await store.appendProviderUsageEvent({
    id: "task-usage:pika:req-usage:completed",
    userId: "local-user",
    providerId: "pika",
    modelId: "nano-banana-2",
    operation: "google/gemini-3.1-flash-image/text-to-image",
    taskId: "task-usage",
    providerRequestId: "req-usage",
    idempotencyKey: "task-usage",
    status: "completed",
    estimatedCostMicroUsd: 25_000,
    estimateComplete: true,
    currency: "USD",
    pricingSource: "pika-catalog",
    billingBasis: { resolution: "2K", num_images: 1 },
    occurredAt: "2026-08-05T10:00:00.000Z",
  });

  const response = await createLocalApiApp({ dataDir, userId: "local-user" })
    .request("/api/v1/provider-usage?limit=10");
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({
    events: [expect.objectContaining({
      id: "task-usage:pika:req-usage:completed",
      estimatedCostMicroUsd: 25_000,
      status: "completed",
    })],
  });
});

let testPrivateKeyPemPromise: Promise<string> | undefined;

function createTestPrivateKeyPem(): Promise<string> {
  testPrivateKeyPemPromise ??= (async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 1024,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
    const body = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
    return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
  })();
  return testPrivateKeyPemPromise;
}

async function expectSingleMutationAudit(
  app: ReturnType<typeof createLocalApiApp>,
  options: {
    operation: string;
    entityId: string;
    entityKind: string;
    reason: string;
    actorClientType?: string | null;
  },
) {
  const audit = await app.request(
    `/api/v1/mutation-audit?operation=${encodeURIComponent(options.operation)}&entityId=${encodeURIComponent(options.entityId)}`,
  );
  expect(audit.status).toBe(200);
  const auditJson = await audit.json() as { records: Array<any> };
  expect(auditJson.records).toHaveLength(1);
  expect(auditJson.records[0]).toMatchObject({
    operation: options.operation,
    entity: { kind: options.entityKind, id: options.entityId },
    actorClientType: options.actorClientType ?? null,
    accepted: true,
    reason: options.reason,
    resultEntityId: options.entityId,
  });
  expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
  expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
  expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();
}

describe("local API app", () => {
  it("reports local health and a synthetic local session", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const health = await app.request("/health");
    expect(await health.json()).toEqual({
      ok: true,
      mode: "local",
      runtime: {
        mode: "local",
        capabilities: {
          assets: { storage: "local", signing: "unsigned", upload: "local" },
          workflows: { runner: "local-node", mediaPostprocess: "disabled" },
          loro: { persistence: "local", sync: "local-websocket" },
          auth: { mode: "local-user" },
        },
      },
    });

    const session = await app.request("/api/better-auth/get-session");
    expect(await session.json()).toEqual({
      user: { id: "local-user", name: "Local User", email: "local@clash.local" },
    });

    const me = await app.request("/api/v1/me", {
      headers: { authorization: "Bearer local-test-key" },
    });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ id: "local-user" });
  });

  it("accepts plugin broker calls only from the 0600 discovery capability", async () => {
    const executablePluginBroker = vi.fn().mockResolvedValue({ handle: "clash-secret://opaque" });
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      pluginBrokerToken: "b".repeat(64),
      executablePluginBroker,
    });
    const invocation = {
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "acme.media",
        version: "1.2.3",
        exportId: "render",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "action",
      },
      input: { values: {}, references: [] },
      actor: { kind: "user", id: "local-user" },
    };
    const manifest = {
      apiVersion: "clash.plugin/v1",
      id: "acme.media",
      version: "1.2.3",
      name: "Acme Media",
      runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs" },
      exports: { cards: [], functions: [{ id: "render", kind: "action", handler: "render" }] },
      permissions: {
        network: { domains: [] },
        secrets: ["provider:fal"],
        assets: [],
        filesystem: { read: [], write: [] },
        externalWrites: false,
      },
    };
    const request = {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-1",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:fal" },
    };
    const unauthorized = await app.request("/api/v1/local/plugin-broker", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request, manifest, invocation }),
    });
    expect(unauthorized.status).toBe(401);

    const response = await app.request("/api/v1/local/plugin-broker", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-local-plugin-broker-token": "b".repeat(64),
      },
      body: JSON.stringify({ request, manifest, invocation }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      protocol: "clash.plugin.broker-response/v1",
      requestId: "request-1",
      status: "ok",
      result: { handle: "clash-secret://opaque" },
    });
    expect(executablePluginBroker).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: "request-1" }),
      expect.objectContaining({
        manifest: expect.objectContaining({ id: "acme.media" }),
        invocation: expect.objectContaining({ invocationId: "invocation-1" }),
      }),
    );
  });

  it("persists local cloud sync configuration without exposing the token", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });

    const initial = await app.request("/api/v1/local/sync");
    expect(await initial.json()).toMatchObject({
      mode: "local-only",
      remote_loro: {
        enabled: false,
        url: null,
        has_token: false,
        source: "none",
      },
      capabilities: DEFAULT_SYNC_CAPABILITIES,
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
    });

    const updated = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: " https://cloud.example/ ",
        remote_loro_token: "secret-token",
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      mode: "cloud-sync",
      remote_loro: {
        enabled: true,
        url: "https://cloud.example",
        has_token: true,
        source: "config",
      },
      capabilities: DEFAULT_SYNC_CAPABILITIES,
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      mutation: {
        operation: "local_sync_config_update",
        entity: { kind: "local-config", id: "sync" },
        accepted: true,
        resultEntityId: "sync",
      },
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });
    const persisted = await reopened.request("/api/v1/local/sync");
    expect(await persisted.json()).toEqual({
      mode: "cloud-sync",
      remote_loro: {
        enabled: true,
        url: "https://cloud.example",
        has_token: true,
        source: "config",
      },
      capabilities: DEFAULT_SYNC_CAPABILITIES,
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
    });
  });

  it("rejects cloud sync configuration without a remote Loro URL", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });

    const res = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "cloud-sync" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "remote_loro_url is required for cloud-sync mode",
      mutation: {
        operation: "local_sync_config_update",
        entity: { kind: "local-config", id: "sync" },
        accepted: false,
        error: "remote_loro_url is required for cloud-sync mode",
      },
    });
  });

  it("requires a receipt-bearing sync config read token before agent cloud-sync changes", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });

    const initial = await app.request("/api/v1/local/sync");
    const initialJson = await initial.json() as { readToken?: string };
    expect(initialJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const missing = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: "https://cloud.example",
      }),
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("Missing local sync config update read proof"),
      mutation: {
        operation: "local_sync_config_update",
        entity: { kind: "local-config", id: "sync" },
        accepted: false,
        error: expect.stringContaining("Missing local sync config update read proof"),
      },
    });

    const bareReadToken = baseReadToken(initialJson.readToken!);
    const bare = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": bareReadToken,
      },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: "https://cloud.example",
      }),
    });
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({
      error: expect.stringContaining("Missing local sync config update read receipt"),
      mutation: {
        operation: "local_sync_config_update",
        entity: { kind: "local-config", id: "sync" },
        expectedReadToken: bareReadToken,
        beforeReadToken: bareReadToken,
        accepted: false,
        error: expect.stringContaining("Missing local sync config update read receipt"),
      },
    });

    const userUpdate = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: "https://first.example",
      }),
    });
    expect(userUpdate.status).toBe(200);

    const stale = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: "https://second.example",
      }),
    });
    expect(stale.status).toBe(409);
    const staleJson = await stale.json() as { error: string; mutation: { beforeReadToken?: string; expectedReadToken?: string } };
    expect(staleJson.error).toContain("Stale local sync config update rejected");
    expect(staleJson.mutation.expectedReadToken).toBe(initialJson.readToken);
    expect(staleJson.mutation.beforeReadToken).toMatch(/^local-config-v1:[a-f0-9]{16}$/);
    expect(staleJson.mutation.beforeReadToken).not.toBe(baseReadToken(initialJson.readToken!));

    const refreshed = await app.request("/api/v1/local/sync");
    const refreshedJson = await refreshed.json() as { readToken?: string };
    expect(refreshedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const accepted = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": refreshedJson.readToken!,
      },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: "https://second.example",
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as any;
    expect(acceptedJson).toMatchObject({
      mode: "cloud-sync",
      remote_loro: {
        enabled: true,
        url: "https://second.example",
      },
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      mutation: {
        operation: "local_sync_config_update",
        entity: { kind: "local-config", id: "sync" },
        expectedReadToken: refreshedJson.readToken,
        beforeReadToken: baseReadToken(refreshedJson.readToken!),
        accepted: true,
        resultEntityId: "sync",
        afterReadToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      },
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=local_sync_config_update&entityId=sync");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(2);
    const humanAuditRecord = auditJson.records.find((record) => record.actorClientType == null);
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(humanAuditRecord).toMatchObject({
      operation: "local_sync_config_update",
      entity: { kind: "local-config", id: "sync" },
      actorClientType: null,
      accepted: true,
      reason: "local sync config update",
      resultEntityId: "sync",
    });
    expect(agentAuditRecord).toMatchObject({
      operation: "local_sync_config_update",
      entity: { kind: "local-config", id: "sync" },
      actorClientType: "agent",
      accepted: true,
      reason: "local sync config update",
      resultEntityId: "sync",
    });
    for (const record of auditJson.records) {
      expect(JSON.stringify(record.mutation ?? {})).not.toContain("receipt");
      expect(record.mutation.expectedReadToken).toBeUndefined();
      expect(record.mutation.beforeReadToken).toBeUndefined();
      expect(record.mutation.afterReadToken).toBeUndefined();
    }
  });

  it("persists built-in local audio ASR configuration without requiring an endpoint", async () => {
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: false, message: "FunASR is not installed" }),
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const initial = await app.request("/api/v1/local/audio");
    expect(await initial.json()).toMatchObject({
      asr: expect.objectContaining({
        enabled: false,
        provider: "builtin-funasr",
        base_url: null,
        model: "iic/SenseVoiceSmall",
        has_api_key: false,
        ready: false,
        setup: expect.objectContaining({
          runtime: "builtin-rpc",
          status: "disabled",
          available: false,
        }),
      }),
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
    });

    const voiceInput = await app.request("/api/v1/local/audio/voice-input");
    expect(voiceInput.status).toBe(200);
    expect(await voiceInput.json()).toMatchObject({
      asr: {
        enabled: false,
        ready: false,
        setup: { status: "disabled" },
      },
    });

    const updated = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asr_enabled: true,
        asr_provider: "builtin-funasr",
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({
      asr: expect.objectContaining({
        enabled: true,
        provider: "builtin-funasr",
        base_url: null,
        model: "iic/SenseVoiceSmall",
        has_api_key: false,
        ready: false,
        setup: expect.objectContaining({
          provider: "funasr",
          runtime: "builtin-rpc",
          status: "needs-install",
          available: false,
        }),
      }),
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      mutation: {
        operation: "local_audio_config_update",
        entity: { kind: "local-config", id: "audio" },
        accepted: true,
        resultEntityId: "audio",
      },
    });

    const legacyEndpointConfig = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asr_enabled: true,
        asr_provider: "openai-compatible",
        asr_base_url: "http://127.0.0.1:8000/v1",
        asr_api_key: "local-secret",
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    expect(legacyEndpointConfig.status).toBe(200);
    expect(await legacyEndpointConfig.json()).toMatchObject({
      asr: expect.objectContaining({
        enabled: true,
        provider: "builtin-funasr",
        base_url: null,
        has_api_key: false,
        ready: false,
      }),
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      mutation: {
        operation: "local_audio_config_update",
        entity: { kind: "local-config", id: "audio" },
        accepted: true,
        resultEntityId: "audio",
      },
    });

    const reopenedAudioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: false, message: "FunASR is not installed" }),
    });
    const reopened = createLocalApiApp({ dataDir, userId: "local-user", audioConfig: reopenedAudioConfig });
    const persisted = await reopened.request("/api/v1/local/audio");
    expect(await persisted.json()).toMatchObject({
      asr: expect.objectContaining({
        enabled: true,
        provider: "builtin-funasr",
        base_url: null,
        has_api_key: false,
        ready: false,
      }),
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
    });
  });

  it("requires a receipt-bearing audio config read token before agent audio config changes", async () => {
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: false, message: "FunASR is not installed" }),
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const initial = await app.request("/api/v1/local/audio");
    const initialJson = await initial.json() as { readToken?: string };
    expect(initialJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const missing = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({
        asr_enabled: true,
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("Missing local audio config update read proof"),
      mutation: {
        operation: "local_audio_config_update",
        entity: { kind: "local-config", id: "audio" },
        accepted: false,
        error: expect.stringContaining("Missing local audio config update read proof"),
      },
    });

    const bareReadToken = baseReadToken(initialJson.readToken!);
    const bare = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": bareReadToken,
      },
      body: JSON.stringify({
        asr_enabled: true,
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({
      error: expect.stringContaining("Missing local audio config update read receipt"),
      mutation: {
        operation: "local_audio_config_update",
        entity: { kind: "local-config", id: "audio" },
        expectedReadToken: bareReadToken,
        beforeReadToken: bareReadToken,
        accepted: false,
        error: expect.stringContaining("Missing local audio config update read receipt"),
      },
    });

    const userUpdate = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asr_enabled: true,
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    expect(userUpdate.status).toBe(200);

    const stale = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
      body: JSON.stringify({
        asr_enabled: false,
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    expect(stale.status).toBe(409);
    const staleJson = await stale.json() as { error: string; mutation: { beforeReadToken?: string; expectedReadToken?: string } };
    expect(staleJson.error).toContain("Stale local audio config update rejected");
    expect(staleJson.mutation.expectedReadToken).toBe(initialJson.readToken);
    expect(staleJson.mutation.beforeReadToken).toMatch(/^local-config-v1:[a-f0-9]{16}$/);
    expect(staleJson.mutation.beforeReadToken).not.toBe(baseReadToken(initialJson.readToken!));

    const refreshed = await app.request("/api/v1/local/audio");
    const refreshedJson = await refreshed.json() as { readToken?: string };
    expect(refreshedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const accepted = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": refreshedJson.readToken!,
      },
      body: JSON.stringify({
        asr_enabled: false,
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      asr: {
        enabled: false,
        provider: "builtin-funasr",
      },
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      mutation: {
        operation: "local_audio_config_update",
        entity: { kind: "local-config", id: "audio" },
        expectedReadToken: refreshedJson.readToken,
        beforeReadToken: baseReadToken(refreshedJson.readToken!),
        accepted: true,
        resultEntityId: "audio",
        afterReadToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      },
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=local_audio_config_update&entityId=audio");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(2);
    const humanAuditRecord = auditJson.records.find((record) => record.actorClientType == null);
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(humanAuditRecord).toMatchObject({
      operation: "local_audio_config_update",
      entity: { kind: "local-config", id: "audio" },
      actorClientType: null,
      accepted: true,
      reason: "local audio config update",
      resultEntityId: "audio",
    });
    expect(agentAuditRecord).toMatchObject({
      operation: "local_audio_config_update",
      entity: { kind: "local-config", id: "audio" },
      actorClientType: "agent",
      accepted: true,
      reason: "local audio config update",
      resultEntityId: "audio",
    });
    for (const record of auditJson.records) {
      expect(JSON.stringify(record.mutation ?? {})).not.toContain("receipt");
      expect(record.mutation.expectedReadToken).toBeUndefined();
      expect(record.mutation.beforeReadToken).toBeUndefined();
      expect(record.mutation.afterReadToken).toBeUndefined();
    }
  });

  it("installs built-in ASR from the requested local model card", async () => {
    let installed = false;
    const builtinInstall = vi.fn(async () => {
      installed = true;
    });
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: installed, message: installed ? undefined : "FunASR is not installed" }),
      builtinInstall,
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const install = await app.request("/api/v1/local/audio/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
    });

    expect(install.status).toBe(200);
    expect(await install.json()).toMatchObject({
      asr: expect.objectContaining({
        enabled: false,
        provider: "builtin-funasr",
        model: "iic/SenseVoiceSmall",
        ready: false,
        setup: expect.objectContaining({
          runtime: "builtin-rpc",
          status: "disabled",
          available: true,
        }),
      }),
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      mutation: {
        operation: "local_audio_model_install",
        entity: { kind: "local-config", id: "audio" },
        accepted: true,
        resultEntityId: "audio",
      },
    });
    expect(builtinInstall).toHaveBeenCalledWith({
      model: "iic/SenseVoiceSmall",
      pythonBinary: join(dataDir, "runtimes", "python", "local-models", "venv", "bin", "python"),
    });
  });

  it("installs, synthesizes by node-selected model, and removes local TTS through the generalized speech API", async () => {
    let installed = false;
    const ttsRuntime = {
      status: vi.fn(async () => ({
        available: installed,
        ...(installed ? {} : { message: "Piper voice is not downloaded" }),
      })),
      deploy: vi.fn(async () => {
        installed = true;
      }),
      remove: vi.fn(async () => {
        installed = false;
      }),
      synthesize: vi.fn(async ({ model, outputPath, voice }: {
        model: string;
        outputPath: string;
        voice?: string | null;
      }) => {
        await writeFile(outputPath, Buffer.from("RIFF-api-local-wav"));
        return {
          schemaVersion: 1 as const,
          kind: "clash.tts.audio" as const,
          backendId: "piper",
          modelId: model,
          ...(voice ? { voiceId: voice } : {}),
          format: "wav" as const,
          sampleRate: 22050,
          durationMs: 750,
          outputPath,
        };
      }),
    };
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      asrRuntime: {
        status: vi.fn(async () => ({ available: false })),
        deploy: vi.fn(async () => undefined),
        transcribe: vi.fn(async () => {
          throw new Error("not used");
        }),
      },
      ttsRuntime,
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const catalogBeforeInstall = await app.request("/api/v1/models/catalog");
    expect(catalogBeforeInstall.status).toBe(200);
    const catalogBeforeInstallJson = await catalogBeforeInstall.json() as {
      models: Array<{
        model: { id: string };
        runtimeReadiness?: {
          capability: string;
          model: string;
          readiness: string;
          executable: boolean;
          message?: string;
        };
      }>;
    };
    expect(catalogBeforeInstallJson.models.find(({ model }) => model.id === "piper-huayan-tts")).toMatchObject({
      runtimeReadiness: {
        capability: "text-to-speech",
        model: "zh_CN-huayan-medium",
        readiness: "not-installed",
        executable: false,
        message: "Piper voice is not downloaded",
      },
    });

    const install = await app.request("/api/v1/local/audio/install", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capability: "text-to-speech",
        model: "zh_CN-huayan-medium",
      }),
    });
    expect(install.status).toBe(200);
    expect(await install.json()).toMatchObject({
      tts: {
        capability: "text-to-speech",
        model: "zh_CN-huayan-medium",
        setup: {
          provider: "piper",
          available: true,
        },
      },
    });

    const status = await app.request(
      "/api/v1/local/audio/models/status?capability=text-to-speech&model=zh_CN-huayan-medium",
    );
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      capability: "text-to-speech",
      model: "zh_CN-huayan-medium",
      available: true,
      readiness: "ready",
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
    });

    const synthesis = await app.request("/api/v1/local/audio/speech", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "zh_CN-huayan-medium",
        text: "Clash 本地语音",
        voice: "huayan",
        speed: 1.1,
      }),
    });
    expect(synthesis.status).toBe(200);
    expect(synthesis.headers.get("content-type")).toBe("audio/wav");
    expect(synthesis.headers.get("x-clash-tts-backend")).toBe("piper");
    expect(synthesis.headers.get("x-clash-tts-model")).toBe("zh_CN-huayan-medium");
    expect(synthesis.headers.get("x-clash-tts-voice")).toBe("huayan");
    expect(synthesis.headers.get("x-clash-tts-duration-ms")).toBe("750");
    expect(Buffer.from(await synthesis.arrayBuffer()).toString()).toBe("RIFF-api-local-wav");

    const remove = await app.request("/api/v1/local/audio/remove", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capability: "text-to-speech",
        model: "zh_CN-huayan-medium",
      }),
    });
    expect(remove.status).toBe(200);
    expect(await remove.json()).toMatchObject({
      tts: {
        model: "zh_CN-huayan-medium",
        ready: false,
        setup: { available: false },
      },
    });
  });

  it("requires a receipt-bearing audio config read token before agent audio installs", async () => {
    let installed = false;
    const builtinInstall = vi.fn(async () => {
      installed = true;
    });
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: installed, message: installed ? undefined : "FunASR is not installed" }),
      builtinInstall,
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const initial = await app.request("/api/v1/local/audio");
    const initialJson = await initial.json() as { readToken?: string };
    expect(initialJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const missing = await app.request("/api/v1/local/audio/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("Missing local audio model install read proof"),
      mutation: {
        operation: "local_audio_model_install",
        entity: { kind: "local-config", id: "audio" },
        accepted: false,
      },
    });
    expect(builtinInstall).not.toHaveBeenCalled();

    const bare = await app.request("/api/v1/local/audio/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(initialJson.readToken!),
      },
      body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
    });
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({
      error: expect.stringContaining("Missing local audio model install read receipt"),
      mutation: {
        operation: "local_audio_model_install",
        entity: { kind: "local-config", id: "audio" },
        accepted: false,
      },
    });
    expect(builtinInstall).not.toHaveBeenCalled();

    const accepted = await app.request("/api/v1/local/audio/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
      body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as { readToken?: string; mutation?: any };
    expect(acceptedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);
    expect(acceptedJson.readToken).not.toBe(initialJson.readToken);
    expect(acceptedJson.mutation).toMatchObject({
      operation: "local_audio_model_install",
      entity: { kind: "local-config", id: "audio" },
      expectedReadToken: initialJson.readToken,
      beforeReadToken: baseReadToken(initialJson.readToken!),
      afterReadToken: acceptedJson.readToken,
      accepted: true,
      resultEntityId: "audio",
    });
    expect(builtinInstall).toHaveBeenCalledTimes(1);
    const audit = await app.request("/api/v1/mutation-audit?operation=local_audio_model_install&entityId=audio");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "local_audio_model_install",
      entity: { kind: "local-config", id: "audio" },
      actorClientType: "agent",
      accepted: true,
      reason: "local audio model install",
      resultEntityId: "audio",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();

    const stale = await app.request("/api/v1/local/audio/install", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
      body: JSON.stringify({ asr_model: "iic/SenseVoiceSmall" }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: expect.stringContaining("Stale local audio model install rejected"),
      mutation: {
        operation: "local_audio_model_install",
        entity: { kind: "local-config", id: "audio" },
        expectedReadToken: initialJson.readToken,
        accepted: false,
      },
    });
    expect(builtinInstall).toHaveBeenCalledTimes(1);
  });

  it("records rejected mutation envelopes for invalid local audio configuration writes", async () => {
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: false }),
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const res = await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ asr_provider: "remote-openai" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "asr_provider must be builtin-funasr",
      mutation: {
        operation: "local_audio_config_update",
        entity: { kind: "local-config", id: "audio" },
        accepted: false,
        error: "asr_provider must be builtin-funasr",
      },
    });
  });

  it("transcribes local ASR through the built-in FunASR RPC adapter", async () => {
    const builtinTranscribe = vi.fn(async (input: { file: File; model: string; language?: string | null }) => {
      expect(input.model).toBe("iic/SenseVoiceSmall");
      expect(input.language).toBeNull();
      expect(input.file.name).toBe("voice.webm");
      expect(await input.file.text()).toBe("voice-bytes");
      return {
        schemaVersion: 1 as const,
        kind: "clash.asr.timed-transcript" as const,
        timebase: "milliseconds" as const,
        alignment: "word" as const,
        text: "你好 Clash",
        backendId: "funasr",
        modelId: input.model,
        language: "zh",
        durationMs: 500,
        words: [
          { id: "word-000001", text: "你", startMs: 0, endMs: 160 },
          { id: "word-000002", text: "好", startMs: 160, endMs: 280 },
          { id: "word-000003", text: "Clash", startMs: 300, endMs: 500 },
        ],
        segments: [
          {
            id: "segment-000001",
            text: "你好 Clash",
            startMs: 0,
            endMs: 500,
            wordIds: ["word-000001", "word-000002", "word-000003"],
          },
        ],
      };
    });
    const audioConfig = createLocalAudioConfigStore({ dataDir, builtinTranscribe });
    const warmupVoiceInput = vi.spyOn(audioConfig, "warmupVoiceInput");
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asr_enabled: true,
        asr_provider: "builtin-funasr",
        asr_model: "iic/SenseVoiceSmall",
      }),
    });
    const warmup = await app.request("/api/v1/local/audio/voice-input/warmup", {
      method: "POST",
    });
    expect(warmup.status).toBe(202);
    expect(await warmup.json()).toMatchObject({
      status: "warming",
      runtime: "builtin-rpc",
      model: "iic/SenseVoiceSmall",
    });
    await vi.waitFor(() => expect(warmupVoiceInput).toHaveBeenCalledWith({
      model: "iic/SenseVoiceSmall",
    }));
    const form = new FormData();
    form.append("file", new File(["voice-bytes"], "voice.webm", { type: "audio/webm" }));

    const res = await app.request("/api/v1/local/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      schemaVersion: 1,
      kind: "clash.asr.timed-transcript",
      timebase: "milliseconds",
      alignment: "word",
      text: "你好 Clash",
      backendId: "funasr",
      modelId: "iic/SenseVoiceSmall",
      language: "zh",
      durationMs: 500,
      words: [
        { id: "word-000001", text: "你", startMs: 0, endMs: 160 },
        { id: "word-000002", text: "好", startMs: 160, endMs: 280 },
        { id: "word-000003", text: "Clash", startMs: 300, endMs: 500 },
      ],
      segments: [
        {
          id: "segment-000001",
          text: "你好 Clash",
          startMs: 0,
          endMs: 500,
          wordIds: ["word-000001", "word-000002", "word-000003"],
        },
      ],
      mutation: {
        operation: "local_audio_transcription",
        entity: { kind: "local-action", id: "audio-transcription" },
        accepted: true,
        resultEntityId: "audio-transcription",
      },
    });
    expect(builtinTranscribe).toHaveBeenCalledTimes(1);

    const audit = await app.request("/api/v1/mutation-audit?operation=local_audio_transcription&entityId=audio-transcription");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "local_audio_transcription",
      entity: { kind: "local-action", id: "audio-transcription" },
      accepted: true,
      reason: "local audio transcription",
      resultEntityId: "audio-transcription",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();
  });

  it("transcribes through an enabled global cloud model route", async () => {
    const privateKey = await createTestPrivateKeyPem();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const audioConfig = createLocalAudioConfigStore({ dataDir });
    const warmupVoiceInput = vi.spyOn(audioConfig, "warmupVoiceInput");
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      audioConfig,
      voiceInputFetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "vertex-access-token", expires_in: 3600 });
        }
        if (url === "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent") {
          return Response.json({
            candidates: [{ content: { parts: [{ text: "云端转写结果" }] } }],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [{
          id: "google-agent-platform-voice",
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
          priority: 1,
          credentials: {
            vertexCredentials: JSON.stringify({
              project_id: "vertex-project",
              client_email: "svc@vertex-project.iam.gserviceaccount.com",
              private_key: privateKey,
            }),
          },
        }],
      }),
    });
    await app.request("/api/v1/local/audio", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        asr_enabled: true,
        asr_model: "gemini-3-flash",
      }),
    });
    const voiceInputState = await app.request("/api/v1/local/audio/voice-input?probe=false");
    expect(voiceInputState.status).toBe(200);
    expect(await voiceInputState.json()).toMatchObject({
      asr: {
        enabled: true,
        model: "gemini-3-flash",
        ready: true,
        setup: {
          runtime: "provider-route",
          status: "ready",
        },
      },
    });
    const warmup = await app.request("/api/v1/local/audio/voice-input/warmup", {
      method: "POST",
    });
    expect(warmup.status).toBe(200);
    expect(await warmup.json()).toEqual({
      status: "not-needed",
      runtime: "provider-route",
    });
    expect(warmupVoiceInput).not.toHaveBeenCalled();

    const form = new FormData();
    form.append("file", new File(["voice-bytes"], "voice.webm", { type: "audio/webm" }));
    const res = await app.request("/api/v1/local/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      text: "云端转写结果",
      backendId: "google-agent-platform",
      modelId: "gemini-3-flash",
    });
    expect(JSON.parse(String(calls[1]?.init?.body))).toMatchObject({
      contents: [{
        role: "user",
        parts: [
          { text: expect.stringContaining("Transcribe") },
          {
            inlineData: {
              mimeType: "audio/webm",
              data: Buffer.from("voice-bytes").toString("base64"),
            },
          },
        ],
      }],
    });
  }, 10_000);

  it("records rejected mutation envelopes for local ASR transcription failures", async () => {
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: true }),
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });
    const form = new FormData();
    form.append("file", new File(["voice-bytes"], "voice.webm", { type: "audio/webm" }));

    const res = await app.request("/api/v1/local/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "Voice input is not enabled. Open Settings > Voice input and enable it.",
      mutation: {
        operation: "local_audio_transcription",
        entity: { kind: "local-action", id: "audio-transcription" },
        accepted: false,
        error: "Voice input is not enabled. Open Settings > Voice input and enable it.",
      },
    });
  });

  it("records rejected mutation envelopes for invalid local ASR transcription input", async () => {
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: true }),
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const res = await app.request("/api/v1/local/audio/transcriptions", {
      method: "POST",
      body: new FormData(),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Missing file",
      mutation: {
        operation: "local_audio_transcription",
        entity: { kind: "local-action", id: "audio-transcription" },
        accepted: false,
        error: "Missing file",
      },
    });
  });

  it("does not expose local platform variable or action-secret endpoints", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    for (const [method, path] of [
      ["GET", "/api/settings/variables"],
      ["POST", "/api/settings/variables"],
      ["DELETE", "/api/settings/variables/secret-id"],
      ["GET", "/api/settings/action-secrets"],
      ["POST", "/api/settings/action-secrets"],
      ["DELETE", "/api/settings/action-secrets/secret-id"],
      ["GET", "/api/v1/vars"],
      ["PUT", "/api/v1/vars/FAL_API_KEY"],
      ["DELETE", "/api/v1/vars/FAL_API_KEY"],
      ["GET", "/api/v1/action-secrets"],
      ["PUT", "/api/v1/action-secrets/FAL_API_KEY"],
      ["DELETE", "/api/v1/action-secrets/FAL_API_KEY"],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" || method === "PUT" ? JSON.stringify({ key: "FAL_API_KEY", value: "secret" }) : undefined,
      });
      expect(res.status).toBe(404);
    }
  });

  it("does not expose legacy project room endpoints locally", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "No Local Room" }),
    });
    const project = await created.json() as { id: string };

    for (const [method, path, body] of [
      ["GET", `/api/v1/projects/${project.id}/room/messages`, undefined],
      ["POST", `/api/v1/projects/${project.id}/room/messages`, { text: "legacy room", sender_kind: "agent", sender_id: "local-master-clash" }],
      ["POST", `/api/v1/projects/${project.id}/room/sync`, {}],
      [
        "POST",
        `/api/v1/projects/${project.id}/room/sync/conflicts/room-conflict/resolve`,
        { resolution: "accept-divergence", localContentHash: "local", remoteContentHash: "remote" },
      ],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status).toBe(404);
    }
  });

  it("does not expose hosted API token mutations locally", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const list = await app.request("/api/settings/tokens");
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);

    for (const [method, path] of [
      ["POST", "/api/settings/tokens"],
      ["DELETE", "/api/settings/tokens/token-id"],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "POST" ? JSON.stringify({ name: "CLI" }) : undefined,
      });
      expect(res.status).toBe(404);
    }
  });

  it("does not expose hosted action or skill install mutations locally", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    for (const path of ["/api/settings/actions", "/api/settings/skills"] as const) {
      const list = await app.request(path);
      expect(list.status).toBe(200);
      expect(await list.json()).toEqual([]);
    }

    for (const [method, path, body] of [
      ["POST", "/api/settings/actions", { manifest: { id: "worker-action", name: "Worker action", runtime: "worker" } }],
      ["DELETE", "/api/settings/actions/worker-action", undefined],
      ["POST", "/api/settings/skills", { skill: { id: "remote-skill", name: "Remote Skill" } }],
      ["DELETE", "/api/settings/skills/remote-skill", undefined],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status).toBe(404);
    }
  });

  it("exposes installable local action packages through the desktop marketplace", async () => {
    const installMarketplaceAction = vi.fn(async (packageId: string) => ({
      actionId: "codex-imagegen",
      packageId,
      installed: true,
    }));
    const uninstallMarketplaceAction = vi.fn(async () => undefined);
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      marketplaceActions: [{
        id: "codex-imagegen",
        name: "Codex ImageGen",
        type: "action",
        runtime: "local",
        outputType: "image",
        packageId: "clash-codex-imagegen",
      }],
      listInstalledMarketplaceActions: async () => [{
        actionId: "codex-imagegen",
        name: "Codex ImageGen",
        runtime: "local",
      }],
      installMarketplaceAction,
      uninstallMarketplaceAction,
    } as any);

    await expect((await app.request("/api/marketplace/registry")).json()).resolves.toEqual({
      version: 1,
      actions: [expect.objectContaining({
        id: "codex-imagegen",
        packageId: "clash-codex-imagegen",
      })],
      skills: [],
    });
    await expect((await app.request("/api/settings/actions")).json()).resolves.toEqual([
      expect.objectContaining({ actionId: "codex-imagegen" }),
    ]);

    const installed = await app.request("/api/settings/actions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        manifest: {
          id: "codex-imagegen",
          name: "Codex ImageGen",
          runtime: "local",
          outputType: "image",
          packageId: "clash-codex-imagegen",
        },
      }),
    });
    expect(installed.status).toBe(200);
    expect(installMarketplaceAction).toHaveBeenCalledWith("clash-codex-imagegen");

    const marketplaceInstalled = await app.request(
      "/api/marketplace/actions/clash-codex-imagegen/install",
      { method: "POST" },
    );
    expect(marketplaceInstalled.status).toBe(200);
    expect(installMarketplaceAction).toHaveBeenLastCalledWith("clash-codex-imagegen");

    const uninstalled = await app.request("/api/settings/actions/codex-imagegen", {
      method: "DELETE",
    });
    expect(uninstalled.status).toBe(204);
    expect(uninstallMarketplaceAction).toHaveBeenCalledWith("codex-imagegen");

    const marketplaceUninstalled = await app.request(
      "/api/marketplace/actions/clash-codex-imagegen/install",
      { method: "DELETE" },
    );
    expect(marketplaceUninstalled.status).toBe(204);
    expect(uninstallMarketplaceAction).toHaveBeenLastCalledWith("codex-imagegen");
  });

  it("persists local project metadata in SQLite", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Private DB permissions" }),
    });

    expect(created.status).toBe(201);
    await expect(stat(join(dataDir, "local.sqlite"))).resolves.toMatchObject({ mode: expect.any(Number) });

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select owner_id, name, description from project").get()).toEqual({
        owner_id: "local-user",
        name: "Private DB permissions",
        description: null,
      });
    } finally {
      sqlite.close();
    }
  });

  it("keeps all concurrent project creates instead of last-write-wins overwriting metadata", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const names = Array.from({ length: 12 }, (_, index) => `Concurrent Project ${index}`);

    const created = await Promise.all(names.map((name) =>
      app.request("/api/v1/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      })
    ));
    expect(created.map((response) => response.status)).toEqual(names.map(() => 201));

    const listed = await app.request("/api/v1/projects");
    const body = await listed.json() as { projects: Array<{ name: string }> };
    expect(body.projects.map((project) => project.name).sort()).toEqual([...names].sort());
  });

  it("keeps all concurrent session creates for a project", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const titles = Array.from({ length: 12 }, (_, index) => `Concurrent Session ${index}`);

    const created = await Promise.all(titles.map((title) =>
      app.request("/api/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "project-concurrent-sessions", title }),
      })
    ));
    expect(created.map((response) => response.status)).toEqual(titles.map(() => 200));

    const listed = await app.request("/api/v1/sessions?projectId=project-concurrent-sessions");
    const body = await listed.json() as { sessions: Array<{ title: string }> };
    expect(body.sessions.map((session) => session.title).sort()).toEqual([...titles].sort());
  });

  it("records mutation envelopes for v1 session create and delete", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const missingProjectId = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "No project" }),
    });
    expect(missingProjectId.status).toBe(400);
    expect(await missingProjectId.json()).toEqual({
      error: "Missing projectId",
      mutation: {
        operation: "session_create",
        entity: { kind: "session", id: "" },
        accepted: false,
        error: "Missing projectId",
      },
    });

    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Session Project" }),
    });
    const { id: projectId } = await createdProject.json() as { id: string };

    const created = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({ projectId, title: "Editable session" }),
    });
    expect(created.status).toBe(200);
    const createdJson = await created.json() as { threadId: string; title: string; mutation?: unknown };
    expect(createdJson.title).toBe("Editable session");
    expect(createdJson.mutation).toEqual({
      operation: "session_create",
      entity: { kind: "session", id: createdJson.threadId },
      resultEntityId: createdJson.threadId,
      accepted: true,
    });
    const createAudit = await app.request(`/api/v1/mutation-audit?operation=session_create&entityId=${encodeURIComponent(createdJson.threadId)}`);
    expect(createAudit.status).toBe(200);
    const createAuditJson = await createAudit.json() as { records: Array<any> };
    expect(createAuditJson.records).toHaveLength(1);
    expect(createAuditJson.records[0]).toMatchObject({
      operation: "session_create",
      entity: { kind: "session", id: createdJson.threadId },
      actorClientType: "agent",
      accepted: true,
      reason: "session create",
      resultEntityId: createdJson.threadId,
    });
    expect(JSON.stringify(createAuditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(createAuditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(createAuditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(createAuditJson.records[0].mutation.afterReadToken).toBeUndefined();

    const deletedProject = await app.request(`/api/v1/projects/${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    expect(deletedProject.status).toBe(200);
    const deletedProjectSession = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, title: "Hidden project session" }),
    });
    expect(deletedProjectSession.status).toBe(409);
    expect(await deletedProjectSession.json()).toEqual({
      error: "Project is deleted; restore it before creating sessions",
      mutation: {
        operation: "session_create",
        entity: { kind: "session", id: "" },
        accepted: false,
        error: "Project is deleted; restore it before creating sessions",
      },
    });

    const missingThread = await app.request("/api/v1/sessions", { method: "DELETE" });
    expect(missingThread.status).toBe(400);
    expect(await missingThread.json()).toEqual({
      error: "Missing threadId",
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: "" },
        accepted: false,
        error: "Missing threadId",
      },
    });

    const missingSession = await app.request("/api/v1/sessions?threadId=missing-session", {
      method: "DELETE",
    });
    expect(missingSession.status).toBe(404);
    expect(await missingSession.json()).toEqual({
      error: "Not found",
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: "missing-session" },
        accepted: false,
        error: "Not found",
      },
    });

    const deleted = await app.request(`/api/v1/sessions?threadId=${encodeURIComponent(createdJson.threadId)}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      ok: true,
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: createdJson.threadId },
        resultEntityId: createdJson.threadId,
        accepted: true,
      },
    });
  });

  it("requires a receipt-bearing session read token before agent session delete", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Session CAS Project" }),
    });
    const { id: projectId } = await createdProject.json() as { id: string };

    const created = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, title: "Agent deletable session" }),
    });
    expect(created.status).toBe(200);
    const { threadId } = await created.json() as { threadId: string };

    const listed = await app.request(`/api/v1/sessions?projectId=${encodeURIComponent(projectId)}`);
    const listedJson = await listed.json() as { sessions: Array<{ threadId: string; readToken?: string }> };
    const session = listedJson.sessions.find((candidate) => candidate.threadId === threadId);
    expect(session?.readToken).toMatch(SESSION_RECEIPT_READ_TOKEN_RE);

    const missing = await app.request(`/api/v1/sessions?threadId=${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("Missing session delete read proof"),
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: threadId },
        accepted: false,
        error: expect.stringContaining("Missing session delete read proof"),
      },
    });

    const bareReadToken = baseReadToken(session!.readToken!);
    const bare = await app.request(`/api/v1/sessions?threadId=${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": bareReadToken,
      },
    });
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({
      error: expect.stringContaining("Missing session delete read receipt"),
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: threadId },
        expectedReadToken: bareReadToken,
        beforeReadToken: bareReadToken,
        accepted: false,
        error: expect.stringContaining("Missing session delete read receipt"),
      },
    });

    const sqlite = openSqlite();
    try {
      sqlite.prepare("UPDATE runtime_session SET updated_at = ? WHERE id = ?")
        .run("2026-07-07T02:00:00.000Z", threadId);
    } finally {
      sqlite.close();
    }

    const stale = await app.request(`/api/v1/sessions?threadId=${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": session!.readToken!,
      },
    });
    expect(stale.status).toBe(409);
    const staleJson = await stale.json() as { error: string; mutation: { beforeReadToken?: string; expectedReadToken?: string } };
    expect(staleJson.error).toContain("Stale session delete rejected");
    expect(staleJson.mutation.expectedReadToken).toBe(session!.readToken);
    expect(staleJson.mutation.beforeReadToken).toMatch(/^session-v1:[a-f0-9]{16}$/);
    expect(staleJson.mutation.beforeReadToken).not.toBe(baseReadToken(session!.readToken!));

    const refreshed = await app.request(`/api/v1/sessions?projectId=${encodeURIComponent(projectId)}`);
    const refreshedJson = await refreshed.json() as { sessions: Array<{ threadId: string; readToken?: string }> };
    const freshReadToken = refreshedJson.sessions.find((candidate) => candidate.threadId === threadId)?.readToken;
    expect(freshReadToken).toMatch(SESSION_RECEIPT_READ_TOKEN_RE);

    const deleted = await app.request(`/api/v1/sessions?threadId=${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": freshReadToken!,
      },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      ok: true,
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: threadId },
        expectedReadToken: freshReadToken,
        beforeReadToken: baseReadToken(freshReadToken!),
        resultEntityId: threadId,
        accepted: true,
      },
    });

    const audit = await app.request(`/api/v1/mutation-audit?operation=session_delete&entityId=${encodeURIComponent(threadId)}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ mutation?: unknown }> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "session_delete",
      entity: { kind: "session", id: threadId },
      accepted: true,
      actorClientType: "agent",
      reason: "session delete",
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: threadId },
        resultEntityId: threadId,
        accepted: true,
      },
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
  });

  it("keeps all concurrent asset creates for a project preview", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Concurrent Asset Project" }),
    });
    const { id: projectId } = await createdProject.json() as { id: string };
    const keys = Array.from({ length: 12 }, (_, index) => `uploads/concurrent-${index}.png`);

    const created = await Promise.all(keys.map((srcR2Key) =>
      app.request("/api/v1/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, kind: "image", srcR2Key }),
      })
    ));
    expect(created.map((response) => response.status)).toEqual(keys.map(() => 200));
    const createdAssets = await Promise.all(created.map((response) => response.json() as Promise<{ id: string }>));

    const loaded = await app.request("/api/v1/assets/batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: createdAssets.map((asset) => asset.id) }),
    });
    const body = await loaded.json() as { assets: Array<{ srcR2Key: string }> };
    expect(body.assets.map((asset) => asset.srcR2Key).sort()).toEqual([...keys].sort());
  });

  it("persists global library membership and attaches a library asset to a project by reference", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const createdAsset = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        addToLibrary: true,
        kind: "image",
        srcR2Key: "uploads/library.png",
        originalName: "Opening frame.png",
      }),
    });
    expect(createdAsset.status).toBe(200);
    const { id: assetId } = await createdAsset.json() as { id: string };

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const library = await reopened.request("/api/v1/assets");
    expect(library.status).toBe(200);
    expect(await library.json()).toMatchObject({ assets: [{ id: assetId, srcR2Key: "uploads/library.png" }] });
    const gcPreview = await reopened.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(await gcPreview.json()).toMatchObject({ deletedAssets: [] });

    const createdProject = await reopened.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Library target" }),
    });
    const { id: projectId } = await createdProject.json() as { id: string };
    const attached = await reopened.request(`/api/v1/assets/${assetId}/ref`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    expect(attached.status).toBe(200);

    const project = await reopened.request(`/api/v1/projects/${projectId}`);
    expect(await project.json()).toMatchObject({
      assets: [
        {
          id: assetId,
          name: "Opening frame.png",
          thumbnailUrl: "/assets/uploads/library.png",
          storageKey: "uploads/library.png",
        },
      ],
    });
  });

  it("includes audio assets in the project asset collection", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Audio assets" }),
    });
    const { id: projectId } = await createdProject.json() as { id: string };
    const createdAsset = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, kind: "audio", srcR2Key: "generated/voice.wav" }),
    });
    const { id: assetId } = await createdAsset.json() as { id: string };

    const project = await app.request(`/api/v1/projects/${projectId}`);
    expect(await project.json()).toMatchObject({
      assets: [
        {
          id: assetId,
          name: "Generated audio",
          type: "audio",
          storageKey: "generated/voice.wav",
        },
      ],
    });
  });

  it("persists authoritative local media probe metadata and a generated video cover", async () => {
    const assetProbe = vi.fn(async () => ({
      metadata: {
        width: 1920,
        height: 1080,
        durationMs: 32_661,
        bytes: 4_096,
      },
      coverR2Key: "covers/talking-head.jpg",
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      assetProbe,
    });

    const created = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-video-probe",
        kind: "video",
        srcR2Key: "uploads/talking-head.mp4",
        originalName: "Talking head.mp4",
      }),
    });
    expect(created.status).toBe(200);
    const { id } = await created.json() as { id: string };

    expect(assetProbe).toHaveBeenCalledWith(expect.objectContaining({
      assetId: id,
      kind: "video",
      projectId: "project-video-probe",
      srcR2Key: "uploads/talking-head.mp4",
    }));
    const loaded = await app.request(`/api/v1/assets/${id}`);
    expect(await loaded.json()).toMatchObject({
      id,
      coverR2Key: "covers/talking-head.jpg",
      metadata: {
        originalName: "Talking head.mp4",
        width: 1920,
        height: 1080,
        durationMs: 32_661,
        bytes: 4_096,
      },
    });
  });

  it("persists uploaded 3D models as assets while keeping the media collection typed", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Director models" }),
    });
    const { id: projectId } = await createdProject.json() as { id: string };
    const createdAsset = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        kind: "model",
        srcR2Key: "uploads/blocking.glb",
        originalName: "blocking.glb",
      }),
    });
    expect(createdAsset.status).toBe(200);
    const { id: assetId } = await createdAsset.json() as { id: string };

    const asset = await app.request(`/api/v1/assets/${assetId}`);
    expect(await asset.json()).toMatchObject({
      id: assetId,
      kind: "model",
      srcR2Key: "uploads/blocking.glb",
      metadata: { originalName: "blocking.glb" },
    });
    const project = await app.request(`/api/v1/projects/${projectId}`);
    expect(await project.json()).toMatchObject({ assets: [] });
  });

  it("generates a real Director GLB through a configured fal account and persists it as a project model asset", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/fal-ai/hunyuan3d-v3/text-to-3d") && init?.method === "POST") {
        return new Response(JSON.stringify({ request_id: "director-model-request" }), { status: 200 });
      }
      if (url.endsWith("/requests/director-model-request/status")) {
        return new Response(JSON.stringify({ status: "COMPLETED" }), { status: 200 });
      }
      if (url.endsWith("/requests/director-model-request")) {
        return new Response(JSON.stringify({
          model_glb: {
            url: "https://v3b.fal.media/director/horse.glb",
            content_type: "model/gltf-binary",
            file_name: "horse.glb",
          },
        }), { status: 200 });
      }
      if (url === "https://v3b.fal.media/director/horse.glb") {
        return new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46]), {
          status: 200,
          headers: { "content-type": "model/gltf-binary" },
        });
      }
      throw new Error(`Unexpected model generation request ${url}`);
    });
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      directorModelGenerationFetch: fetchMock as typeof fetch,
      directorModelPollIntervalMs: 0,
    } as any);
    const createdProject = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Generated Director models" }),
    });
    const { id: projectId } = await createdProject.json() as { id: string };
    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [{
          id: "fal-director",
          providerId: "fal",
          upstreamId: "fal",
          enabled: true,
          priority: 1,
          credentials: { apiKey: "fal-director-secret" },
        }],
      }),
    });

    const generated = await app.request("/api/v1/director-model-generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        prompt: "A chestnut horse with a production saddle",
        quality: "low-poly",
        pbr: true,
        faceCount: 120000,
      }),
    });

    expect(generated.status).toBe(200);
    const receipt = await generated.json() as { assetId: string; sourceUrl: string };
    expect(receipt).toMatchObject({
      assetId: expect.any(String),
      name: "horse.glb",
      sourceUrl: expect.stringContaining("/assets/projects/"),
      provider: "fal",
      modelEndpoint: "fal-ai/hunyuan3d-v3/text-to-3d",
      requestId: "director-model-request",
    });
    const asset = await app.request(`/api/v1/assets/${receipt.assetId}`);
    expect(await asset.json()).toMatchObject({
      id: receipt.assetId,
      kind: "model",
      sourceModel: "fal-ai/hunyuan3d-v3/text-to-3d",
      sourcePrompt: "A chestnut horse with a production saddle",
      sourceTaskId: "director-model-request",
      metadata: {
        contentType: "model/gltf-binary",
        bytes: 4,
        provider: "fal",
        requestId: "director-model-request",
        modelEndpoint: "fal-ai/hunyuan3d-v3/text-to-3d",
      },
    });
  });

  it("indexes applied text revisions with immutable content blobs without creating media asset rows", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const content = "# Scene 3\n\nIndexed copy";
    const contentHash = projectionContentHash(content);
    const revision = {
      schemaVersion: 1,
      kind: "clash.text.revision",
      textId: "text:project-text:script",
      revisionId: "txrev-1234567890abcdef-feedfacecafe",
      parentRevisionId: "txrev-parent",
      projectId: "project-text",
      nodeId: "script",
      createdAt: "2026-07-07T00:00:00.000Z",
      contentHash,
      hashAlgorithm: "sha256-64",
      sourceFilePath: "projections/text/script.md",
      sourceFileHash: contentHash,
      actor: { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" },
    };

    const registered = await app.request("/api/v1/text-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, content }),
    });
    expect(registered.status).toBe(200);
    const registeredJson = await registered.json();
    expect(registeredJson).toMatchObject({
      revision,
      content: {
        kind: "text-revision-content",
        stored: true,
        contentHash,
        mediaType: "text/markdown",
        url: `/api/v1/projects/project-text/text-revisions/${revision.revisionId}/content`,
        immutable: true,
        storage: {
          kind: "content-addressed-revision-blob",
          registry: "text_revisions",
          mediaAsset: false,
          agentWritable: false,
        },
      },
      mutation: {
        operation: "text_revision_index",
        entity: { kind: "text", id: "project-text:script" },
        resultEntityId: revision.revisionId,
        accepted: true,
      },
    });

    const listed = await app.request("/api/v1/projects/project-text/text-revisions?nodeId=script");
    expect(await listed.json()).toEqual({
      revisions: [{
        ...revision,
        content: {
          kind: "text-revision-content",
          stored: true,
          contentHash,
          mediaType: "text/markdown",
          url: `/api/v1/projects/project-text/text-revisions/${revision.revisionId}/content`,
          immutable: true,
          storage: {
            kind: "content-addressed-revision-blob",
            registry: "text_revisions",
            mediaAsset: false,
            agentWritable: false,
          },
        },
      }],
    });

    const contentResponse = await app.request(registeredJson.content.url);
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toContain("text/markdown");
    expect(contentResponse.headers.get("x-clash-content-hash")).toBe(contentHash);
    expect(await contentResponse.text()).toBe(content);

    const blobPath = join(dataDir, "text-revision-blobs", contentHash.slice(0, 2), `${contentHash}.md`);
    expect(await readFile(blobPath, "utf8")).toBe(content);
    expect((await stat(blobPath)).mode & 0o777).toBe(0o444);

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select count(*) as count from text_revisions").get()).toEqual({ count: 1 });
      expect(sqlite.prepare("select count(*) as count from assets").get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it("rejects text revision content whose hash does not match the revision", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const revision = {
      schemaVersion: 1,
      kind: "clash.text.revision",
      textId: "text:project-text:script",
      revisionId: "txrev-1234567890abcdef-badcontent",
      projectId: "project-text",
      nodeId: "script",
      createdAt: "2026-07-07T00:00:00.000Z",
      contentHash: "1234567890abcdef",
      hashAlgorithm: "sha256-64",
      sourceFilePath: "projections/text/script.md",
      sourceFileHash: "1234567890abcdef",
    };

    const registered = await app.request("/api/v1/text-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, content: "different content" }),
    });

    expect(registered.status).toBe(400);
    expect(await registered.json()).toMatchObject({
      error: "text revision contentHash does not match content",
      mutation: {
        operation: "text_revision_index",
        accepted: false,
        error: "text revision contentHash does not match content",
      },
    });

    const listed = await app.request("/api/v1/projects/project-text/text-revisions?nodeId=script");
    expect(await listed.json()).toEqual({ revisions: [] });
    await expect(stat(join(dataDir, "text-revision-blobs", "12", "1234567890abcdef.md")))
      .rejects.toMatchObject({ code: "ENOENT" });

    const sqlite = openSqlite();
    try {
      const audit = sqlite.prepare(`
        select operation, entity_kind, entity_id, accepted, reason, error, mutation_json
          from mutation_audit
         where operation = ?
      `).get("text_revision_index");
      expect(audit).toMatchObject({
        operation: "text_revision_index",
        entity_kind: "text",
        entity_id: "project-text:script",
        accepted: 0,
        reason: "text revision rejected",
        error: "text revision contentHash does not match content",
      });
      expect(JSON.parse(String(audit?.mutation_json))).toMatchObject({
        operation: "text_revision_index",
        accepted: false,
        error: "text revision contentHash does not match content",
      });
    } finally {
      sqlite.close();
    }
  });

  it("does not leave a text content blob when revision metadata conflicts", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const initialContent = "Initial script\n";
    const initialHash = projectionContentHash(initialContent);
    const revision = {
      schemaVersion: 1,
      kind: "clash.text.revision",
      textId: "text:project-text:script",
      revisionId: "txrev-conflict-1234567890abcdef",
      projectId: "project-text",
      nodeId: "script",
      createdAt: "2026-07-07T00:00:00.000Z",
      contentHash: initialHash,
      hashAlgorithm: "sha256-64",
      sourceFilePath: "projections/text/script.md",
      sourceFileHash: initialHash,
    };
    const created = await app.request("/api/v1/text-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, content: initialContent }),
    });
    expect(created.status).toBe(200);

    const conflictingContent = "Rejected script body\n";
    const conflictingHash = projectionContentHash(conflictingContent);
    const rejected = await app.request("/api/v1/text-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        revision: {
          ...revision,
          nodeId: "other-script",
          contentHash: conflictingHash,
          sourceFileHash: conflictingHash,
        },
        content: conflictingContent,
      }),
    });

    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({
      error: expect.stringContaining("already exists with different metadata"),
      mutation: {
        operation: "text_revision_index",
        accepted: false,
      },
    });
    await expect(stat(join(dataDir, "text-revision-blobs", conflictingHash.slice(0, 2), `${conflictingHash}.md`)))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not expose a duplicate SQLite Timeline revision surface", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const create = await app.request("/api/v1/timeline-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision: {} }),
    });
    const list = await app.request("/api/v1/projects/project-timeline/timeline-revisions");
    const content = await app.request(
      "/api/v1/projects/project-timeline/timeline-revisions/old/content",
    );

    expect(create.status).toBe(404);
    expect(list.status).toBe(404);
    expect(content.status).toBe(404);

    const sqlite = openSqlite();
    try {
      expect(
        sqlite.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'timeline_revisions'",
        ).get(),
      ).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });

  it("rejects asset create paths that escape local asset storage", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const invalidSource = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-paths", kind: "image", srcR2Key: "../outside.png" }),
    });
    expect(invalidSource.status).toBe(400);
    expect(await invalidSource.json()).toMatchObject({
      error: "Invalid asset storage key",
      mutation: {
        operation: "asset_create",
        entity: { kind: "asset", id: "" },
        accepted: false,
      },
    });

    const invalidCover = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-paths",
        kind: "image",
        srcR2Key: "uploads/source.png",
        coverR2Key: "../cover.png",
      }),
    });
    expect(invalidCover.status).toBe(400);
    expect(await invalidCover.json()).toMatchObject({
      error: "Invalid asset storage key",
      mutation: {
        operation: "asset_create",
        entity: { kind: "asset", id: "" },
        accepted: false,
      },
    });

    await expect(stat(join(dataDir, "local.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires projectId when removing an asset reference", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({ projectId: "project-a", kind: "image", srcR2Key: "uploads/shared.png" }),
    });
    const { id: assetId, mutation: createMutation } = await created.json() as { id: string; mutation?: unknown };
    expect(createMutation).toEqual({
      operation: "asset_create",
      entity: { kind: "asset", id: assetId },
      resultEntityId: assetId,
      accepted: true,
    });
    const createAudit = await app.request(`/api/v1/mutation-audit?operation=asset_create&entityId=${encodeURIComponent(assetId)}`);
    expect(createAudit.status).toBe(200);
    const createAuditJson = await createAudit.json() as { records: Array<{ actorClientType?: string; mutation?: any }> };
    const agentCreateAuditRecord = createAuditJson.records.find((record) => record.actorClientType === "agent");
    expect(agentCreateAuditRecord).toMatchObject({
      operation: "asset_create",
      entity: { kind: "asset", id: assetId },
      actorClientType: "agent",
      accepted: true,
      reason: "asset create",
      resultEntityId: assetId,
    });
    expect(JSON.stringify(agentCreateAuditRecord?.mutation ?? {})).not.toContain("receipt");
    expect(agentCreateAuditRecord?.mutation).not.toHaveProperty("expectedReadToken");
    expect(agentCreateAuditRecord?.mutation).not.toHaveProperty("beforeReadToken");
    expect(agentCreateAuditRecord?.mutation).not.toHaveProperty("afterReadToken");

    let projectAReadToken = "";
    const sqlite = openSqlite();
    try {
      sqlite.prepare(`
        INSERT OR REPLACE INTO asset_refs (asset_id, project_id, imported_at)
        VALUES (?, ?, ?)
      `).run(assetId, "project-b", 123);
      const projectARef = sqlite.prepare(`
        SELECT asset_id, project_id, imported_at
        FROM asset_refs
        WHERE asset_id = ? AND project_id = ?
      `).get(assetId, "project-a") as { asset_id: string; project_id: string; imported_at: number } | undefined;
      expect(projectARef).toBeTruthy();
      projectAReadToken = assetRefReadToken({
        assetId: projectARef!.asset_id,
        projectId: projectARef!.project_id,
        importedAt: projectARef!.imported_at,
      });
    } finally {
      sqlite.close();
    }

    const missingProject = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref`, {
      method: "DELETE",
    });
    expect(missingProject.status).toBe(400);
    expect(await missingProject.json()).toEqual({
      error: "Missing projectId",
      mutation: {
        operation: "asset_ref_delete",
        entity: { kind: "asset-ref", id: `${assetId}:` },
        accepted: false,
        error: "Missing projectId",
      },
    });

    const missingRead = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=project-a`, {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missingRead.status).toBe(409);
    expect(await missingRead.json()).toMatchObject({
      error: expect.stringContaining("Missing asset-ref delete read proof for agent"),
      mutation: {
        operation: "asset_ref_delete",
        entity: { kind: "asset-ref", id: `${assetId}:project-a` },
        beforeReadToken: projectAReadToken,
        accepted: false,
      },
    });

    const read = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=project-a`);
    expect(read.status).toBe(200);
    const readJson = await read.json() as { readToken: string };
    expect(readJson.readToken).toMatch(ASSET_REF_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(readJson.readToken)).toBe(projectAReadToken);

    const syntheticCasOnly = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=project-a`, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": projectAReadToken,
      },
    });
    expect(syntheticCasOnly.status).toBe(409);
    expect(await syntheticCasOnly.json()).toMatchObject({
      error: expect.stringContaining("Missing asset-ref delete read receipt for agent"),
      mutation: {
        operation: "asset_ref_delete",
        entity: { kind: "asset-ref", id: `${assetId}:project-a` },
        expectedReadToken: projectAReadToken,
        beforeReadToken: projectAReadToken,
        accepted: false,
      },
    });

    const removed = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=project-a`, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": readJson.readToken,
      },
    });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({
      deleted: true,
      mutation: {
        operation: "asset_ref_delete",
        entity: { kind: "asset-ref", id: `${assetId}:project-a` },
        expectedReadToken: readJson.readToken,
        beforeReadToken: projectAReadToken,
        resultEntityId: `${assetId}:project-a`,
        accepted: true,
      },
    });
    const audit = await app.request(`/api/v1/mutation-audit?operation=asset_ref_delete&entityId=${encodeURIComponent(`${assetId}:project-a`)}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "asset_ref_delete",
      entity: { kind: "asset-ref", id: `${assetId}:project-a` },
      accepted: true,
      actorClientType: "agent",
      reason: "asset ref delete",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();

    const check = openSqlite();
    try {
      expect(check.prepare("select id from assets where id = ?").get(assetId)).toMatchObject({ id: assetId });
      expect(
        check.prepare("select project_id from asset_refs where asset_id = ? order by project_id").all(assetId),
      ).toEqual([{ project_id: "project-b" }]);
    } finally {
      check.close();
    }
  });

  it("records mutation envelopes when patching asset covers", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-cover", kind: "image", srcR2Key: "uploads/cover-source.png" }),
    });
    const { id: assetId } = await created.json() as { id: string };

    const patched = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverR2Key: "uploads/cover.png" }),
    });
    expect(patched.status).toBe(200);
    const patchedJson = await patched.json() as { readToken: string; mutation?: any };
    expect(patchedJson.readToken).toMatch(ASSET_RECEIPT_READ_TOKEN_RE);
    expect(patchedJson).toMatchObject({
      ok: true,
      mutation: {
        operation: "asset_cover_update",
        entity: { kind: "asset", id: assetId },
        afterReadToken: patchedJson.readToken,
        resultEntityId: assetId,
        accepted: true,
      },
    });

    const missingRead = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({ coverR2Key: "uploads/agent-no-read.png" }),
    });
    expect(missingRead.status).toBe(409);
    expect(await missingRead.json()).toMatchObject({
      error: expect.stringContaining("Missing asset update read proof for agent"),
      mutation: {
        operation: "asset_cover_update",
        entity: { kind: "asset", id: assetId },
        beforeReadToken: baseReadToken(patchedJson.readToken),
        accepted: false,
      },
    });

    const fetched = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}`);
    expect(fetched.status).toBe(200);
    const fetchedJson = await fetched.json() as Asset & { readToken: string };
    const bareReadToken = assetReadToken(fetchedJson);
    expect(fetchedJson.readToken).toMatch(ASSET_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(fetchedJson.readToken)).toBe(bareReadToken);

    const syntheticCasOnly = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": bareReadToken,
      },
      body: JSON.stringify({ coverR2Key: "uploads/agent-synthetic.png" }),
    });
    expect(syntheticCasOnly.status).toBe(409);
    expect(await syntheticCasOnly.json()).toMatchObject({
      error: expect.stringContaining("Missing asset update read receipt for agent"),
      mutation: {
        operation: "asset_cover_update",
        entity: { kind: "asset", id: assetId },
        expectedReadToken: bareReadToken,
        beforeReadToken: bareReadToken,
        accepted: false,
      },
    });

    const agentPatched = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": fetchedJson.readToken,
      },
      body: JSON.stringify({ coverR2Key: "uploads/agent-cover.png" }),
    });
    expect(agentPatched.status).toBe(200);
    const agentPatchedJson = await agentPatched.json() as { readToken: string; mutation?: any };
    expect(agentPatchedJson.readToken).toMatch(ASSET_RECEIPT_READ_TOKEN_RE);
    expect(agentPatchedJson.mutation).toMatchObject({
      operation: "asset_cover_update",
      entity: { kind: "asset", id: assetId },
      expectedReadToken: fetchedJson.readToken,
      beforeReadToken: bareReadToken,
      afterReadToken: agentPatchedJson.readToken,
      resultEntityId: assetId,
      accepted: true,
    });

    const audit = await app.request(`/api/v1/mutation-audit?operation=asset_cover_update&entityId=${encodeURIComponent(assetId)}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ actorClientType?: string; mutation?: any }> };
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(agentAuditRecord).toMatchObject({
      operation: "asset_cover_update",
      entity: { kind: "asset", id: assetId },
      actorClientType: "agent",
      accepted: true,
      reason: "asset cover update",
      resultEntityId: assetId,
    });
    expect(JSON.stringify(agentAuditRecord?.mutation ?? {})).not.toContain("receipt");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("expectedReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("beforeReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("afterReadToken");

    const missingCover = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingCover.status).toBe(400);
    expect(await missingCover.json()).toEqual({
      error: "Missing coverR2Key",
      mutation: {
        operation: "asset_cover_update",
        entity: { kind: "asset", id: assetId },
        accepted: false,
        error: "Missing coverR2Key",
      },
    });

    const missingAsset = await app.request("/api/v1/assets/missing-asset/cover", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverR2Key: "uploads/cover.png" }),
    });
    expect(missingAsset.status).toBe(404);
    expect(await missingAsset.json()).toEqual({
      error: "not found",
      mutation: {
        operation: "asset_cover_update",
        entity: { kind: "asset", id: "missing-asset" },
        accepted: false,
        error: "not found",
      },
    });
  });

  it("rejects asset cover updates that escape local asset storage", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-cover-paths", kind: "image", srcR2Key: "uploads/source.png" }),
    });
    const { id: assetId } = await created.json() as { id: string };

    const patched = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/cover`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ coverR2Key: "../outside-cover.png" }),
    });
    expect(patched.status).toBe(400);
    expect(await patched.json()).toMatchObject({
      error: "Invalid asset storage key",
      mutation: {
        operation: "asset_cover_update",
        entity: { kind: "asset", id: assetId },
        accepted: false,
      },
    });

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select cover_r2_key from assets where id = ?").get(assetId)).toEqual({
        cover_r2_key: null,
      });
    } finally {
      sqlite.close();
    }
  });

  it("creates copy-on-write edit assets with implicit edit-source lineage", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const sourceResponse = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-edit", kind: "image", srcR2Key: "uploads/source.png" }),
    });
    const source = await sourceResponse.json() as { id: string };
    const form = new FormData();
    form.set("file", new File([new Uint8Array([1, 2, 3])], "edit.png", { type: "image/png" }));
    form.set("projectId", "project-edit");
    form.set("sourceAssetId", source.id);
    form.set("editKind", "image-editor");
    form.set("outputKind", "image");
    form.set("editParams", JSON.stringify({ rotation: 90 }));
    form.set("origin", "asset-preview");
    form.set("invocation", JSON.stringify({
      actionId: "image-editor",
      projectId: "project-edit",
      source: { assetId: source.id, kind: "image" },
      params: { rotation: 90 },
      surface: "asset-preview",
      mode: "implicit",
    }));

    const editedResponse = await app.request("/api/v1/edits", { method: "POST", body: form });
    expect(editedResponse.status).toBe(200);
    const edited = await editedResponse.json() as { assetId: string; srcR2Key: string };
    expect(edited.assetId).not.toBe(source.id);
    expect(edited.srcR2Key).toMatch(/^projects\/project-edit\/edits\/.+\.png$/);

    const read = await app.request(`/api/v1/assets/${edited.assetId}`);
    expect(await read.json()).toMatchObject({
      id: edited.assetId,
      sourceModel: "implicit:image-editor",
      sourceTaskId: null,
      sources: [{ assetId: source.id, role: "edit-source" }],
      metadata: expect.objectContaining({
        actionInvocation: expect.objectContaining({
          actionId: "image-editor",
          mode: "implicit",
          surface: "asset-preview",
        }),
      }),
    });
  });

  it("registers content-addressed local blobs as SQLite assets and project refs", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-clash-home-"));
    const contentHash = "b".repeat(64);
    const blobKey = `blobs/${contentHash}/original.png`;
    const blobPath = join(clashRoot, "assets", blobKey);
    await mkdir(join(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, "asset-bytes", "utf8");
    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });

    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({
        projectId: "project-local-asset",
        kind: "image",
        assetId: `local:sha256:${contentHash}`,
        contentHash,
        localBlobKey: blobKey,
        bytes: 11,
        contentType: "image/png",
        originalName: "hero.png",
      }),
    });

    expect(imported.status).toBe(200);
    const importedJson = await imported.json() as {
      id: string;
      srcR2Key: string;
      signedUrl: string;
      mutation: unknown;
    };
    expect(importedJson).toMatchObject({
      id: `local:sha256:${contentHash}`,
      srcR2Key: `local-blobs/${contentHash}/original.png`,
      mutation: {
        operation: "asset_import",
        entity: { kind: "asset", id: `local:sha256:${contentHash}` },
        resultEntityId: `local:sha256:${contentHash}`,
        accepted: true,
      },
    });
    expect(importedJson.signedUrl).toContain(`/assets/local-blobs/${contentHash}/original.png`);

    const audit = await app.request(`/api/v1/mutation-audit?operation=asset_import&entityId=${encodeURIComponent(importedJson.id)}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ actorClientType?: string; mutation?: any }> };
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(agentAuditRecord).toMatchObject({
      operation: "asset_import",
      entity: { kind: "asset", id: importedJson.id },
      actorClientType: "agent",
      accepted: true,
      reason: "asset import",
      resultEntityId: importedJson.id,
    });
    expect(JSON.stringify(agentAuditRecord?.mutation ?? {})).not.toContain("receipt");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("expectedReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("beforeReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("afterReadToken");

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select id, src_r2_key, project_id from assets where id = ?").get(importedJson.id)).toEqual({
        id: importedJson.id,
        src_r2_key: `local-blobs/${contentHash}/original.png`,
        project_id: null,
      });
      expect(
        sqlite.prepare("select asset_id, project_id from asset_refs where asset_id = ?").get(importedJson.id),
      ).toEqual({
        asset_id: importedJson.id,
        project_id: "project-local-asset",
      });
    } finally {
      sqlite.close();
    }

    const fetchedAsset = await app.request(`/api/v1/assets/${encodeURIComponent(importedJson.id)}`);
    expect(fetchedAsset.status).toBe(200);
    expect(await fetchedAsset.json()).toMatchObject({
      id: importedJson.id,
      metadata: {
        bytes: 11,
        contentType: "image/png",
        contentHash,
        localBlobKey: blobKey,
        originalName: "hero.png",
      },
    });

    const bytes = await app.request(`/assets/local-blobs/${contentHash}/original.png`);
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("asset-bytes");
  });

  it("rejects reimporting an existing asset id with different local blob identity", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-immutable-asset-home-"));
    const firstHash = "c".repeat(64);
    const secondHash = "d".repeat(64);
    const firstBlobKey = `blobs/${firstHash}/original.png`;
    const secondBlobKey = `blobs/${secondHash}/original.png`;
    const firstBlobPath = join(clashRoot, "assets", firstBlobKey);
    const secondBlobPath = join(clashRoot, "assets", secondBlobKey);
    await mkdir(join(firstBlobPath, ".."), { recursive: true });
    await mkdir(join(secondBlobPath, ".."), { recursive: true });
    await writeFile(firstBlobPath, "first-asset-bytes", "utf8");
    await writeFile(secondBlobPath, "second-asset-bytes", "utf8");
    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const assetId = `local:sha256:${firstHash}`;

    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-one",
        kind: "image",
        assetId,
        contentHash: firstHash,
        localBlobKey: firstBlobKey,
        contentType: "image/png",
      }),
    });
    expect(imported.status).toBe(200);

    const conflicting = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-two",
        kind: "image",
        assetId,
        contentHash: secondHash,
        localBlobKey: secondBlobKey,
        contentType: "image/png",
      }),
    });
    expect(conflicting.status).toBe(409);
    expect(await conflicting.json()).toMatchObject({
      error: expect.stringContaining("Asset id already exists with different immutable content"),
      mutation: {
        operation: "asset_import",
        entity: { kind: "asset", id: assetId },
        accepted: false,
        error: expect.stringContaining("Asset id already exists with different immutable content"),
      },
    });

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select src_r2_key, kind from assets where id = ?").get(assetId)).toEqual({
        src_r2_key: `local-blobs/${firstHash}/original.png`,
        kind: "image",
      });
      expect(sqlite.prepare("select count(*) as count from asset_refs where asset_id = ?").get(assetId)).toEqual({
        count: 1,
      });
    } finally {
      sqlite.close();
    }
  });

  it("creates copy-on-write media replacement nodes from registered local assets with read proof", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-asset-replace-home-"));
    const projectId = "project-asset-replace";
    const sourceAssetId = "asset-original";
    const replacementHash = "a".repeat(64);
    const replacementAssetId = `local:sha256:${replacementHash}`;
    const blobKey = `blobs/${replacementHash}/original.png`;
    const blobPath = join(clashRoot, "assets", blobKey);
    await mkdir(join(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, "replacement-bytes", "utf8");

    const doc = new LoroDoc();
    doc.getMap("nodes").set("image-source", {
      type: "image",
      data: {
        label: "Hero",
        assetId: sourceAssetId,
        status: "completed",
      },
    });
    await new FileReplicaStore(join(dataDir, "projects")).saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        kind: "image",
        assetId: replacementAssetId,
        contentHash: replacementHash,
        localBlobKey: blobKey,
      }),
    });
    expect(imported.status).toBe(200);

    const missingRead = await app.request("/api/v1/assets/replace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        nodeId: "image-source",
        assetId: replacementAssetId,
        actorClientType: "agent",
      }),
    });
    expect(missingRead.status).toBe(409);
    expect(await missingRead.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas update read proof"),
      mutation: {
        operation: "asset_cow_replace",
        entity: { kind: "media-node", id: "image-source" },
        beforeReadToken: expect.stringMatching(/^node-v1:/),
        accepted: false,
      },
    });

    const current = await new FileReplicaStore(join(dataDir, "projects")).recover(projectId);
    const readToken = await app.request("/api/v1/assets/replace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        nodeId: "image-source",
        assetId: replacementAssetId,
        ifMatch: "stale-token",
        actorClientType: "agent",
      }),
    });
    expect(readToken.status).toBe(409);

    const currentNode = new Canvas(current, () => {}).readNode("image-source");
    expect(currentNode).toBeTruthy();
    const freshReadToken = canvasNodeReadToken(currentNode!);

    const syntheticCasOnly = await app.request("/api/v1/assets/replace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        nodeId: "image-source",
        assetId: replacementAssetId,
        ifMatch: freshReadToken,
        actorClientType: "agent",
        newNodeId: "image-synthetic",
      }),
    });
    expect(syntheticCasOnly.status).toBe(409);
    expect(await syntheticCasOnly.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas update read receipt for agent"),
      mutation: {
        operation: "asset_cow_replace",
        entity: { kind: "media-node", id: "image-source" },
        expectedReadToken: freshReadToken,
        beforeReadToken: freshReadToken,
        accepted: false,
      },
    });
    const rejectedAudit = await app.request("/api/v1/mutation-audit?operation=asset_cow_replace&entityId=image-source");
    expect(rejectedAudit.status).toBe(200);
    const rejectedAuditJson = await rejectedAudit.json() as { records: Array<any> };
    const rejectedRecord = rejectedAuditJson.records.find((record) => record.accepted === false);
    expect(rejectedRecord).toMatchObject({
      operation: "asset_cow_replace",
      entity: { kind: "media-node", id: "image-source" },
      actorClientType: "agent",
      accepted: false,
      reason: "asset copy-on-write replacement rejected",
      error: expect.stringContaining("Missing canvas update read receipt for agent"),
    });
    expect(rejectedRecord.mutation.expectedReadToken).toBeUndefined();
    expect(rejectedRecord.mutation.beforeReadToken).toBeUndefined();
    expect(rejectedRecord.mutation.afterReadToken).toBeUndefined();

    const read = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/image-source`);
    expect(read.status).toBe(200);
    const readJson = await read.json() as { readToken: string };
    expect(readJson.readToken).toMatch(NODE_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(readJson.readToken)).toBe(freshReadToken);

    const replaced = await app.request("/api/v1/assets/replace", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        nodeId: "image-source",
        assetId: replacementAssetId,
        ifMatch: readJson.readToken,
        actorClientType: "agent",
        newNodeId: "image-replacement",
        label: "Hero replacement",
      }),
    });
    expect(replaced.status).toBe(200);
    const replacedJson = await replaced.json() as { readToken: string; mutation?: any };
    expect(replacedJson.readToken).toMatch(NODE_RECEIPT_READ_TOKEN_RE);
    expect(replacedJson).toMatchObject({
      replaced: true,
      copyOnWrite: true,
      sourceNodeId: "image-source",
      newNodeId: "image-replacement",
      assetId: replacementAssetId,
      sourceAssetId,
      lineageEdge: { source: "image-source", target: "image-replacement", type: "copy-on-write" },
      mutation: {
        operation: "asset_cow_replace",
        entity: { kind: "media-node", id: "image-source" },
        expectedReadToken: readJson.readToken,
        beforeReadToken: freshReadToken,
        afterReadToken: replacedJson.readToken,
        accepted: true,
        resultEntityId: "image-replacement",
      },
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=asset_cow_replace&entityId=image-source");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    const acceptedRecord = auditJson.records.find((record) => record.accepted === true);
    expect(acceptedRecord).toMatchObject({
      operation: "asset_cow_replace",
      entity: { kind: "media-node", id: "image-source" },
      actorClientType: "agent",
      accepted: true,
      reason: "asset copy-on-write replacement",
      resultEntityId: "image-replacement",
    });
    expect(JSON.stringify(acceptedRecord.mutation ?? {})).not.toContain("receipt");
    expect(acceptedRecord.mutation.expectedReadToken).toBeUndefined();
    expect(acceptedRecord.mutation.beforeReadToken).toBeUndefined();
    expect(acceptedRecord.mutation.afterReadToken).toBeUndefined();

    const recovered = await new FileReplicaStore(join(dataDir, "projects")).recover(projectId);
    const canvas = recovered.getMap("nodes");
    expect((canvas.get("image-source") as any).data.assetId).toBe(sourceAssetId);
    expect((canvas.get("image-replacement") as any).data).toMatchObject({
      label: "Hero replacement",
      assetId: replacementAssetId,
      copyOnWrite: true,
      copyOnWriteKind: "media-asset-replacement",
      sourceMediaNodeId: "image-source",
      sourceAssetId,
    });
    const edges = new Canvas(recovered, () => {}).listEdges();
    expect(edges.find((edge) => edge.id === "image-source-image-replacement")).toMatchObject({
      source: "image-source",
      target: "image-replacement",
      type: "copy-on-write",
    });
  });

  it("requires receipt-bearing canvas node reads before agent node writes", async () => {
    const projectId = "project-node-cas";
    const doc = new LoroDoc();
    doc.getMap("nodes").set("script", {
      type: "text",
      data: { label: "Script", content: "before" },
    });
    doc.getMap("nodes").set("action", {
      type: "image_gen",
      data: { prompt: "Use script", status: "completed" },
    });
    doc.getMap("nodes").set("output", {
      type: "image",
      data: { assetId: "asset-output", status: "completed" },
    });
    doc.getMap("nodes").set("loose", {
      type: "text",
      data: { label: "Loose", content: "draft" },
    });
    doc.getMap("edges").set("script-action", {
      source: "script",
      target: "action",
      type: "reference",
    });
    doc.getMap("edges").set("action-output", {
      source: "action",
      target: "output",
      type: "materialized",
    });
    await new FileReplicaStore(join(dataDir, "projects")).saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const scriptBaseToken = canvasNodeReadToken(new Canvas(doc, () => {}).readNode("script")!);

    const bareUpdate = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/script`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "after",
        actorClientType: "agent",
        ifMatch: scriptBaseToken,
      }),
    });
    expect(bareUpdate.status).toBe(409);
    expect(await bareUpdate.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas update read receipt for agent"),
      mutation: {
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: "script" },
        expectedReadToken: scriptBaseToken,
        beforeReadToken: scriptBaseToken,
        accepted: false,
      },
    });

    const scriptRead = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/script`);
    expect(scriptRead.status).toBe(200);
    const scriptReadJson = await scriptRead.json() as { readToken: string };
    expect(scriptReadJson.readToken).toMatch(NODE_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(scriptReadJson.readToken)).toBe(scriptBaseToken);

    const blockedContentPatch = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/script`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "after",
        actorClientType: "agent",
        ifMatch: scriptReadJson.readToken,
      }),
    });
    expect(blockedContentPatch.status).toBe(409);
    expect(await blockedContentPatch.json()).toMatchObject({
      error: expect.stringContaining("Refusing to patch referenced text content"),
      mutation: {
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: "script" },
        expectedReadToken: scriptReadJson.readToken,
        beforeReadToken: scriptBaseToken,
        accepted: false,
      },
    });

    const looseRead = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/loose`);
    expect(looseRead.status).toBe(200);
    const looseReadJson = await looseRead.json() as { readToken: string };
    expect(looseReadJson.readToken).toMatch(NODE_RECEIPT_READ_TOKEN_RE);

    const updated = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/loose`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "Loose v2",
        content: "after",
        actorClientType: "agent",
        ifMatch: looseReadJson.readToken,
      }),
    });
    expect(updated.status).toBe(200);
    const updatedJson = await updated.json() as { readToken: string; node?: { data?: Record<string, unknown> }; mutation?: any };
    expect(updatedJson.readToken).toMatch(NODE_RECEIPT_READ_TOKEN_RE);
    expect(updatedJson.readToken).not.toBe(looseReadJson.readToken);
    expect(updatedJson).toMatchObject({
      updated: true,
      nodeId: "loose",
      node: { data: { label: "Loose v2", content: "after" } },
      mutation: {
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: "loose" },
        expectedReadToken: looseReadJson.readToken,
        beforeReadToken: baseReadToken(looseReadJson.readToken),
        afterReadToken: updatedJson.readToken,
        accepted: true,
        resultEntityId: "loose",
      },
    });

    const staleUpdate = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/loose`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        label: "stale",
        actorClientType: "agent",
        ifMatch: looseReadJson.readToken,
      }),
    });
    expect(staleUpdate.status).toBe(409);
    expect(await staleUpdate.json()).toMatchObject({
      error: expect.stringContaining("Stale canvas update rejected"),
      mutation: {
        operation: "canvas_update",
        entity: { kind: "canvas-node", id: "loose" },
        expectedReadToken: looseReadJson.readToken,
        beforeReadToken: baseReadToken(updatedJson.readToken),
        accepted: false,
      },
    });

    const referencedDelete = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/script`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorClientType: "agent",
        ifMatch: scriptReadJson.readToken,
      }),
    });
    expect(referencedDelete.status).toBe(409);
    expect(await referencedDelete.json()).toMatchObject({
      error: expect.stringContaining("Refusing to delete referenced node script"),
      mutation: {
        operation: "canvas_delete",
        entity: { kind: "canvas-node", id: "script" },
        expectedReadToken: scriptReadJson.readToken,
        beforeReadToken: scriptBaseToken,
        accepted: false,
      },
    });

    const bareDelete = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/loose`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorClientType: "agent",
        ifMatch: baseReadToken(updatedJson.readToken),
      }),
    });
    expect(bareDelete.status).toBe(409);
    expect(await bareDelete.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas delete read receipt for agent"),
      mutation: {
        operation: "canvas_delete",
        entity: { kind: "canvas-node", id: "loose" },
        expectedReadToken: baseReadToken(updatedJson.readToken),
        beforeReadToken: baseReadToken(updatedJson.readToken),
        accepted: false,
      },
    });

    const deleted = await app.request(`/api/v1/projects/${projectId}/canvas/nodes/loose`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorClientType: "agent",
        ifMatch: updatedJson.readToken,
      }),
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      deleted: true,
      nodeId: "loose",
      mutation: {
        operation: "canvas_delete",
        entity: { kind: "canvas-node", id: "loose" },
        expectedReadToken: updatedJson.readToken,
        beforeReadToken: baseReadToken(updatedJson.readToken),
        accepted: true,
        resultEntityId: "loose",
      },
    });

    const updateAudit = await app.request("/api/v1/mutation-audit?operation=canvas_update&entityId=loose");
    expect(updateAudit.status).toBe(200);
    const updateAuditJson = await updateAudit.json() as { records: Array<{ mutation?: unknown }> };
    expect(updateAuditJson.records).toHaveLength(1);
    expect(updateAuditJson.records[0]).toMatchObject({
      operation: "canvas_update",
      entity: { kind: "canvas-node", id: "loose" },
      accepted: true,
      actorClientType: "agent",
      reason: "canvas node update",
    });
    expect(JSON.stringify(updateAuditJson.records[0].mutation)).not.toContain("receipt");
    expect(updateAuditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(updateAuditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
    expect(updateAuditJson.records[0].mutation).not.toHaveProperty("afterReadToken");

    const deleteAudit = await app.request("/api/v1/mutation-audit?operation=canvas_delete&entityId=loose");
    expect(deleteAudit.status).toBe(200);
    const deleteAuditJson = await deleteAudit.json() as { records: Array<{ mutation?: unknown }> };
    expect(deleteAuditJson.records).toHaveLength(1);
    expect(deleteAuditJson.records[0]).toMatchObject({
      operation: "canvas_delete",
      entity: { kind: "canvas-node", id: "loose" },
      accepted: true,
      actorClientType: "agent",
      reason: "canvas node delete",
    });
    expect(JSON.stringify(deleteAuditJson.records[0].mutation)).not.toContain("receipt");
    expect(deleteAuditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(deleteAuditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
    expect(deleteAuditJson.records[0].mutation).not.toHaveProperty("afterReadToken");

    const recovered = await new FileReplicaStore(join(dataDir, "projects")).recover(projectId);
    const canvas = new Canvas(recovered, () => {});
    expect(canvas.readNode("script")?.data.content).toBe("before");
    expect(canvas.readNode("loose")).toBeNull();
  });

  it("requires graph-aware canvas batch delete receipts before agent batch deletes", async () => {
    const projectId = "project-batch-delete-cas";
    const replica = new FileReplicaStore(join(dataDir, "projects"));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("root", { type: "text", data: { label: "Root" } });
    doc.getMap("nodes").set("child", { type: "image_gen", data: { prompt: "Child", status: "completed" } });
    doc.getMap("nodes").set("external", { type: "image", data: { assetId: "external-asset", status: "completed" } });
    doc.getMap("edges").set("root-child", { source: "root", target: "child", type: "reference" });
    doc.getMap("edges").set("child-external", { source: "child", target: "external", type: "materialized" });
    await replica.saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const partialPlanResponse = await app.request(`/api/v1/projects/${projectId}/canvas/delete-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeIds: [" root ", "child", "root"] }),
    });
    expect(partialPlanResponse.status).toBe(200);
    const partialPlan = await partialPlanResponse.json() as {
      nodeIds: string[];
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string; source: string; target: string }>;
      readToken: string;
    };
    const partialBaseToken = canvasBatchDeleteReadToken({ nodes: partialPlan.nodes, edges: partialPlan.edges });
    expect(partialPlan.nodeIds).toEqual(["root", "child"]);
    expect(partialPlan.readToken).toMatch(CANVAS_BATCH_DELETE_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(partialPlan.readToken)).toBe(partialBaseToken);

    const missingReadProof = await app.request(`/api/v1/projects/${projectId}/canvas/delete-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeIds: ["root", "child"],
        actorClientType: "agent",
      }),
    });
    expect(missingReadProof.status).toBe(409);
    expect(await missingReadProof.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas batch delete read proof for agent"),
      mutation: {
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: "root,child" },
        beforeReadToken: partialBaseToken,
        accepted: false,
      },
    });

    const bareCas = await app.request(`/api/v1/projects/${projectId}/canvas/delete-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeIds: ["root", "child"],
        actorClientType: "agent",
        ifMatch: partialBaseToken,
      }),
    });
    expect(bareCas.status).toBe(409);
    expect(await bareCas.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas batch delete read receipt for agent"),
      mutation: {
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: "root,child" },
        expectedReadToken: partialBaseToken,
        beforeReadToken: partialBaseToken,
        accepted: false,
      },
    });

    const orphaningDelete = await app.request(`/api/v1/projects/${projectId}/canvas/delete-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeIds: ["root", "child"],
        actorClientType: "agent",
        ifMatch: partialPlan.readToken,
      }),
    });
    expect(orphaningDelete.status).toBe(409);
    expect(await orphaningDelete.json()).toMatchObject({
      error: expect.stringContaining("Refusing to delete referenced node(s)"),
      mutation: {
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: "root,child" },
        expectedReadToken: partialPlan.readToken,
        beforeReadToken: partialBaseToken,
        accepted: false,
      },
    });

    const fullPlanResponse = await app.request(`/api/v1/projects/${projectId}/canvas/delete-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeIds: ["root", "child", "external"] }),
    });
    expect(fullPlanResponse.status).toBe(200);
    const fullPlan = await fullPlanResponse.json() as {
      nodeIds: string[];
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string; source: string; target: string }>;
      readToken: string;
    };
    const fullBaseToken = canvasBatchDeleteReadToken({ nodes: fullPlan.nodes, edges: fullPlan.edges });
    expect(fullPlan.readToken).toMatch(CANVAS_BATCH_DELETE_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(fullPlan.readToken)).toBe(fullBaseToken);

    await replica.updateSnapshotAtomic(projectId, (currentDoc) => {
      const canvas = new Canvas(currentDoc, () => {});
      expect(canvas.updateNode("external", { label: "Concurrent change" })).toBe(true);
      return { value: null };
    });

    const staleDelete = await app.request(`/api/v1/projects/${projectId}/canvas/delete-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeIds: ["root", "child", "external"],
        actorClientType: "agent",
        ifMatch: fullPlan.readToken,
      }),
    });
    expect(staleDelete.status).toBe(409);
    expect(await staleDelete.json()).toMatchObject({
      error: expect.stringContaining("Stale canvas batch delete rejected"),
      mutation: {
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: "root,child,external" },
        expectedReadToken: fullPlan.readToken,
        accepted: false,
      },
    });

    const freshPlanResponse = await app.request(`/api/v1/projects/${projectId}/canvas/delete-plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nodeIds: ["root", "child", "external"] }),
    });
    expect(freshPlanResponse.status).toBe(200);
    const freshPlan = await freshPlanResponse.json() as {
      nodes: Array<{ id: string }>;
      edges: Array<{ id: string; source: string; target: string }>;
      readToken: string;
    };
    const freshBaseToken = canvasBatchDeleteReadToken({ nodes: freshPlan.nodes, edges: freshPlan.edges });

    const accepted = await app.request(`/api/v1/projects/${projectId}/canvas/delete-batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        nodeIds: ["root", "child", "external"],
        actorClientType: "agent",
        ifMatch: freshPlan.readToken,
      }),
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as {
      nodeIds: string[];
      deletedNodeIds: string[];
      deletedEdgeIds: string[];
      mutation?: any;
    };
    expect(acceptedJson).toMatchObject({
      deleted: true,
      nodeIds: ["root", "child", "external"],
      mutation: {
        operation: "canvas_batch_delete",
        entity: { kind: "canvas-node-batch", id: "root,child,external" },
        expectedReadToken: freshPlan.readToken,
        beforeReadToken: freshBaseToken,
        accepted: true,
        resultEntityId: "root,child,external",
      },
    });
    expect(acceptedJson.deletedNodeIds.sort()).toEqual(["child", "external", "root"]);
    expect(acceptedJson.deletedEdgeIds.sort()).toEqual(["child-external", "root-child"]);

    const audit = await app.request("/api/v1/mutation-audit?operation=canvas_batch_delete&entityId=root,child,external");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ mutation?: unknown }> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "canvas_batch_delete",
      entity: { kind: "canvas-node-batch", id: "root,child,external" },
      accepted: true,
      actorClientType: "agent",
      reason: "canvas batch delete",
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");

    const recovered = await replica.recover(projectId);
    const canvas = new Canvas(recovered, () => {});
    expect(canvas.readNode("root")).toBeNull();
    expect(canvas.readNode("child")).toBeNull();
    expect(canvas.readNode("external")).toBeNull();
    expect(recovered.getMap("edges").get("root-child")).toBeUndefined();
    expect(recovered.getMap("edges").get("child-external")).toBeUndefined();
  });

  it("requires receipt-bearing canvas edge reads before agent edge writes", async () => {
    const projectId = "project-edge-cas";
    const doc = new LoroDoc();
    doc.getMap("nodes").set("node-a", { type: "text", data: { label: "A" } });
    doc.getMap("nodes").set("node-b", { type: "text", data: { label: "B" } });
    doc.getMap("nodes").set("node-c", { type: "text", data: { label: "C" } });
    doc.getMap("edges").set("edge-ab", {
      source: "node-a",
      target: "node-b",
      type: "default",
    });
    await new FileReplicaStore(join(dataDir, "projects")).saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const baseGraphToken = canvasEdgesReadToken([
      { id: "edge-ab", source: "node-a", target: "node-b", type: "default" },
    ]);

    const bareAdd = await app.request(`/api/v1/projects/${projectId}/canvas/edges/edge-bc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "node-b",
        target: "node-c",
        type: "reference",
        actorClientType: "agent",
        ifMatch: baseGraphToken,
      }),
    });
    expect(bareAdd.status).toBe(409);
    expect(await bareAdd.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas edge add read receipt for agent"),
      mutation: {
        operation: "canvas_add_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        expectedReadToken: baseGraphToken,
        beforeReadToken: baseGraphToken,
        accepted: false,
      },
    });

    const listed = await app.request(`/api/v1/projects/${projectId}/canvas/edges`);
    expect(listed.status).toBe(200);
    const listedJson = await listed.json() as {
      readToken: string;
      edges: Array<{ id: string; source: string; target: string; type?: string; readToken: string }>;
    };
    expect(listedJson.readToken).toMatch(EDGES_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(listedJson.readToken)).toBe(baseGraphToken);
    const edgeAb = listedJson.edges.find((edge) => edge.id === "edge-ab");
    expect(edgeAb?.readToken).toMatch(EDGE_RECEIPT_READ_TOKEN_RE);
    expect(baseReadToken(edgeAb!.readToken)).toBe(
      canvasEdgeReadToken({ id: "edge-ab", source: "node-a", target: "node-b", type: "default" }),
    );

    const added = await app.request(`/api/v1/projects/${projectId}/canvas/edges/edge-bc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "node-b",
        target: "node-c",
        type: "reference",
        actorClientType: "agent",
        ifMatch: listedJson.readToken,
      }),
    });
    expect(added.status).toBe(200);
    const addedJson = await added.json() as {
      readToken: string;
      edge: { id: string; source: string; target: string; type?: string; readToken: string };
      mutation?: any;
    };
    expect(addedJson.readToken).toMatch(EDGES_RECEIPT_READ_TOKEN_RE);
    expect(addedJson.edge.readToken).toMatch(EDGE_RECEIPT_READ_TOKEN_RE);
    expect(addedJson).toMatchObject({
      edge: { id: "edge-bc", source: "node-b", target: "node-c", type: "reference" },
      mutation: {
        operation: "canvas_add_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        expectedReadToken: listedJson.readToken,
        beforeReadToken: baseReadToken(listedJson.readToken),
        afterReadToken: addedJson.readToken,
        accepted: true,
        resultEntityId: "edge-bc",
      },
    });
    const addAudit = await app.request(`/api/v1/mutation-audit?operation=canvas_add_edge&entityId=edge-bc`);
    expect(addAudit.status).toBe(200);
    const addAuditJson = await addAudit.json() as { records: Array<{ mutation?: unknown }> };
    expect(addAuditJson.records).toHaveLength(1);
    expect(addAuditJson.records[0]).toMatchObject({
      operation: "canvas_add_edge",
      entity: { kind: "canvas-edge", id: "edge-bc" },
      accepted: true,
      actorClientType: "agent",
      reason: "canvas edge add",
      mutation: {
        operation: "canvas_add_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        resultEntityId: "edge-bc",
        accepted: true,
      },
    });
    expect(JSON.stringify(addAuditJson.records[0].mutation)).not.toContain("receipt");
    expect(addAuditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(addAuditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
    expect(addAuditJson.records[0].mutation).not.toHaveProperty("afterReadToken");

    const bareUpdate = await app.request(`/api/v1/projects/${projectId}/canvas/edges/edge-bc`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "copy-on-write",
        actorClientType: "agent",
        ifMatch: baseReadToken(addedJson.edge.readToken),
      }),
    });
    expect(bareUpdate.status).toBe(409);
    expect(await bareUpdate.json()).toMatchObject({
      error: expect.stringContaining("Missing canvas edge update read receipt for agent"),
      mutation: {
        operation: "canvas_update_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        expectedReadToken: baseReadToken(addedJson.edge.readToken),
        beforeReadToken: baseReadToken(addedJson.edge.readToken),
        accepted: false,
      },
    });

    const updated = await app.request(`/api/v1/projects/${projectId}/canvas/edges/edge-bc`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "copy-on-write",
        actorClientType: "agent",
        ifMatch: addedJson.edge.readToken,
      }),
    });
    expect(updated.status).toBe(200);
    const updatedJson = await updated.json() as {
      readToken: string;
      edge: { id: string; type?: string; readToken: string };
      mutation?: any;
    };
    expect(updatedJson.readToken).toMatch(EDGE_RECEIPT_READ_TOKEN_RE);
    expect(updatedJson.edge.readToken).toBe(updatedJson.readToken);
    expect(updatedJson).toMatchObject({
      edge: { id: "edge-bc", type: "copy-on-write" },
      mutation: {
        operation: "canvas_update_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        expectedReadToken: addedJson.edge.readToken,
        beforeReadToken: baseReadToken(addedJson.edge.readToken),
        afterReadToken: updatedJson.readToken,
        accepted: true,
      },
    });
    const updateAudit = await app.request(`/api/v1/mutation-audit?operation=canvas_update_edge&entityId=edge-bc`);
    expect(updateAudit.status).toBe(200);
    const updateAuditJson = await updateAudit.json() as { records: Array<{ mutation?: unknown }> };
    expect(updateAuditJson.records).toHaveLength(1);
    expect(updateAuditJson.records[0]).toMatchObject({
      operation: "canvas_update_edge",
      entity: { kind: "canvas-edge", id: "edge-bc" },
      accepted: true,
      actorClientType: "agent",
      reason: "canvas edge update",
      mutation: {
        operation: "canvas_update_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        resultEntityId: "edge-bc",
        accepted: true,
      },
    });
    expect(JSON.stringify(updateAuditJson.records[0].mutation)).not.toContain("receipt");
    expect(updateAuditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(updateAuditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
    expect(updateAuditJson.records[0].mutation).not.toHaveProperty("afterReadToken");

    const staleDelete = await app.request(`/api/v1/projects/${projectId}/canvas/edges/edge-bc`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorClientType: "agent",
        ifMatch: addedJson.edge.readToken,
      }),
    });
    expect(staleDelete.status).toBe(409);
    expect(await staleDelete.json()).toMatchObject({
      error: expect.stringContaining("Stale canvas edge delete rejected"),
      mutation: {
        operation: "canvas_delete_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        expectedReadToken: addedJson.edge.readToken,
        beforeReadToken: baseReadToken(updatedJson.readToken),
        accepted: false,
      },
    });

    const deleted = await app.request(`/api/v1/projects/${projectId}/canvas/edges/edge-bc`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        actorClientType: "agent",
        ifMatch: updatedJson.readToken,
      }),
    });
    expect(deleted.status).toBe(200);
    const deletedJson = await deleted.json() as { readToken: string; mutation?: any };
    expect(deletedJson.readToken).toMatch(EDGES_RECEIPT_READ_TOKEN_RE);
    expect(deletedJson.mutation).toMatchObject({
      operation: "canvas_delete_edge",
      entity: { kind: "canvas-edge", id: "edge-bc" },
      expectedReadToken: updatedJson.readToken,
      beforeReadToken: baseReadToken(updatedJson.readToken),
      afterReadToken: deletedJson.readToken,
      accepted: true,
      resultEntityId: "edge-bc",
    });

    const audit = await app.request(`/api/v1/mutation-audit?operation=canvas_delete_edge&entityId=edge-bc`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ mutation?: unknown }> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "canvas_delete_edge",
      entity: { kind: "canvas-edge", id: "edge-bc" },
      accepted: true,
      actorClientType: "agent",
      reason: "canvas edge delete",
      mutation: {
        operation: "canvas_delete_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        resultEntityId: "edge-bc",
        accepted: true,
      },
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("afterReadToken");

    const recovered = await new FileReplicaStore(join(dataDir, "projects")).recover(projectId);
    const recoveredEdges = new Canvas(recovered, () => {}).listEdges();
    expect(recoveredEdges.find((edge) => edge.id === "edge-ab")).toMatchObject({
      source: "node-a",
      target: "node-b",
    });
    expect(recoveredEdges.find((edge) => edge.id === "edge-bc")).toBeUndefined();
  });

  it("garbage collects only unreferenced local content-addressed assets", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-gc-home-"));
    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });

    async function importLocal(hash: string, projectId: string) {
      const blobKey = `blobs/${hash}/original.png`;
      const blobPath = join(clashRoot, "assets", blobKey);
      await mkdir(join(blobPath, ".."), { recursive: true });
      await writeFile(blobPath, `bytes-${hash.slice(0, 4)}`, "utf8");
      const imported = await app.request("/api/v1/assets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          kind: "image",
          assetId: `local:sha256:${hash}`,
          contentHash: hash,
          localBlobKey: blobKey,
          contentType: "image/png",
        }),
      });
      expect(imported.status).toBe(200);
      return { assetId: `local:sha256:${hash}`, blobPath };
    }

    const orphan = await importLocal("c".repeat(64), "project-orphan");
    const live = await importLocal("d".repeat(64), "project-live");
    const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(orphan.assetId)}/ref?projectId=project-orphan`, {
      method: "DELETE",
    });
    expect(removedRef.status).toBe(200);

    const gc = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });

    expect(gc.status).toBe(200);
    expect(await gc.json()).toMatchObject({
      dryRun: false,
      deletedAssets: [{ id: orphan.assetId, srcR2Key: `local-blobs/${"c".repeat(64)}/original.png` }],
      deletedBlobKeys: [`local-blobs/${"c".repeat(64)}/original.png`],
      mutation: {
        operation: "asset_gc",
        entity: { kind: "asset-store", id: "local" },
        resultEntityId: "local",
        accepted: true,
      },
    });

    await expect(stat(orphan.blobPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(live.blobPath)).resolves.toMatchObject({ size: "bytes-dddd".length });

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select id from assets where id = ?").get(orphan.assetId)).toBeUndefined();
      expect(sqlite.prepare("select id from assets where id = ?").get(live.assetId)).toMatchObject({ id: live.assetId });
      expect(sqlite.prepare("select asset_id from asset_refs where asset_id = ?").get(live.assetId)).toMatchObject({
        asset_id: live.assetId,
      });
    } finally {
      sqlite.close();
    }
  });

  it("garbage collection remains idempotent when an orphaned local blob file is already missing", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-gc-missing-home-"));
    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const hash = "8".repeat(64);
    const assetId = `local:sha256:${hash}`;
    const blobKey = `blobs/${hash}/original.png`;
    const blobPath = join(clashRoot, "assets", blobKey);
    await mkdir(join(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, "missing-before-gc", "utf8");

    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-gc-missing",
        kind: "image",
        assetId,
        contentHash: hash,
        localBlobKey: blobKey,
        contentType: "image/png",
      }),
    });
    expect(imported.status).toBe(200);

    const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=project-gc-missing`, {
      method: "DELETE",
    });
    expect(removedRef.status).toBe(200);
    await rm(join(blobPath, ".."), { recursive: true, force: true });

    const gc = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });

    expect(gc.status).toBe(200);
    expect(await gc.json()).toMatchObject({
      deletedAssets: [{ id: assetId, srcR2Key: `local-blobs/${hash}/original.png` }],
      deletedBlobKeys: [`local-blobs/${hash}/original.png`],
      mutation: { operation: "asset_gc", accepted: true },
    });
    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select id from assets where id = ?").get(assetId)).toBeUndefined();
    } finally {
      sqlite.close();
    }
  });

  it("requires a receipt-bearing dry-run read before an agent can garbage collect assets", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-gc-agent-cas-home-"));
    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });

    async function importOrphan(hash: string, projectId: string) {
      const blobKey = `blobs/${hash}/original.png`;
      const blobPath = join(clashRoot, "assets", blobKey);
      await mkdir(join(blobPath, ".."), { recursive: true });
      await writeFile(blobPath, `bytes-${hash.slice(0, 4)}`, "utf8");
      const assetId = `local:sha256:${hash}`;
      const imported = await app.request("/api/v1/assets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          kind: "image",
          assetId,
          contentHash: hash,
          localBlobKey: blobKey,
          contentType: "image/png",
        }),
      });
      expect(imported.status).toBe(200);
      const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${projectId}`, {
        method: "DELETE",
      });
      expect(removedRef.status).toBe(200);
      return { assetId, blobPath };
    }

    const first = await importOrphan("6".repeat(64), "project-gc-agent-first");

    const dryRun = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(dryRun.status).toBe(200);
    const dryRunJson = await dryRun.json() as { readToken: string; deletedAssets: Array<{ id: string }> };
    expect(dryRunJson.readToken).toMatch(ASSET_GC_RECEIPT_READ_TOKEN_RE);
    expect(dryRunJson.deletedAssets.map((asset) => asset.id)).toEqual([first.assetId]);

    const missingProof = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(missingProof.status).toBe(409);
    expect(await missingProof.json()).toMatchObject({
      error: expect.stringContaining("Missing asset garbage collection read proof for agent"),
      mutation: {
        operation: "asset_gc",
        entity: { kind: "asset-store", id: "local" },
        accepted: false,
      },
    });

    const bareToken = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(dryRunJson.readToken),
      },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(bareToken.status).toBe(409);
    expect(await bareToken.json()).toMatchObject({
      error: expect.stringContaining("Missing asset garbage collection read receipt for agent"),
      mutation: { accepted: false },
    });

    const second = await importOrphan("7".repeat(64), "project-gc-agent-second");

    const staleProof = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": dryRunJson.readToken,
      },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(staleProof.status).toBe(409);
    expect(await staleProof.json()).toMatchObject({
      error: expect.stringContaining("Stale asset garbage collection rejected"),
      mutation: { accepted: false },
    });

    const freshDryRun = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(freshDryRun.status).toBe(200);
    const freshDryRunJson = await freshDryRun.json() as { readToken: string; deletedAssets: Array<{ id: string }> };
    expect(freshDryRunJson.readToken).toMatch(ASSET_GC_RECEIPT_READ_TOKEN_RE);
    expect(freshDryRunJson.deletedAssets.map((asset) => asset.id).sort()).toEqual([first.assetId, second.assetId]);

    const accepted = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": freshDryRunJson.readToken,
      },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as {
      deletedAssets: Array<{ id: string }>;
      mutation: { expectedReadToken?: string; beforeReadToken?: string; accepted?: boolean };
    };
    expect(acceptedJson.deletedAssets.map((asset) => asset.id).sort()).toEqual([first.assetId, second.assetId]);
    expect(acceptedJson).toMatchObject({
      dryRun: false,
      mutation: {
        operation: "asset_gc",
        entity: { kind: "asset-store", id: "local" },
        expectedReadToken: freshDryRunJson.readToken,
        beforeReadToken: baseReadToken(freshDryRunJson.readToken),
        accepted: true,
      },
    });
    await expect(stat(first.blobPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(second.blobPath)).rejects.toMatchObject({ code: "ENOENT" });

    const audit = await app.request("/api/v1/mutation-audit?operation=asset_gc&entityId=local");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ mutation?: unknown }> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "asset_gc",
      entity: { kind: "asset-store", id: "local" },
      accepted: true,
      actorClientType: "agent",
      reason: "asset garbage collection",
      mutation: {
        operation: "asset_gc",
        entity: { kind: "asset-store", id: "local" },
        resultEntityId: "local",
        accepted: true,
      },
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
  });

  it("keeps unreferenced local assets that are protected by live canvas references", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-gc-protected-home-"));
    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const hash = "e".repeat(64);
    const assetId = `local:sha256:${hash}`;
    const blobKey = `blobs/${hash}/original.png`;
    const blobPath = join(clashRoot, "assets", blobKey);
    await mkdir(join(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, "protected-by-canvas", "utf8");

    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "project-canvas-ref",
        kind: "image",
        assetId,
        contentHash: hash,
        localBlobKey: blobKey,
      }),
    });
    expect(imported.status).toBe(200);
    const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=project-canvas-ref`, {
      method: "DELETE",
    });
    expect(removedRef.status).toBe(200);

    const gc = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false, protectedAssetIds: [assetId] }),
    });

    expect(gc.status).toBe(200);
    expect(await gc.json()).toMatchObject({
      dryRun: false,
      deletedAssets: [],
      protectedAssets: [assetId],
      deletedBlobKeys: [],
    });
    await expect(stat(blobPath)).resolves.toMatchObject({ size: "protected-by-canvas".length });
    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select id from assets where id = ?").get(assetId)).toMatchObject({ id: assetId });
    } finally {
      sqlite.close();
    }
  });

  it("auto-protects local assets referenced by persisted project canvas state during GC", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-gc-loro-home-"));
    const projectId = "project-loro-ref";
    const hash = "f".repeat(64);
    const assetId = `local:sha256:${hash}`;
    const blobKey = `blobs/${hash}/original.png`;
    const blobPath = join(clashRoot, "assets", blobKey);
    await mkdir(join(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, "protected-by-loro", "utf8");

    const doc = new LoroDoc();
    doc.getMap("nodes").set("image-node", {
      type: "image",
      data: { assetId },
    });
    await new FileReplicaStore(join(dataDir, "projects")).saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        kind: "image",
        assetId,
        contentHash: hash,
        localBlobKey: blobKey,
      }),
    });
    expect(imported.status).toBe(200);
    const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    expect(removedRef.status).toBe(200);

    const gc = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false, projectIds: [projectId] }),
    });

    expect(gc.status).toBe(200);
    expect(await gc.json()).toMatchObject({
      dryRun: false,
      deletedAssets: [],
      protectedAssets: [assetId],
      protectedProjectIds: [projectId],
      deletedBlobKeys: [],
    });
    await expect(stat(blobPath)).resolves.toMatchObject({ size: "protected-by-loro".length });
    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select asset_id, project_id from asset_refs where asset_id = ?").get(assetId)).toEqual({
        asset_id: assetId,
        project_id: projectId,
      });
    } finally {
      sqlite.close();
    }
  });

  it("auto-discovers persisted project canvas references during GC when projectIds are omitted", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-gc-discovery-home-"));
    const projectId = "project-auto-discovered-loro-ref";
    const hash = "1".repeat(64);
    const assetId = `local:sha256:${hash}`;
    const blobKey = `blobs/${hash}/original.png`;
    const blobPath = join(clashRoot, "assets", blobKey);
    await mkdir(join(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, "protected-by-auto-discovery", "utf8");

    const doc = new LoroDoc();
    doc.getMap("nodes").set("image-node", {
      type: "image",
      data: { assetId },
    });
    await new FileReplicaStore(join(dataDir, "projects")).saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        kind: "image",
        assetId,
        contentHash: hash,
        localBlobKey: blobKey,
      }),
    });
    expect(imported.status).toBe(200);
    const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    expect(removedRef.status).toBe(200);

    const gc = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });

    expect(gc.status).toBe(200);
    expect(await gc.json()).toMatchObject({
      dryRun: false,
      deletedAssets: [],
      protectedAssets: [assetId],
      protectedProjectIds: [projectId],
      deletedBlobKeys: [],
    });
    await expect(stat(blobPath)).resolves.toMatchObject({ size: "protected-by-auto-discovery".length });
  });

  it("protects downstream asset reference fields beyond bare assetId during GC", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-gc-deep-refs-home-"));
    const projectId = "project-deep-asset-refs";
    const hashes = ["2".repeat(64), "3".repeat(64), "4".repeat(64)];
    const assetIds = hashes.map((hash) => `local:sha256:${hash}`);
    for (const [index, hash] of hashes.entries()) {
      const blobPath = join(clashRoot, "assets", "blobs", hash, "original.png");
      await mkdir(join(blobPath, ".."), { recursive: true });
      await writeFile(blobPath, `deep-ref-${index}`, "utf8");
    }

    const doc = new LoroDoc();
    doc.getMap("nodes").set("metadata-node", {
      type: "group",
      data: {
        productionMetadata: {
          sourceAssetId: assetIds[0],
          checks: [{ referenceAssetId: assetIds[1], status: "pass" }],
          requiredReferenceAssetIds: [assetIds[2]],
        },
      },
    });
    await new FileReplicaStore(join(dataDir, "projects")).saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    for (const [index, hash] of hashes.entries()) {
      const imported = await app.request("/api/v1/assets/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId,
          kind: "image",
          assetId: assetIds[index],
          contentHash: hash,
          localBlobKey: `blobs/${hash}/original.png`,
        }),
      });
      expect(imported.status).toBe(200);
      const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(assetIds[index])}/ref?projectId=${encodeURIComponent(projectId)}`, {
        method: "DELETE",
      });
      expect(removedRef.status).toBe(200);
    }

    const gc = await app.request("/api/v1/assets/gc", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dryRun: false }),
    });

    expect(gc.status).toBe(200);
    expect(await gc.json()).toMatchObject({
      dryRun: false,
      deletedAssets: [],
      protectedAssets: assetIds,
      protectedProjectIds: [projectId],
      deletedBlobKeys: [],
    });
    for (const [index, hash] of hashes.entries()) {
      await expect(stat(join(clashRoot, "assets", "blobs", hash, "original.png"))).resolves.toMatchObject({ size: `deep-ref-${index}`.length });
    }
    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select asset_id, project_id from asset_refs order by asset_id").all()).toEqual(
        assetIds.map((assetId) => ({ asset_id: assetId, project_id: projectId })),
      );
      expect(sqlite.prepare("select name from sqlite_master where type = 'table' and name = 'asset_node_refs'").get()).toEqual({
        name: "asset_node_refs",
      });
      expect(sqlite.prepare("select asset_id, project_id, node_id, node_type, field_path, reference_role from asset_node_refs order by asset_id").all()).toEqual([
        {
          asset_id: assetIds[0],
          project_id: projectId,
          node_id: "metadata-node",
          node_type: "group",
          field_path: "data.productionMetadata.sourceAssetId",
          reference_role: "source",
        },
        {
          asset_id: assetIds[1],
          project_id: projectId,
          node_id: "metadata-node",
          node_type: "group",
          field_path: "data.productionMetadata.checks[0].referenceAssetId",
          reference_role: "reference",
        },
        {
          asset_id: assetIds[2],
          project_id: projectId,
          node_id: "metadata-node",
          node_type: "group",
          field_path: "data.productionMetadata.requiredReferenceAssetIds[0]",
          reference_role: "required-reference",
        },
      ]);
    } finally {
      sqlite.close();
    }

    const references = await app.request(`/api/v1/assets/${encodeURIComponent(assetIds[1])}/references`);
    expect(references.status).toBe(200);
    expect(await references.json()).toEqual({
      assetId: assetIds[1],
      references: [
        {
          assetId: assetIds[1],
          projectId,
          nodeId: "metadata-node",
          nodeType: "group",
          fieldPath: "data.productionMetadata.checks[0].referenceAssetId",
          referenceRole: "reference",
        },
      ],
    });
  });

  it("refreshes asset reference projection without running GC deletion", async () => {
    const clashRoot = await mkdtemp(join(tmpdir(), "clash-local-api-asset-ref-refresh-home-"));
    const projectId = "project-refresh-asset-refs";
    const hash = "5".repeat(64);
    const assetId = `local:sha256:${hash}`;
    const blobPath = join(clashRoot, "assets", "blobs", hash, "original.png");
    await mkdir(join(blobPath, ".."), { recursive: true });
    await writeFile(blobPath, "refresh-ref", "utf8");

    const doc = new LoroDoc();
    doc.getMap("nodes").set("image-node", {
      type: "image",
      data: { assetId },
    });
    await new FileReplicaStore(join(dataDir, "projects")).saveSnapshotAtomic(projectId, doc.export({ mode: "snapshot" }));

    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const imported = await app.request("/api/v1/assets/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId,
        kind: "image",
        assetId,
        contentHash: hash,
        localBlobKey: `blobs/${hash}/original.png`,
      }),
    });
    expect(imported.status).toBe(200);
    const removedRef = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/ref?projectId=${encodeURIComponent(projectId)}`, {
      method: "DELETE",
    });
    expect(removedRef.status).toBe(200);

    const assetRead = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}`);
    expect(assetRead.status).toBe(200);
    const assetReadJson = await assetRead.json() as { readToken: string };
    expect(assetReadJson.readToken).toMatch(ASSET_RECEIPT_READ_TOKEN_RE);

    const missingRead = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/references/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({ projectIds: [projectId] }),
    });
    expect(missingRead.status).toBe(409);
    expect(await missingRead.json()).toMatchObject({
      error: expect.stringContaining("Missing asset references refresh read proof for agent"),
      mutation: {
        operation: "asset_references_refresh",
        entity: { kind: "asset", id: assetId },
        accepted: false,
      },
    });

    const bareRead = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/references/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(assetReadJson.readToken),
      },
      body: JSON.stringify({ projectIds: [projectId] }),
    });
    expect(bareRead.status).toBe(409);
    expect(await bareRead.json()).toMatchObject({
      error: expect.stringContaining("Missing asset references refresh read receipt for agent"),
      mutation: {
        operation: "asset_references_refresh",
        entity: { kind: "asset", id: assetId },
        expectedReadToken: baseReadToken(assetReadJson.readToken),
        beforeReadToken: baseReadToken(assetReadJson.readToken),
        accepted: false,
      },
    });

    const refresh = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/references/refresh`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": assetReadJson.readToken,
      },
      body: JSON.stringify({ projectIds: [projectId] }),
    });

    expect(refresh.status).toBe(200);
    expect(await refresh.json()).toEqual({
      assetId,
      readToken: assetReadJson.readToken,
      refreshed: true,
      protectedProjectIds: [projectId],
      references: [
        {
          assetId,
          projectId,
          nodeId: "image-node",
          nodeType: "image",
          fieldPath: "data.assetId",
          referenceRole: "primary",
        },
      ],
      mutation: {
        operation: "asset_references_refresh",
        entity: { kind: "asset", id: assetId },
        expectedReadToken: assetReadJson.readToken,
        beforeReadToken: baseReadToken(assetReadJson.readToken),
        afterReadToken: assetReadJson.readToken,
        resultEntityId: assetId,
        accepted: true,
      },
    });
    const audit = await app.request(`/api/v1/mutation-audit?operation=asset_references_refresh&entityId=${encodeURIComponent(assetId)}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ actorClientType?: string; mutation?: any }> };
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(agentAuditRecord).toMatchObject({
      operation: "asset_references_refresh",
      entity: { kind: "asset", id: assetId },
      actorClientType: "agent",
      accepted: true,
      reason: "asset reference refresh",
      resultEntityId: assetId,
    });
    expect(JSON.stringify(agentAuditRecord?.mutation ?? {})).not.toContain("receipt");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("expectedReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("beforeReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("afterReadToken");
    await expect(stat(blobPath)).resolves.toMatchObject({ size: "refresh-ref".length });
    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select asset_id, project_id from asset_refs where asset_id = ?").get(assetId)).toEqual({
        asset_id: assetId,
        project_id: projectId,
      });
    } finally {
      sqlite.close();
    }
  });

  it("records mutation envelopes for local custom action uploads", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const missingForm = new FormData();
    missingForm.append("file", new File(["img"], "x.png", { type: "image/png" }));
    const missing = await app.request("/api/custom-action/upload", {
      method: "POST",
      body: missingForm,
    });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "Missing required fields: projectId, taskId, nodeId",
      mutation: {
        operation: "custom_action_upload",
        entity: { kind: "custom-action-result", id: "" },
        accepted: false,
        error: "Missing required fields: projectId, taskId, nodeId",
      },
    });

    const textForm = new FormData();
    textForm.append("projectId", "project-custom");
    textForm.append("taskId", "task-text");
    textForm.append("nodeId", "node-text");
    textForm.append("outputType", "text");
    textForm.append("content", "hello custom text");
    const text = await app.request("/api/custom-action/upload", {
      method: "POST",
      body: textForm,
    });
    expect(text.status).toBe(200);
    expect(await text.json()).toEqual({
      success: true,
      storageKey: null,
      content: "hello custom text",
      mutation: {
        operation: "custom_action_upload",
        entity: { kind: "custom-action-result", id: "task-text" },
        accepted: true,
        resultEntityId: "task-text",
      },
    });

    const imageForm = new FormData();
    imageForm.append("projectId", "project-custom");
    imageForm.append("taskId", "task-image");
    imageForm.append("nodeId", "node-image");
    imageForm.append("outputType", "image");
    imageForm.append("actorUserId", "actor-user");
    imageForm.append("file", new File(["image-bytes"], "x.png", { type: "image/png" }));
    const image = await app.request("/api/custom-action/upload", {
      method: "POST",
      headers: { "x-clash-client-type": "agent" },
      body: imageForm,
    });
    expect(image.status).toBe(200);
    expect(await image.json()).toEqual({
      success: true,
      storageKey: "projects/project-custom/custom/task-image.png",
      assetId: "task-image",
      mutation: {
        operation: "custom_action_upload",
        entity: { kind: "custom-action-result", id: "task-image" },
        accepted: true,
        resultEntityId: "task-image",
      },
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=custom_action_upload&entityId=task-image");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<{ actorClientType?: string; mutation?: any }> };
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(agentAuditRecord).toMatchObject({
      operation: "custom_action_upload",
      entity: { kind: "custom-action-result", id: "task-image" },
      actorClientType: "agent",
      accepted: true,
      reason: "custom action upload",
      resultEntityId: "task-image",
    });
    expect(JSON.stringify(agentAuditRecord?.mutation ?? {})).not.toContain("receipt");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("expectedReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("beforeReadToken");
    expect(agentAuditRecord?.mutation).not.toHaveProperty("afterReadToken");

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select id, user_id, src_r2_key from assets where id = ?").get("task-image")).toEqual({
        id: "task-image",
        user_id: "actor-user",
        src_r2_key: "projects/project-custom/custom/task-image.png",
      });
      expect(sqlite.prepare("select asset_id, project_id from asset_refs where asset_id = ?").get("task-image")).toEqual({
        asset_id: "task-image",
        project_id: "project-custom",
      });
    } finally {
      sqlite.close();
    }
  });

  it("rejects custom action output reruns that would overwrite an existing checkpoint asset", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const firstForm = new FormData();
    firstForm.append("projectId", "project-custom");
    firstForm.append("taskId", "task-rerun");
    firstForm.append("nodeId", "node-image");
    firstForm.append("outputType", "image");
    firstForm.append("file", new File(["first-checkpoint"], "x.png", { type: "image/png" }));
    const first = await app.request("/api/custom-action/upload", {
      method: "POST",
      body: firstForm,
    });
    expect(first.status).toBe(200);

    const secondForm = new FormData();
    secondForm.append("projectId", "project-custom");
    secondForm.append("taskId", "task-rerun");
    secondForm.append("nodeId", "node-image");
    secondForm.append("outputType", "image");
    secondForm.append("file", new File(["second-checkpoint"], "x.png", { type: "image/png" }));
    const second = await app.request("/api/custom-action/upload", {
      method: "POST",
      body: secondForm,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({
      error: expect.stringContaining("Custom action output already exists with different checkpoint content"),
      mutation: {
        operation: "custom_action_upload",
        entity: { kind: "custom-action-result", id: "task-rerun" },
        accepted: false,
        error: expect.stringContaining("Custom action output already exists with different checkpoint content"),
      },
    });

    const bytes = await app.request("/assets/projects/project-custom/custom/task-rerun.png");
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("first-checkpoint");
  });

  it("persists local provider accounts in SQLite", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            providerId: "official",
            upstreamId: "openai",
            region: "global",
            enabled: true,
            weight: 10,
            credentials: { apiKey: "sk-local-openai" },
          },
        ],
      }),
    });

    expect(saved.status).toBe(200);
    await expect(stat(join(dataDir, "local.sqlite"))).resolves.toMatchObject({ mode: expect.any(Number) });

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select provider_id, upstream_id, region, enabled, weight from provider_accounts").get()).toEqual({
        provider_id: "official",
        upstream_id: "openai",
        region: "global",
        enabled: 1,
        weight: 10,
      });
      const credential = sqlite.prepare("select credential_key, credential_value from provider_account_credentials").get();
      expect(credential?.credential_key).toBe("apiKey");
      expect(credential?.credential_value).not.toBe("sk-local-openai");
      expect(String(credential?.credential_value)).toMatch(/^enc:v1:/);
      expect(String(credential?.credential_value)).not.toContain("sk-local-openai");
    } finally {
      sqlite.close();
    }

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const listed = await reopened.request("/api/v1/model-providers");
    expect(await listed.json()).toMatchObject({
      providers: [
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          configuredCredentials: ["apiKey"],
          weight: 10,
        },
      ],
    });
  });

  it("keeps all concurrent provider account updates", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const ids = Array.from({ length: 12 }, (_, index) => `replicate-concurrent-${index}`);

    const saved = await Promise.all(ids.map((id, index) =>
      app.request("/api/v1/model-providers", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providers: [
            {
              id,
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              weight: index + 1,
              credentials: { apiKey: `r8-concurrent-${index}` },
            },
          ],
        }),
      })
    ));
    expect(saved.map((response) => response.status)).toEqual(ids.map(() => 200));

    const listed = await app.request("/api/v1/model-providers");
    const body = await listed.json() as { providers: Array<{ id?: string }> };
    expect(body.providers.map((provider) => provider.id).sort()).toEqual([...ids].sort());
  });

  it("records mutation envelopes for provider account settings writes", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const invalid = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providers: [{ providerId: "not-a-provider" }] }),
    });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({
      error: "Invalid providers",
      mutation: {
        operation: "provider_accounts_update",
        entity: { kind: "provider-accounts", id: "local-user" },
        accepted: false,
        error: "Invalid providers",
      },
    });

    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-primary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            credentials: { apiKey: "r8-primary" },
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);
    const savedJson = await saved.json() as { providers: Array<{ id?: string }>; mutation?: unknown };
    expect(savedJson.providers.map((provider) => provider.id)).toEqual(["replicate-primary"]);
    expect(savedJson.mutation).toEqual({
      operation: "provider_accounts_update",
      entity: { kind: "provider-accounts", id: "local-user" },
      resultEntityId: "local-user",
      accepted: true,
    });

    const missing = await app.request("/api/v1/model-providers/missing-provider", { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Provider account not found",
      mutation: {
        operation: "provider_account_delete",
        entity: { kind: "provider-account", id: "missing-provider" },
        accepted: false,
        error: "Provider account not found",
      },
    });

    const deleted = await app.request("/api/v1/model-providers/replicate-primary", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      ok: true,
      mutation: {
        operation: "provider_account_delete",
        entity: { kind: "provider-account", id: "replicate-primary" },
        resultEntityId: "replicate-primary",
        accepted: true,
      },
    });
  });

  it("persists local model provider account settings and exposes catalog tiers", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          { providerId: "fal", enabled: true, weight: 90, credentials: { apiKey: "fal-local-key" } },
          { providerId: "official", upstreamId: "openai", region: "global", enabled: true, weight: 10 },
        ],
      }),
    });

    expect(saved.status).toBe(200);
    const savedJson = (await saved.json()) as { providers: Array<Record<string, unknown>> };
    expect(savedJson.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "fal",
        upstreamId: "fal",
        enabled: true,
        weight: 90,
        configuredCredentials: ["apiKey"],
      }),
      expect.objectContaining({
        providerId: "official",
        upstreamId: "openai",
        region: "global",
        enabled: true,
        weight: 10,
        configuredCredentials: [],
      }),
    ]));

    const projectorBinding = {
      pluginId: "clash-first-party-media",
      version: "1.0.0",
      exportId: "fal-h3",
      schemaHash: `sha256:${"a".repeat(64)}` as const,
    };
    const resolvePluginBinding = vi.fn(async (
      pluginId: string,
      exportId: string,
      _kind: "action" | "provider-projector",
    ) => ({ ...projectorBinding, pluginId, exportId }));
    const pluginH3 = MODEL_CARDS.find((model) => model.id === "minimax-h3")!;
    const listPluginCards = vi.fn(async () => [
      {
        pluginId: "clash-first-party-media",
        version: "1.0.0",
        schemaHash: projectorBinding.schemaHash,
        runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "handler.mjs", args: [] },
        permissions: { network: { domains: [] }, secrets: [], assets: [], hostTools: [], filesystem: { read: [], write: [] }, externalWrites: false },
        document: {
          apiVersion: "clash.card/v1" as const,
          kind: "model-card" as const,
          spec: {
            ...pluginH3,
            name: "Agent-edited MiniMax H3",
          },
        },
      },
      {
        pluginId: "agent-provider-models",
        version: "1.0.0",
        schemaHash: `sha256:${"b".repeat(64)}` as const,
        runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "handler.mjs", args: [] },
        permissions: { network: { domains: [] }, secrets: [], assets: [], hostTools: [], filesystem: { read: [], write: [] }, externalWrites: false },
        document: {
          apiVersion: "clash.card/v1" as const,
          kind: "model-card" as const,
          spec: {
            ...pluginH3,
            id: "agent-h3",
            aliases: [],
            name: "Agent H3",
          },
        },
      },
    ]);
    const reopened = createLocalApiApp({
      dataDir,
      userId: "local-user",
      resolvePluginBinding,
      listPluginCards,
    });
    const providers = await reopened.request("/api/v1/model-providers");
    expect(await providers.json()).toEqual({
      providers: savedJson.providers,
      readToken: expect.stringMatching(PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE),
    });

    const catalog = await reopened.request("/api/v1/models/catalog");
    const catalogJson = (await catalog.json()) as {
      models: Array<{
        model: { id: string; name: string };
        tier: string;
        selectedRoute?: {
          providerId?: string;
          upstreamId?: string;
          projectorBinding?: typeof projectorBinding;
        };
        candidateProviders: string[];
        missingCredentials: string[];
      }>;
    };
    const nanoBanana = catalogJson.models.find((entry) => entry.model.id === "nano-banana-2");
    const gptImage = catalogJson.models.find((entry) => entry.model.id === "gpt-image-2");
    expect(nanoBanana).toMatchObject({
      tier: "available",
      selectedRoute: { providerId: "fal", upstreamId: "fal" },
    });
    expect(gptImage).toMatchObject({
      tier: "available",
      selectedRoute: { providerId: "fal", upstreamId: "fal" },
      candidateProviders: ["fal", "official"],
      missingCredentials: ["apiKey"],
    });
    const h3 = catalogJson.models.find((entry) => entry.model.id === "minimax-h3");
    expect(h3?.model.name).toBe("Agent-edited MiniMax H3");
    expect(h3?.selectedRoute?.projectorBinding).toEqual(projectorBinding);
    expect(listPluginCards).toHaveBeenCalledOnce();
    expect(resolvePluginBinding).toHaveBeenCalledWith(
      "clash-first-party-media",
      "fal-h3",
      "provider-projector",
    );

    const pluginCardConfig = await reopened.request("/api/v1/model-cards/agent-h3", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ description: "Agent override" }),
    });
    expect(pluginCardConfig.status).toBe(200);
    expect(await pluginCardConfig.json()).toMatchObject({
      config: { modelId: "agent-h3", custom: false, description: "Agent override" },
    });
  });

  it("projects activated executable action Cards into product custom-action definitions", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      listPluginCards: async () => [{
        pluginId: "agent-caption-actions",
        version: "1.2.0",
        schemaHash: `sha256:${"c".repeat(64)}`,
        runtime: { kind: "local", transport: "stdio", entrypoint: "handler.mjs", args: [] },
        permissions: { network: { domains: [] }, secrets: [], assets: ["read", "write"], hostTools: [], filesystem: { read: [], write: [] }, externalWrites: false },
        document: {
          apiVersion: "clash.card/v1",
          kind: "action-card",
          spec: {
            id: "caption-helper",
            name: "Caption Helper",
            outputType: "text",
            parameters: [{ id: "tone", label: "Tone", type: "text", required: false, defaultValue: "concise" }],
            input: { requiresPrompt: true, inputMode: { images: { max: 2 } }, promptModalities: ["text", "image"] },
            constraints: [{ type: "max-length", field: "prompt", max: 500 }],
            presentation: { type: "form" },
            functionExportId: "run-caption-helper",
            maxRuntimeMs: 120_000,
          },
        },
      }],
    });

    const response = await app.request("/api/v1/plugin-actions");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      actions: [expect.objectContaining({
        id: "caption-helper",
        name: "Caption Helper",
        outputType: "text",
        runtime: "local",
        parameters: [expect.objectContaining({ id: "tone", defaultValue: "concise" })],
        input: {
          requiresPrompt: true,
          inputMode: { images: { max: 2 } },
          promptModalities: ["text", "image"],
        },
        constraints: [{ type: "max-length", field: "prompt", max: 500 }],
        presentation: { type: "form" },
        maxRuntimeMs: 120_000,
        pluginBinding: {
          pluginId: "agent-caption-actions",
          version: "1.2.0",
          exportId: "run-caption-helper",
          schemaHash: `sha256:${"c".repeat(64)}`,
        },
        pluginPermissions: expect.objectContaining({ assets: ["read", "write"] }),
      })],
    });
  });

  it("persists a compatible custom provider and a mounted custom text model card", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const provider = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "custom-openai-primary",
            providerId: "custom",
            upstreamId: "openai",
            apiShape: "openai-compatible",
            label: "Studio proxy",
            enabled: true,
            credentials: {
              apiKey: "sk-studio",
              baseUrl: "https://studio-proxy.example/v1",
            },
          },
        ],
      }),
    });
    expect(provider.status).toBe(200);
    expect(await provider.json()).toMatchObject({
      providers: [
        {
          id: "custom-openai-primary",
          providerId: "custom",
          upstreamId: "openai",
          apiShape: "openai-compatible",
          label: "Studio proxy",
          configuredCredentials: ["apiKey", "baseUrl"],
        },
      ],
    });

    const savedModel = await app.request("/api/v1/model-cards/editorial-reasoner", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        custom: true,
        name: "Editorial Reasoner",
        kind: "text",
        description: "A house model for edit decisions.",
        promptGuidance: "Name the audience and the desired editorial outcome.",
        providerBindings: [
          {
            providerAccountId: "custom-openai-primary",
            upstreamModel: "editorial/reasoner-v2",
          },
        ],
      }),
    });
    expect(savedModel.status).toBe(200);
    expect(await savedModel.json()).toMatchObject({
      config: {
        modelId: "editorial-reasoner",
        custom: true,
        name: "Editorial Reasoner",
        description: "A house model for edit decisions.",
        promptGuidance: "Name the audience and the desired editorial outcome.",
      },
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const catalog = await reopened.request("/api/v1/models/catalog");
    expect(catalog.status).toBe(200);
    const catalogJson = await catalog.json() as {
      models: Array<{
        model: {
          id: string;
          description?: string;
          promptGuidance?: string;
          custom?: boolean;
        };
        selectedRoute?: {
          accountId?: string;
          apiShape?: string;
          upstreamModel?: string;
        } | null;
      }>;
    };
    expect(catalogJson.models.find((entry) => entry.model.id === "editorial-reasoner")).toMatchObject({
      model: {
        id: "editorial-reasoner",
        custom: true,
        description: "A house model for edit decisions.",
        promptGuidance: "Name the audience and the desired editorial outcome.",
      },
      selectedRoute: {
        accountId: "custom-openai-primary",
        apiShape: "openai-compatible",
        upstreamModel: "editorial/reasoner-v2",
      },
    });
  });

  it("rewrites legacy plaintext provider credentials in SQLite as encrypted values", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            providerId: "official",
            upstreamId: "openai",
            region: "global",
            enabled: true,
            credentials: { apiKey: "sk-legacy-sqlite-plaintext" },
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);

    let sqlite = openSqlite();
    try {
      sqlite.prepare("update provider_account_credentials set credential_value = ?").run("sk-legacy-sqlite-plaintext");
      sqlite.prepare("delete from local_migration where id = 'provider-accounts-sqlite-v1'").run();
    } finally {
      sqlite.close();
    }

    const listed = await createLocalApiApp({ dataDir, userId: "local-user" }).request("/api/v1/model-providers");
    expect(await listed.json()).toMatchObject({
      providers: [
        {
          providerId: "official",
          upstreamId: "openai",
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    sqlite = openSqlite();
    try {
      const credential = sqlite.prepare("select credential_value from provider_account_credentials").get();
      expect(credential?.credential_value).not.toBe("sk-legacy-sqlite-plaintext");
      expect(String(credential?.credential_value)).toMatch(/^enc:v1:/);
    } finally {
      sqlite.close();
    }
  });

  it("rewrites plaintext provider credentials even when the old SQLite migration marker already exists", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            providerId: "official",
            upstreamId: "openai",
            region: "global",
            enabled: true,
            credentials: { apiKey: "sk-old-marker-plaintext" },
          },
        ],
      }),
    });
    expect(saved.status).toBe(200);

    let sqlite = openSqlite();
    try {
      sqlite.prepare("update provider_account_credentials set credential_value = ?").run("sk-old-marker-plaintext");
      expect(sqlite.prepare("select id from local_migration where id = 'provider-accounts-sqlite-v1'").get()).toEqual({
        id: "provider-accounts-sqlite-v1",
      });
    } finally {
      sqlite.close();
    }

    const listed = await createLocalApiApp({ dataDir, userId: "local-user" }).request("/api/v1/model-providers");
    expect(await listed.json()).toMatchObject({
      providers: [
        {
          providerId: "official",
          upstreamId: "openai",
          configuredCredentials: ["apiKey"],
        },
      ],
    });

    sqlite = openSqlite();
    try {
      const credential = sqlite.prepare("select credential_value from provider_account_credentials").get();
      expect(credential?.credential_value).not.toBe("sk-old-marker-plaintext");
      expect(String(credential?.credential_value)).toMatch(/^enc:v1:/);
    } finally {
      sqlite.close();
    }
  });

  it("appends a second provider key without replacing an existing id-less account", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const firstSave = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
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
    });
    expect(firstSave.status).toBe(200);
    const firstJson = (await firstSave.json()) as { providers: Array<Record<string, unknown>> };
    expect(firstJson.providers).toHaveLength(1);

    const secondSave = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
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
    });

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

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const providers = await reopened.request("/api/v1/model-providers");
    expect(await providers.json()).toEqual({
      providers: secondJson.providers,
      readToken: expect.stringMatching(PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE),
    });
  });

  it("records rejected mutation envelopes for invalid provider model tests", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const response = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: { providerId: "mock", upstreamId: "mock" } }),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "provider and modelId are required",
      mutation: {
        operation: "provider_model_test",
        entity: { kind: "provider-test", id: "unknown" },
        accepted: false,
        error: "provider and modelId are required",
      },
    });
  });

  it("tests a configured mock provider account against a selected model", async () => {
    const falMock = createMockFalQueueService();
    const submit = vi.spyOn(falMock, "submit");
    const app = createLocalApiApp({ dataDir, userId: "local-user", falMock });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true, priority: 1 },
        ],
      }),
    });

    const ok = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
      body: JSON.stringify({
        provider: { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true },
        modelId: "nano-banana-2",
      }),
    });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      providerId: "mock",
      upstreamId: "mock",
      modelId: "nano-banana-2",
      mutation: providerModelTestMutation("mock", "nano-banana-2"),
      provider: "fal-mock",
      modelEndpoint: "fal-ai/nano-banana-2",
      requestId: expect.stringMatching(/^fal-mock-/),
      input: {
        shape: "image",
        model: "nano-banana-2",
        prompt: "Provider test for Nano Banana 2",
        aspectRatio: "16:9",
      },
      output: {
        shape: "image",
        provider: "fal-mock",
        endpoint: "fal-ai/nano-banana-2",
        requestId: expect.stringMatching(/^fal-mock-/),
        url: expect.stringContaining("/fal/media/"),
        contentType: expect.stringMatching(/^image\//),
        width: expect.any(Number),
        height: expect.any(Number),
      },
      message: "Mock provider ran Nano Banana 2 through fal-ai/nano-banana-2.",
    });
    expect(submit).toHaveBeenCalledWith(
      "fal-ai/nano-banana-2",
      expect.objectContaining({
        prompt: "Provider test for Nano Banana 2",
        output_type: "image",
      }),
      expect.any(Object),
    );
    await expectSingleMutationAudit(app, {
      operation: "provider_model_test",
      entityId: "mock:nano-banana-2",
      entityKind: "provider-test",
      reason: "provider model test",
      actorClientType: "agent",
    });

    const mockModel = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true },
        modelId: "mock-image-model",
      }),
    });

    expect(mockModel.status).toBe(200);
    expect(await mockModel.json()).toEqual({
      ok: true,
      providerId: "mock",
      upstreamId: "mock",
      modelId: "mock-image-model",
      mutation: providerModelTestMutation("mock", "mock-image-model"),
      provider: "fal-mock",
      modelEndpoint: "fal-ai/mock-image",
      requestId: expect.stringMatching(/^fal-mock-/),
      input: {
        shape: "image",
        model: "mock-image-model",
        prompt: "Provider test for Mock Image Model",
        aspectRatio: "16:9",
      },
      output: {
        shape: "image",
        provider: "fal-mock",
        endpoint: "fal-ai/mock-image",
        requestId: expect.stringMatching(/^fal-mock-/),
        url: expect.stringContaining("/fal/media/"),
        contentType: expect.stringMatching(/^image\//),
        width: expect.any(Number),
        height: expect.any(Number),
      },
      message: "Mock provider ran Mock Image Model through fal-ai/mock-image.",
    });
    expect(submit).toHaveBeenCalledWith(
      "fal-ai/mock-image",
      expect.objectContaining({
        prompt: "Provider test for Mock Image Model",
        output_type: "image",
      }),
      expect.any(Object),
    );

    const mockTextModel = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true },
        modelId: "mock-text-model",
      }),
    });

    expect(mockTextModel.status).toBe(200);
    expect(await mockTextModel.json()).toEqual({
      ok: true,
      providerId: "mock",
      upstreamId: "mock",
      modelId: "mock-text-model",
      mutation: providerModelTestMutation("mock", "mock-text-model"),
      provider: "mock",
      modelEndpoint: "mock/text-completion",
      input: {
        shape: "text",
        model: "mock-text-model",
        prompt: "Provider test for Mock Text Model",
      },
      output: {
        shape: "text",
        provider: "mock",
        endpoint: "mock/text-completion",
        text: "Generated text (mock-text-model)\n\nProvider test for Mock Text Model",
      },
      message: "Mock provider ran Mock Text Model through mock/text-completion.",
    });

    const unsupported = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true },
        modelId: "claude-sonnet-4",
      }),
    });

    expect(unsupported.status).toBe(200);
    expect(await unsupported.json()).toEqual({
      ok: false,
      providerId: "mock",
      upstreamId: "mock",
      modelId: "claude-sonnet-4",
      mutation: providerModelTestMutation("mock", "claude-sonnet-4"),
      unsupported: true,
      message: "Mock provider does not support Claude Sonnet 4.",
    });
  });

  it("does not let provider tests override a disabled saved account", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: false, priority: 1 },
        ],
      }),
    });

    const response = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true },
        modelId: "nano-banana-2",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      providerId: "mock",
      upstreamId: "mock",
      modelId: "nano-banana-2",
      mutation: providerModelTestMutation("mock", "nano-banana-2"),
      disabled: true,
      message: "Mock provider is disabled for Nano Banana 2.",
    });
  });

  it("does not test a provider account disabled by the test request", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-primary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            priority: 1,
            credentials: { apiKey: "r8-local-key" },
          },
        ],
      }),
    });

    const response = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", enabled: false },
        modelId: "nano-banana-2",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: false,
      providerId: "replicate",
      upstreamId: "replicate",
      modelId: "nano-banana-2",
      mutation: providerModelTestMutation("replicate", "nano-banana-2"),
      disabled: true,
      message: "Replicate is disabled for Nano Banana 2.",
    });
  });

  it("checks a configured live provider account against a selected model without a fake skipped state", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-primary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            priority: 1,
            credentials: { apiKey: "r8-local-key" },
          },
        ],
      }),
    });

    const ok = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", enabled: true },
        modelId: "nano-banana-2",
      }),
    });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      providerId: "replicate",
      upstreamId: "replicate",
      modelId: "nano-banana-2",
      mutation: providerModelTestMutation("replicate", "nano-banana-2"),
      message: "Replicate configuration is ready for Nano Banana 2.",
    });
  });

  it("runs a live Google Cloud Agent Platform text provider test", async () => {
    const privateKey = await createTestPrivateKeyPem();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerTestFetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "vertex-access-token", expires_in: 3600 });
        }
        if (url === "https://aiplatform.googleapis.com/v1/projects/vertex-project/locations/global/publishers/google/models/gemini-3-flash-preview:generateContent") {
          return Response.json({
            candidates: [{ content: { parts: [{ text: "vertex test output" }] } }],
          });
        }
        return new Response("not found", { status: 404 });
      },
    } as never);

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "google-agent-platform-live",
            providerId: "official",
            upstreamId: "google-agent-platform",
            region: "global",
            enabled: true,
            priority: 1,
            credentials: {
              vertexCredentials: JSON.stringify({
                project_id: "vertex-project",
                client_email: "svc@vertex-project.iam.gserviceaccount.com",
                private_key: privateKey,
              }),
            },
          },
        ],
      }),
    });

    const response = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        live: true,
        provider: {
          id: "google-agent-platform-live",
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
        },
        modelId: "gemini-3-flash",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      providerId: "official",
      upstreamId: "google-agent-platform",
      region: "global",
      modelId: "gemini-3-flash",
      provider: "google-agent-platform",
      modelEndpoint: "gemini-3-flash-preview",
      input: {
        shape: "text",
        model: "gemini-3-flash",
        prompt: "Provider test for Gemini 3 Flash",
      },
      output: {
        shape: "text",
        provider: "google-agent-platform",
        endpoint: "gemini-3-flash-preview",
        text: "vertex test output",
      },
      message: "Google Cloud Agent Platform ran Gemini 3 Flash through gemini-3-flash-preview.",
    });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[1].init?.headers).toMatchObject({
      authorization: "Bearer vertex-access-token",
      "content-type": "application/json",
    });
  });

  it("runs a live provider test and records the upstream exchange when requested", async () => {
    const recordingPath = join(dataDir, "provider-recordings", "openai-image.jsonl");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerTestRecordingPath: recordingPath,
      providerTestOpenAiBaseUrl: "https://openai.test/v1",
      providerTestFetch: async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        calls.push({ url, init });
        return Response.json({
          id: "img_live_provider_test",
          data: [{ b64_json: Buffer.from("live-provider-image").toString("base64") }],
          providerRaw: { keep: "all response fields" },
        }, {
          headers: {
            "x-provider-request-id": "upstream-live-1",
          },
        });
      },
    } as never);

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "openai-live",
            providerId: "official",
            upstreamId: "openai",
            region: "global",
            enabled: true,
            priority: 1,
            credentials: { apiKey: "sk-live-test" },
          },
        ],
      }),
    });

    const response = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        live: true,
        provider: {
          id: "openai-live",
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
        },
        modelId: "gpt-image-2",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      providerId: "official",
      upstreamId: "openai",
      region: "global",
      modelId: "gpt-image-2",
      provider: "openai",
      requestId: "img_live_provider_test",
      modelEndpoint: "gpt-image-2",
      input: {
        shape: "image",
        model: "gpt-image-2",
        prompt: "Provider test for GPT Image 2",
        aspectRatio: "16:9",
      },
      output: {
        shape: "image",
        provider: "openai",
        endpoint: "gpt-image-2",
        requestId: "img_live_provider_test",
        contentType: "image/png",
      },
    });
    expect(calls).toHaveLength(1);
    const rawRecording = await readFile(recordingPath, "utf8");
    const events = rawRecording.trim().split("\n").map((line) => JSON.parse(line));
    expect(events).toEqual([
      expect.objectContaining({
        type: "request",
        stub: expect.objectContaining({
          providerId: "official",
          upstreamId: "openai",
          modelId: "gpt-image-2",
          shape: "image",
          apiShape: "openai-images",
        }),
        request: {
          url: "https://openai.test/v1/images/generations",
          method: "POST",
          headers: {
            authorization: "[redacted]",
            "content-type": "application/json",
          },
          body: expect.objectContaining({
            model: "gpt-image-2",
            prompt: "Provider test for GPT Image 2",
          }),
        },
      }),
      expect.objectContaining({
        type: "response",
        response: {
          status: 200,
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-provider-request-id": "upstream-live-1",
          }),
          body: {
            id: "img_live_provider_test",
            data: [{ b64_json: Buffer.from("live-provider-image").toString("base64") }],
            providerRaw: { keep: "all response fields" },
          },
        },
      }),
    ]);
  });

  it("tests Google AI Studio models with only the API key credential", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "google-ai-studio",
            providerId: "official",
            upstreamId: "google-ai-studio",
            region: "global",
            enabled: true,
            priority: 1,
            credentials: { apiKey: "gemini-api-key" },
          },
        ],
      }),
    });

    const ok = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
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
    });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      providerId: "official",
      upstreamId: "google-ai-studio",
      region: "global",
      modelId: "nano-banana-2",
      mutation: providerModelTestMutation("official", "nano-banana-2"),
      message: "Google AI Studio configuration is ready for Nano Banana 2.",
    });
  });

  it("tests Google Cloud Agent Platform models with only service account credentials", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "google-agent-platform",
            providerId: "official",
            upstreamId: "google-agent-platform",
            region: "global",
            enabled: true,
            priority: 1,
            credentials: { vertexCredentials: "{\"project\":\"demo\",\"clientEmail\":\"svc@example.com\",\"privateKey\":\"key\"}" },
          },
        ],
      }),
    });

    const ok = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: {
          id: "google-agent-platform",
          providerId: "official",
          upstreamId: "google-agent-platform",
          region: "global",
          enabled: true,
        },
        modelId: "veo-3.1",
      }),
    });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      providerId: "official",
      upstreamId: "google-agent-platform",
      region: "global",
      modelId: "veo-3.1",
      mutation: providerModelTestMutation("official", "veo-3.1"),
      message: "Google Cloud Agent Platform configuration is ready for Veo 3.1.",
    });
  });

  it("shares the single global Dreamina CLI authorization across provider configs", async () => {
    const oauth = {
      dreamina: {
        start: vi.fn(async () => ({
          verificationUri: "https://jimeng.jianying.com/device",
          userCode: "AAAA-BBBB",
          deviceCode: "device-code-primary",
          expiresAt: "2026-06-26T03:00:00.000Z",
          intervalSeconds: 5,
          oauthState: "dreamina-pending-oauth-state",
        })),
        complete: vi.fn(async () => ({
          accessToken: "access-token-primary",
          refreshToken: "refresh-token-primary",
          expiresAt: "2026-06-27T03:00:00.000Z",
          accountLabel: "Primary Dreamina",
        })),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary" }),
    });
    await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-primary" }),
    });

    const primary = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "jimeng-primary", providerId: "jimeng", upstreamId: "jimeng", enabled: true },
        modelId: "seedance-2-text",
      }),
    });
    expect(primary.status).toBe(200);
    expect(await primary.json()).toMatchObject({
      ok: true,
      providerId: "jimeng",
      upstreamId: "jimeng",
      modelId: "seedance-2-ref",
      message: "Dreamina configuration is ready for Seedance 2.0 (全能参考).",
    });

    const secondary = await app.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "jimeng-secondary", providerId: "jimeng", upstreamId: "jimeng", enabled: true },
        modelId: "seedance-2-text",
      }),
    });
    expect(secondary.status).toBe(200);
    expect(await secondary.json()).toMatchObject({
      ok: true,
      providerId: "jimeng",
      upstreamId: "jimeng",
      modelId: "seedance-2-ref",
      message: "Dreamina configuration is ready for Seedance 2.0 (全能参考).",
    });
  });

  it("persists provider account model filters and enforces them in catalog and tests", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "mock-primary",
            providerId: "mock",
            upstreamId: "mock",
            enabled: true,
            priority: 1,
            supportedModelIds: ["nano-banana-2"],
          },
        ],
      }),
    });

    expect(saved.status).toBe(200);
    const savedJson = (await saved.json()) as { providers: Array<Record<string, unknown>> };
    expect(savedJson.providers).toEqual([
      expect.objectContaining({
        id: "mock-primary",
        providerId: "mock",
        upstreamId: "mock",
        supportedModelIds: ["nano-banana-2"],
      }),
    ]);

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const catalog = await reopened.request("/api/v1/models/catalog");
    const catalogJson = (await catalog.json()) as {
      models: Array<{
        model: { id: string };
        tier: string;
        selectedRoute?: { providerId?: string; upstreamId?: string } | null;
      }>;
    };
    expect(catalogJson.models.find((entry) => entry.model.id === "nano-banana-2")).toMatchObject({
      tier: "available",
      selectedRoute: { providerId: "mock", upstreamId: "mock" },
    });
    expect(catalogJson.models.find((entry) => entry.model.id === "gpt-image-2")?.selectedRoute?.upstreamId).not.toBe("mock");

    const rejected = await reopened.request("/api/v1/model-providers/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: { id: "mock-primary", providerId: "mock", upstreamId: "mock", enabled: true },
        modelId: "gpt-image-2",
      }),
    });

    expect(rejected.status).toBe(200);
    expect(await rejected.json()).toEqual({
      ok: false,
      providerId: "mock",
      upstreamId: "mock",
      modelId: "gpt-image-2",
      mutation: providerModelTestMutation("mock", "gpt-image-2"),
      unsupported: true,
      message: "Mock provider is not enabled for GPT Image 2.",
    });
  });

  it("rejects provider account model filters outside the provider support list", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-text",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            supportedModelIds: ["claude-sonnet-4"],
            credentials: { apiKey: "r8-local-key" },
          },
        ],
      }),
    });

    expect(saved.status).toBe(400);
    expect(await saved.json()).toEqual({
      error: "Invalid provider model filters",
      invalidProviders: [
        {
          providerId: "replicate",
          upstreamId: "replicate",
          unsupportedModelIds: ["claude-sonnet-4"],
        },
      ],
      mutation: {
        operation: "provider_accounts_update",
        entity: { kind: "provider-accounts", id: "local-user" },
        accepted: false,
        error: "Invalid provider model filters",
      },
    });
  });

  it("deletes a saved provider account config", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-primary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            priority: 10,
            credentials: { apiKey: "r8-primary" },
          },
          {
            id: "replicate-secondary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            priority: 20,
            credentials: { apiKey: "r8-secondary" },
          },
        ],
      }),
    });

    const deleted = await app.request("/api/v1/model-providers/replicate-primary", { method: "DELETE" });

    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      ok: true,
      mutation: {
        operation: "provider_account_delete",
        entity: { kind: "provider-account", id: "replicate-primary" },
        resultEntityId: "replicate-primary",
        accepted: true,
      },
    });
    const providers = await app.request("/api/v1/model-providers");
    const providersJson = (await providers.json()) as { providers: Array<{ id?: string }> };
    expect(providersJson.providers.map((provider) => provider.id)).toEqual(["replicate-secondary"]);
  });

  it("accepts cwd observed versions for provider writes and rejects stale versions", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const initial = await app.request("/api/v1/model-providers");
    const initialJson = await initial.json() as { readToken: string };
    const observedVersion = baseReadToken(initialJson.readToken);

    const updated = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-observed-version": observedVersion,
      },
      body: JSON.stringify({
        providers: [{ providerId: "replicate", upstreamId: "replicate", enabled: true }],
      }),
    });
    expect(updated.status).toBe(200);

    const stale = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-observed-version": observedVersion,
      },
      body: JSON.stringify({
        providers: [{ providerId: "replicate", upstreamId: "replicate", enabled: false }],
      }),
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ error: expect.stringMatching(/^STALE_READ:/) });
  });

  it("requires receipt-bearing provider account reads before agent provider writes", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            id: "replicate-primary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            weight: 10,
            credentials: { apiKey: "r8-primary" },
          },
          {
            id: "replicate-secondary",
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            weight: 5,
            credentials: { apiKey: "r8-secondary" },
          },
        ],
      }),
    });

    const initial = await app.request("/api/v1/model-providers");
    const initialJson = await initial.json() as {
      readToken?: string;
      providers: Array<{ id?: string; weight?: number; readToken?: string }>;
    };
    expect(initialJson.readToken).toMatch(PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE);
    const initialPrimary = initialJson.providers.find((provider) => provider.id === "replicate-primary");
    expect(initialPrimary?.readToken).toMatch(PROVIDER_ACCOUNT_RECEIPT_READ_TOKEN_RE);

    const missingUpdate = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({
        providers: [{ id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", weight: 11 }],
      }),
    });
    expect(missingUpdate.status).toBe(409);
    expect(await missingUpdate.json()).toMatchObject({
      mutation: {
        operation: "provider_accounts_update",
        entity: { kind: "provider-accounts", id: "local-user" },
        accepted: false,
      },
    });

    const bareUpdate = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(initialJson.readToken!),
      },
      body: JSON.stringify({
        providers: [{ id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", weight: 11 }],
      }),
    });
    expect(bareUpdate.status).toBe(409);
    const bareUpdateJson = await bareUpdate.json() as { error?: string };
    expect(bareUpdateJson.error).toContain("Missing provider accounts update read receipt");

    const updated = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
      body: JSON.stringify({
        providers: [{ id: "replicate-primary", providerId: "replicate", upstreamId: "replicate", weight: 11 }],
      }),
    });
    expect(updated.status).toBe(200);
    const updatedJson = await updated.json() as {
      readToken?: string;
      providers: Array<{ id?: string; weight?: number; readToken?: string }>;
      mutation?: any;
    };
    expect(updatedJson.readToken).toMatch(PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE);
    expect(updatedJson.readToken).not.toBe(initialJson.readToken);
    expect(updatedJson.providers.find((provider) => provider.id === "replicate-primary")?.weight).toBe(11);
    expect(updatedJson.mutation).toMatchObject({
      operation: "provider_accounts_update",
      entity: { kind: "provider-accounts", id: "local-user" },
      expectedReadToken: initialJson.readToken,
      beforeReadToken: baseReadToken(initialJson.readToken!),
      afterReadToken: updatedJson.readToken,
      accepted: true,
    });
    const updateAudit = await app.request("/api/v1/mutation-audit?operation=provider_accounts_update&entityId=local-user");
    expect(updateAudit.status).toBe(200);
    const updateAuditJson = await updateAudit.json() as { records: Array<any> };
    expect(updateAuditJson.records).toHaveLength(2);
    const humanUpdateAuditRecord = updateAuditJson.records.find((record) => record.actorClientType == null);
    const agentUpdateAuditRecord = updateAuditJson.records.find((record) => record.actorClientType === "agent");
    expect(humanUpdateAuditRecord).toMatchObject({
      operation: "provider_accounts_update",
      entity: { kind: "provider-accounts", id: "local-user" },
      actorClientType: null,
      accepted: true,
      reason: "provider accounts update",
      resultEntityId: "local-user",
    });
    expect(agentUpdateAuditRecord).toMatchObject({
      operation: "provider_accounts_update",
      entity: { kind: "provider-accounts", id: "local-user" },
      actorClientType: "agent",
      accepted: true,
      reason: "provider accounts update",
      resultEntityId: "local-user",
    });
    for (const record of updateAuditJson.records) {
      expect(JSON.stringify(record.mutation ?? {})).not.toContain("receipt");
      expect(record.mutation.expectedReadToken).toBeUndefined();
      expect(record.mutation.beforeReadToken).toBeUndefined();
      expect(record.mutation.afterReadToken).toBeUndefined();
    }

    const missingDelete = await app.request("/api/v1/model-providers/replicate-primary", {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missingDelete.status).toBe(409);
    expect(await missingDelete.json()).toMatchObject({
      mutation: {
        operation: "provider_account_delete",
        entity: { kind: "provider-account", id: "replicate-primary" },
        accepted: false,
      },
    });

    const staleDelete = await app.request("/api/v1/model-providers/replicate-primary", {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialPrimary!.readToken!,
      },
    });
    expect(staleDelete.status).toBe(409);
    const staleDeleteJson = await staleDelete.json() as { mutation?: any };
    expect(staleDeleteJson.mutation.expectedReadToken).toBe(initialPrimary!.readToken);
    expect(staleDeleteJson.mutation.beforeReadToken).not.toBe(baseReadToken(initialPrimary!.readToken!));

    const freshPrimary = updatedJson.providers.find((provider) => provider.id === "replicate-primary");
    expect(freshPrimary?.readToken).toMatch(PROVIDER_ACCOUNT_RECEIPT_READ_TOKEN_RE);
    const bareDelete = await app.request("/api/v1/model-providers/replicate-primary", {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(freshPrimary!.readToken!),
      },
    });
    expect(bareDelete.status).toBe(409);
    const bareDeleteJson = await bareDelete.json() as { error?: string };
    expect(bareDeleteJson.error).toContain("Missing provider account delete read receipt");

    const deleted = await app.request("/api/v1/model-providers/replicate-primary", {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": freshPrimary!.readToken!,
      },
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      ok: true,
      mutation: {
        operation: "provider_account_delete",
        entity: { kind: "provider-account", id: "replicate-primary" },
        expectedReadToken: freshPrimary!.readToken,
        beforeReadToken: baseReadToken(freshPrimary!.readToken!),
        accepted: true,
      },
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=provider_account_delete&entityId=replicate-primary");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "provider_account_delete",
      entity: { kind: "provider-account", id: "replicate-primary" },
      accepted: true,
      actorClientType: "agent",
      reason: "provider account delete",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();

    const providers = await app.request("/api/v1/model-providers");
    const providersJson = (await providers.json()) as { providers: Array<{ id?: string }> };
    expect(providersJson.providers.map((provider) => provider.id)).toEqual(["replicate-secondary"]);
  });

  it("persists per-model provider priority without changing other model routing", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const saved = await app.request("/api/v1/model-providers", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providers: [
          {
            providerId: "fal",
            upstreamId: "fal",
            enabled: true,
            configuredCredentials: ["apiKey"],
            modelPriorities: { "nano-banana-2": 20 },
            credentials: { apiKey: "fal-local-key" },
          },
          {
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            configuredCredentials: ["apiKey"],
            modelPriorities: { "nano-banana-2": 10 },
            credentials: { apiKey: "r8-local-key" },
          },
        ],
      }),
    });

    expect(saved.status).toBe(200);
    const savedJson = (await saved.json()) as { providers: Array<Record<string, unknown>> };
    expect(savedJson.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        providerId: "fal",
        upstreamId: "fal",
        modelPriorities: { "nano-banana-2": 20 },
      }),
      expect.objectContaining({
        providerId: "replicate",
        upstreamId: "replicate",
        modelPriorities: { "nano-banana-2": 10 },
      }),
    ]));

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const catalog = await reopened.request("/api/v1/models/catalog");
    const catalogJson = (await catalog.json()) as {
      models: Array<{
        model: { id: string };
        selectedRoute?: { providerId?: string; upstreamId?: string } | null;
      }>;
    };

    expect(catalogJson.models.find((entry) => entry.model.id === "nano-banana-2")).toMatchObject({
      selectedRoute: { providerId: "replicate", upstreamId: "replicate" },
    });
    expect(catalogJson.models.find((entry) => entry.model.id === "flux-schnell")).toMatchObject({
      selectedRoute: { providerId: "fal", upstreamId: "fal" },
    });
  });

  it("records mutation envelopes for provider OAuth lifecycle writes", async () => {
    const unsupported = createLocalApiApp({ dataDir, userId: "local-user" });
    const unsupportedStart = await unsupported.request("/api/v1/provider-oauth/not-real/start", {
      method: "POST",
    });
    expect(unsupportedStart.status).toBe(404);
    expect(await unsupportedStart.json()).toEqual({
      error: "Unsupported OAuth provider",
      mutation: {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: "not-real" },
        accepted: false,
        error: "Unsupported OAuth provider",
      },
    });

    const notConfigured = await unsupported.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
    });
    expect(notConfigured.status).toBe(501);
    expect(await notConfigured.json()).toEqual({
      error: "OAuth provider is not configured",
      mutation: {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: "dreamina" },
        accepted: false,
        error: "OAuth provider is not configured",
      },
    });

    const oauth = {
      dreamina: {
        start: vi.fn(async () => ({
          verificationUri: "https://jimeng.jianying.com/device",
          userCode: "ABCD-EFGH",
          deviceCode: "device-code-1",
          expiresAt: "2026-06-26T03:00:00.000Z",
          intervalSeconds: 5,
        })),
        complete: vi.fn(async () => ({
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          expiresAt: "2026-06-27T03:00:00.000Z",
          accountLabel: "Dreamina VIP",
        })),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    const start = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina" }),
    });
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({
      providerId: "dreamina",
      status: "pending",
      mutation: {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: "dreamina" },
        resultEntityId: "dreamina",
        accepted: true,
      },
    });

    const complete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-1" }),
    });
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({
      providerId: "dreamina",
      status: "authorized",
      mutation: {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        resultEntityId: "dreamina",
        accepted: true,
      },
    });

    const deleted = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({
      ok: true,
      mutation: {
        operation: "provider_oauth_delete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        resultEntityId: "dreamina",
        accepted: true,
      },
    });
  });

  it("requires receipt-bearing provider OAuth reads before agent OAuth deletion", async () => {
    const oauth = {
      dreamina: {
        start: vi.fn(async () => ({
          verificationUri: "https://jimeng.jianying.com/device",
          userCode: "ABCD-EFGH",
          deviceCode: "device-code-1",
          expiresAt: "2026-06-26T03:00:00.000Z",
          intervalSeconds: 5,
        })),
        complete: vi.fn(async () => ({
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          expiresAt: "2026-06-27T03:00:00.000Z",
          accountLabel: "Dreamina VIP",
        })),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    const start = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina" }),
    });
    expect(start.status).toBe(200);

    const listedPending = await app.request("/api/v1/provider-oauth");
    const listedPendingJson = await listedPending.json() as {
      providers: Array<{ providerId: string; accountId?: string; status: string; readToken?: string }>;
    };
    const pending = listedPendingJson.providers.find((provider) => provider.providerId === "dreamina");
    expect(pending?.readToken).toMatch(PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE);

    const missingDelete = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missingDelete.status).toBe(409);
    expect(await missingDelete.json()).toMatchObject({
      mutation: {
        operation: "provider_oauth_delete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        accepted: false,
      },
    });

    const bareDelete = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(pending!.readToken!),
      },
    });
    expect(bareDelete.status).toBe(409);
    const bareDeleteJson = await bareDelete.json() as { error?: string };
    expect(bareDeleteJson.error).toContain("Missing provider OAuth delete read receipt");

    const complete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-1" }),
    });
    expect(complete.status).toBe(200);

    const staleDelete = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": pending!.readToken!,
      },
    });
    expect(staleDelete.status).toBe(409);
    const staleDeleteJson = await staleDelete.json() as { mutation?: any };
    expect(staleDeleteJson.mutation.expectedReadToken).toBe(pending!.readToken);
    expect(staleDeleteJson.mutation.beforeReadToken).not.toBe(baseReadToken(pending!.readToken!));

    const listedAuthorized = await app.request("/api/v1/provider-oauth");
    const listedAuthorizedJson = await listedAuthorized.json() as {
      providers: Array<{ providerId: string; accountId?: string; status: string; readToken?: string }>;
    };
    const authorized = listedAuthorizedJson.providers.find((provider) => provider.providerId === "dreamina");
    expect(authorized?.status).toBe("authorized");
    expect(authorized?.readToken).toMatch(PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE);

    const acceptedDelete = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": authorized!.readToken!,
      },
    });
    expect(acceptedDelete.status).toBe(200);
    expect(await acceptedDelete.json()).toMatchObject({
      ok: true,
      mutation: {
        operation: "provider_oauth_delete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        expectedReadToken: authorized!.readToken,
        beforeReadToken: baseReadToken(authorized!.readToken!),
        resultEntityId: "dreamina",
        accepted: true,
      },
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=provider_oauth_delete&entityId=dreamina");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "provider_oauth_delete",
      entity: { kind: "provider-oauth", id: "dreamina" },
      accepted: true,
      actorClientType: "agent",
      reason: "provider OAuth delete",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();

    const listedAfterDelete = await app.request("/api/v1/provider-oauth");
    expect(await listedAfterDelete.json()).toEqual({ providers: [] });

    const missingAfterDelete = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missingAfterDelete.status).toBe(409);
    expect(await missingAfterDelete.json()).toMatchObject({
      error: expect.stringContaining("Provider OAuth record not found"),
      mutation: {
        operation: "provider_oauth_delete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        accepted: false,
      },
    });
  });

  it("requires receipt-bearing provider OAuth reads before agent restarts an existing OAuth flow", async () => {
    let startCall = 0;
    const oauth = {
      dreamina: {
        start: vi.fn(async () => {
          startCall += 1;
          return {
            verificationUri: "https://jimeng.jianying.com/device",
            userCode: `CODE-${startCall}`,
            deviceCode: `device-code-${startCall}`,
            expiresAt: "2026-06-26T03:00:00.000Z",
            intervalSeconds: 5,
          };
        }),
        complete: vi.fn(),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    const start = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina" }),
    });
    expect(start.status).toBe(200);
    oauth.dreamina.start.mockClear();

    const listedPending = await app.request("/api/v1/provider-oauth");
    const listedPendingJson = await listedPending.json() as {
      providers: Array<{ providerId: string; accountId?: string; status: string; readToken?: string }>;
    };
    const pending = listedPendingJson.providers.find((provider) => provider.providerId === "dreamina");
    expect(pending?.status).toBe("pending");
    expect(pending?.readToken).toMatch(PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE);

    const missingStart = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina restart" }),
    });
    expect(missingStart.status).toBe(409);
    expect(await missingStart.json()).toMatchObject({
      mutation: {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: "dreamina" },
        accepted: false,
      },
    });
    expect(oauth.dreamina.start).not.toHaveBeenCalled();

    const bareStart = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(pending!.readToken!),
      },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina restart" }),
    });
    expect(bareStart.status).toBe(409);
    const bareStartJson = await bareStart.json() as { error?: string };
    expect(bareStartJson.error).toContain("Missing provider OAuth start read receipt");
    expect(oauth.dreamina.start).not.toHaveBeenCalled();

    const acceptedStart = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": pending!.readToken!,
      },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina restart" }),
    });
    expect(acceptedStart.status).toBe(200);
    const acceptedStartJson = await acceptedStart.json() as { readToken?: string; mutation?: any; status?: string };
    expect(acceptedStartJson.status).toBe("pending");
    expect(acceptedStartJson.readToken).toMatch(PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE);
    expect(acceptedStartJson.readToken).not.toBe(pending!.readToken);
    expect(acceptedStartJson.mutation).toMatchObject({
      operation: "provider_oauth_start",
      entity: { kind: "provider-oauth", id: "dreamina" },
      expectedReadToken: pending!.readToken,
      beforeReadToken: baseReadToken(pending!.readToken!),
      afterReadToken: acceptedStartJson.readToken,
      accepted: true,
      resultEntityId: "dreamina",
    });
    expect(oauth.dreamina.start).toHaveBeenCalledTimes(1);
    const startAudit = await app.request("/api/v1/mutation-audit?operation=provider_oauth_start&entityId=dreamina");
    expect(startAudit.status).toBe(200);
    const startAuditJson = await startAudit.json() as { records: Array<any> };
    expect(startAuditJson.records).toHaveLength(2);
    const humanStartAuditRecord = startAuditJson.records.find((record) => record.actorClientType == null);
    const agentStartAuditRecord = startAuditJson.records.find((record) => record.actorClientType === "agent");
    expect(humanStartAuditRecord).toMatchObject({
      operation: "provider_oauth_start",
      entity: { kind: "provider-oauth", id: "dreamina" },
      actorClientType: null,
      accepted: true,
      reason: "provider OAuth start",
      resultEntityId: "dreamina",
    });
    expect(agentStartAuditRecord).toMatchObject({
      operation: "provider_oauth_start",
      entity: { kind: "provider-oauth", id: "dreamina" },
      actorClientType: "agent",
      accepted: true,
      reason: "provider OAuth start",
      resultEntityId: "dreamina",
    });
    for (const record of startAuditJson.records) {
      expect(JSON.stringify(record.mutation ?? {})).not.toContain("receipt");
      expect(record.mutation.expectedReadToken).toBeUndefined();
      expect(record.mutation.beforeReadToken).toBeUndefined();
      expect(record.mutation.afterReadToken).toBeUndefined();
    }

    const staleStart = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": pending!.readToken!,
      },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina restart" }),
    });
    expect(staleStart.status).toBe(409);
    const staleStartJson = await staleStart.json() as { mutation?: any };
    expect(staleStartJson.mutation.expectedReadToken).toBe(pending!.readToken);
    expect(staleStartJson.mutation.beforeReadToken).not.toBe(baseReadToken(pending!.readToken!));
    expect(oauth.dreamina.start).toHaveBeenCalledTimes(1);

    const deleted = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);

    const missingAfterDeleteStart = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": acceptedStartJson.readToken!,
      },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina restart" }),
    });
    expect(missingAfterDeleteStart.status).toBe(409);
    expect(await missingAfterDeleteStart.json()).toMatchObject({
      mutation: {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: "dreamina" },
        expectedReadToken: acceptedStartJson.readToken,
        accepted: false,
      },
    });
    expect(oauth.dreamina.start).toHaveBeenCalledTimes(1);
  });

  it("requires receipt-bearing provider OAuth reads before agent OAuth completion", async () => {
    const oauth = {
      dreamina: {
        start: vi.fn(async () => ({
          verificationUri: "https://jimeng.jianying.com/device",
          userCode: "ABCD-EFGH",
          deviceCode: "device-code-1",
          expiresAt: "2026-06-26T03:00:00.000Z",
          intervalSeconds: 5,
        })),
        complete: vi.fn(async () => ({
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          expiresAt: "2026-06-27T03:00:00.000Z",
          accountLabel: "Dreamina VIP",
        })),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    const start = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina" }),
    });
    expect(start.status).toBe(200);
    const listedPending = await app.request("/api/v1/provider-oauth");
    const listedPendingJson = await listedPending.json() as {
      providers: Array<{ providerId: string; accountId?: string; status: string; readToken?: string }>;
    };
    const pending = listedPendingJson.providers.find((provider) => provider.providerId === "dreamina");
    expect(pending?.readToken).toMatch(PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE);

    const missingComplete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-1" }),
    });
    expect(missingComplete.status).toBe(409);
    expect(await missingComplete.json()).toMatchObject({
      mutation: {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        accepted: false,
      },
    });
    expect(oauth.dreamina.complete).not.toHaveBeenCalled();

    const bareComplete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(pending!.readToken!),
      },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-1" }),
    });
    expect(bareComplete.status).toBe(409);
    const bareCompleteJson = await bareComplete.json() as { error?: string };
    expect(bareCompleteJson.error).toContain("Missing provider OAuth complete read receipt");
    expect(oauth.dreamina.complete).not.toHaveBeenCalled();

    const acceptedComplete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": pending!.readToken!,
      },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-1" }),
    });
    expect(acceptedComplete.status).toBe(200);
    const acceptedCompleteJson = await acceptedComplete.json() as { readToken?: string; mutation?: any; status?: string };
    expect(acceptedCompleteJson.status).toBe("authorized");
    expect(acceptedCompleteJson.readToken).toMatch(PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE);
    expect(acceptedCompleteJson.readToken).not.toBe(pending!.readToken);
    expect(acceptedCompleteJson.mutation).toMatchObject({
      operation: "provider_oauth_complete",
      entity: { kind: "provider-oauth", id: "dreamina" },
      expectedReadToken: pending!.readToken,
      beforeReadToken: baseReadToken(pending!.readToken!),
      afterReadToken: acceptedCompleteJson.readToken,
      accepted: true,
      resultEntityId: "dreamina",
    });
    expect(oauth.dreamina.complete).toHaveBeenCalledTimes(1);
    const completeAudit = await app.request("/api/v1/mutation-audit?operation=provider_oauth_complete&entityId=dreamina");
    expect(completeAudit.status).toBe(200);
    const completeAuditJson = await completeAudit.json() as { records: Array<any> };
    expect(completeAuditJson.records).toHaveLength(1);
    expect(completeAuditJson.records[0]).toMatchObject({
      operation: "provider_oauth_complete",
      entity: { kind: "provider-oauth", id: "dreamina" },
      actorClientType: "agent",
      accepted: true,
      reason: "provider OAuth complete",
      resultEntityId: "dreamina",
    });
    expect(JSON.stringify(completeAuditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(completeAuditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(completeAuditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(completeAuditJson.records[0].mutation.afterReadToken).toBeUndefined();

    const staleComplete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": pending!.readToken!,
      },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-1" }),
    });
    expect(staleComplete.status).toBe(409);
    const staleCompleteJson = await staleComplete.json() as { mutation?: any };
    expect(staleCompleteJson.mutation.expectedReadToken).toBe(pending!.readToken);
    expect(staleCompleteJson.mutation.beforeReadToken).not.toBe(baseReadToken(pending!.readToken!));
    expect(oauth.dreamina.complete).toHaveBeenCalledTimes(1);

    const deleted = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);

    const missingWithIfMatch = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-if-match": acceptedCompleteJson.readToken!,
      },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-1" }),
    });
    expect(missingWithIfMatch.status).toBe(409);
    expect(await missingWithIfMatch.json()).toMatchObject({
      error: expect.stringContaining("Provider OAuth record not found"),
      mutation: {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        expectedReadToken: acceptedCompleteJson.readToken,
        accepted: false,
      },
    });
    expect(oauth.dreamina.complete).toHaveBeenCalledTimes(1);
  });

  it("manages provider OAuth device flow and exposes connected providers", async () => {
    const oauth = {
      dreamina: {
        start: vi.fn(async () => ({
          verificationUri: "https://jimeng.jianying.com/device",
          userCode: "ABCD-EFGH",
          deviceCode: "device-code-1",
          expiresAt: "2026-06-26T03:00:00.000Z",
          intervalSeconds: 5,
          oauthState: "dreamina-pending-oauth-state",
        })),
        complete: vi.fn(async () => ({
          accessToken: "access-token-1",
          refreshToken: "refresh-token-1",
          expiresAt: "2026-06-27T03:00:00.000Z",
          accountLabel: "Dreamina VIP",
        })),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    const start = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
    });
    expect(start.status).toBe(200);
    expect(await start.json()).toEqual({
      providerId: "dreamina",
      status: "pending",
      verificationUri: "https://jimeng.jianying.com/device",
      userCode: "ABCD-EFGH",
      deviceCode: "device-code-1",
      expiresAt: "2026-06-26T03:00:00.000Z",
      intervalSeconds: 5,
      hasAccessToken: false,
      mutation: {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: "dreamina" },
        resultEntityId: "dreamina",
        accepted: true,
      },
    });

    const listedPending = await app.request("/api/v1/provider-oauth");
    expect(await listedPending.json()).toEqual({
      providers: [
        expect.objectContaining({
          providerId: "dreamina",
          status: "pending",
          hasAccessToken: false,
        }),
      ],
    });

    let sqlite = openSqlite();
    try {
      const pending = sqlite.prepare("select user_code, device_code from provider_oauth").get();
      expect(pending?.user_code).not.toBe("ABCD-EFGH");
      expect(pending?.device_code).not.toBe("device-code-1");
      expect(String(pending?.user_code)).toMatch(/^enc:v1:/);
      expect(String(pending?.device_code)).toMatch(/^enc:v1:/);
      const pendingState = sqlite.prepare("select oauth_state from provider_oauth").get();
      expect(pendingState?.oauth_state).not.toBe("dreamina-pending-oauth-state");
      expect(String(pendingState?.oauth_state)).toMatch(/^enc:v1:/);
    } finally {
      sqlite.close();
    }

    const complete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: "device-code-1" }),
    });
    expect(complete.status).toBe(200);
    expect(oauth.dreamina.complete).toHaveBeenCalledWith({
      deviceCode: "device-code-1",
      oauthState: "dreamina-pending-oauth-state",
    });
    expect(await complete.json()).toEqual({
      providerId: "dreamina",
      status: "authorized",
      accountLabel: "Dreamina VIP",
      expiresAt: "2026-06-27T03:00:00.000Z",
      hasAccessToken: true,
      mutation: {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        resultEntityId: "dreamina",
        accepted: true,
      },
    });

    const providers = await app.request("/api/v1/model-providers");
    expect(await providers.json()).toEqual({
      providers: [
        expect.objectContaining({
          providerId: "jimeng",
          upstreamId: "jimeng",
          enabled: true,
          availableOAuth: ["dreamina"],
        }),
      ],
      readToken: expect.stringMatching(PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE),
    });

    sqlite = openSqlite();
    try {
      const authorized = sqlite.prepare("select access_token, refresh_token from provider_oauth").get();
      expect(authorized?.access_token).not.toBe("access-token-1");
      expect(authorized?.refresh_token).not.toBe("refresh-token-1");
      expect(String(authorized?.access_token)).toMatch(/^enc:v1:/);
      expect(String(authorized?.refresh_token)).toMatch(/^enc:v1:/);
    } finally {
      sqlite.close();
    }
  });

  it("collapses provider config account IDs into one Clash-global Dreamina OAuth flow", async () => {
    const oauth = {
      dreamina: {
        start: vi
          .fn()
          .mockResolvedValueOnce({
            verificationUri: "https://jimeng.jianying.com/device",
            userCode: "AAAA-BBBB",
            deviceCode: "device-code-primary",
            expiresAt: "2026-06-26T03:00:00.000Z",
            intervalSeconds: 5,
          })
          .mockResolvedValueOnce({
            verificationUri: "https://jimeng.jianying.com/device",
            userCode: "CCCC-DDDD",
            deviceCode: "device-code-secondary",
            expiresAt: "2026-06-26T04:00:00.000Z",
            intervalSeconds: 5,
          }),
        complete: vi.fn(async ({ deviceCode }: { deviceCode: string }) => ({
          accessToken: `access-token-${deviceCode}`,
          refreshToken: `refresh-token-${deviceCode}`,
          expiresAt: "2026-06-27T03:00:00.000Z",
          accountLabel: deviceCode.includes("primary") ? "Primary Dreamina" : "Secondary Dreamina",
        })),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    const primaryStart = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary" }),
    });
    expect(primaryStart.status).toBe(200);
    expect(await primaryStart.json()).toMatchObject({
      providerId: "dreamina",
      status: "pending",
      deviceCode: "device-code-primary",
    });

    const secondaryStart = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-secondary" }),
    });
    expect(secondaryStart.status).toBe(200);
    expect(await secondaryStart.json()).toMatchObject({
      providerId: "dreamina",
      status: "pending",
      deviceCode: "device-code-secondary",
    });

    const secondaryComplete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-secondary", deviceCode: "device-code-secondary" }),
    });
    expect(secondaryComplete.status).toBe(200);
    expect(await secondaryComplete.json()).toMatchObject({
      providerId: "dreamina",
      accountLabel: "Secondary Dreamina",
      status: "authorized",
      hasAccessToken: true,
    });

    const listed = await app.request("/api/v1/provider-oauth");
    expect(await listed.json()).toEqual({
      providers: [
        expect.objectContaining({
          providerId: "dreamina",
          accountLabel: "Secondary Dreamina",
          status: "authorized",
        }),
      ],
    });
    expect(oauth.dreamina.start).toHaveBeenCalledTimes(2);
    expect(oauth.dreamina.complete).toHaveBeenCalledTimes(1);
  });

  it("records provider OAuth completion failures on the global Dreamina authorization", async () => {
    const oauth = {
      dreamina: {
        start: vi.fn(async () => ({
          verificationUri: "https://jimeng.jianying.com/device",
          userCode: "FAIL-CODE",
          deviceCode: "device-code-fails",
          expiresAt: "2026-06-26T03:00:00.000Z",
          intervalSeconds: 5,
        })),
        complete: vi.fn(async () => {
          throw new Error("Dreamina device code expired");
        }),
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: oauth,
    } as any);

    const start = await app.request("/api/v1/provider-oauth/dreamina/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", accountLabel: "Primary Dreamina" }),
    });
    expect(start.status).toBe(200);

    const complete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-fails" }),
    });
    expect(complete.status).toBe(502);
    expect(await complete.json()).toEqual({
      error: "Dreamina device code expired",
      mutation: {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: "dreamina" },
        resultEntityId: "dreamina",
        accepted: true,
      },
    });

    const listed = await app.request("/api/v1/provider-oauth");
    expect(await listed.json()).toEqual({
      providers: [
        expect.objectContaining({
          providerId: "dreamina",
          accountLabel: "Primary Dreamina",
          status: "error",
          error: "Dreamina device code expired",
          hasAccessToken: false,
        }),
      ],
    });
  });

  it("encrypts authorized Dreamina OAuth even when membership makes the provider unavailable", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      providerOAuth: {
        dreamina: {
          start: vi.fn(),
          complete: vi.fn(async () => ({
            accessToken: "dreamina-oauth-envelope",
            tokenType: "DREAMINA_KEYRING_V1",
            accountLabel: "Dreamina CLI",
            availabilityError: "仅限高级或高级以上的会员等级",
          })),
        },
      },
    } as any);

    const complete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: "authorized-device" }),
    });
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({
      providerId: "dreamina",
      status: "error",
      error: "仅限高级或高级以上的会员等级",
      hasAccessToken: true,
    });

    const sqlite = openSqlite();
    try {
      const stored = sqlite.prepare("select access_token from provider_oauth where provider_id = 'dreamina'").get();
      expect(stored?.access_token).not.toBe("dreamina-oauth-envelope");
      expect(String(stored?.access_token)).toMatch(/^enc:v1:/);
    } finally {
      sqlite.close();
    }
    const providers = await app.request("/api/v1/model-providers");
    expect(JSON.stringify(await providers.json())).not.toContain('"availableOAuth":["dreamina"]');
  });

  it("allows browser requests from the local web runtime", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const preflight = await app.request("/api/v1/projects", {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:3001",
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3001");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

    const session = await app.request("/api/better-auth/get-session", {
      headers: { origin: "http://127.0.0.1:3001" },
    });
    expect(session.status).toBe(200);
    expect(session.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3001");
    expect(session.headers.get("access-control-allow-credentials")).toBe("true");

    const desktopPreflight = await app.request("/api/v1/projects", {
      method: "OPTIONS",
      headers: {
        origin: "clash://app",
        "access-control-request-method": "GET",
      },
    });
    expect(desktopPreflight.headers.get("access-control-allow-origin")).toBe("clash://app");
    expect(desktopPreflight.headers.get("access-control-allow-credentials")).toBe("true");

    const agent = await app.request("/api/v1/agents");
    const agentJson = (await agent.json()) as { agents: Array<Record<string, unknown>> };
    expect(agentJson.agents).toEqual([
      expect.objectContaining({
        id: "local-master-clash",
        user_id: "local-user",
        template_id: "master-clash",
        runtime_id: "desktop-local",
        agent_id: null,
        display_name: "Master Clash",
        runtime_label: "Local Desktop",
        runtime_status: "online",
      }),
    ]);
  });

  it("rejects browser requests from non-local origins", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const preflight = await app.request("/api/v1/projects", {
      method: "OPTIONS",
      headers: {
        origin: "https://attacker.example",
        "access-control-request-method": "POST",
      },
    });
    expect(preflight.status).toBe(403);

    const mutation = await app.request("/api/v1/projects", {
      method: "POST",
      headers: {
        origin: "https://attacker.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Cross-origin project" }),
    });
    expect(mutation.status).toBe(403);
    expect(await mutation.json()).toEqual({ error: "origin not allowed" });

    const listed = await app.request("/api/v1/projects");
    const body = await listed.json() as { projects: Array<{ name: string }> };
    expect(body.projects.some((project) => project.name === "Cross-origin project")).toBe(false);
  });

  it("does not persist derived built-in agent members from the agents read endpoint", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Read-only agents" }),
    });
    expect(created.status).toBe(201);

    const agent = await app.request("/api/v1/agents");
    const agentJson = (await agent.json()) as { agents: Array<Record<string, unknown>> };
    expect(agentJson.agents).toEqual([
      expect.objectContaining({
        id: "local-master-clash",
        user_id: "local-user",
        template_id: "master-clash",
      }),
    ]);

    const sqlite = openSqlite();
    try {
      const row = sqlite.prepare("SELECT COUNT(*) AS count FROM agent_member").get();
      expect(row?.count).toBe(0);
    } finally {
      sqlite.close();
    }
  });

  it("waits for the server-owned ACP startup barrier before publishing runtime capabilities", async () => {
    let releaseReady!: () => void;
    const localAcpReady = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const listRuntimes = vi.fn(async () => ({ runtimes: [] }));
    const listHarnesses = vi.fn(async () => ({ harnesses: [] }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcpReady,
      localAcp: {
        listRuntimes,
        async createSession() {
          return { session_id: "unused" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        listHarnesses,
      },
    });

    let readySettled = false;
    const readyRequest = Promise.resolve(app.request("/api/v1/runtimes")).then((response) => {
      readySettled = true;
      return response;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(readySettled).toBe(false);
    expect(listRuntimes).not.toHaveBeenCalled();

    let harnessesSettled = false;
    const harnessesRequest = Promise.resolve(app.request("/api/v1/local/harnesses")).then((response) => {
      harnessesSettled = true;
      return response;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(harnessesSettled).toBe(false);
    expect(listHarnesses).not.toHaveBeenCalled();

    const snapshot = await app.request("/api/v1/runtimes?readiness=snapshot");
    expect(snapshot.status).toBe(200);
    expect(listRuntimes).toHaveBeenCalledOnce();

    releaseReady();
    expect((await readyRequest).status).toBe(200);
    expect((await harnessesRequest).status).toBe(200);
    expect(listRuntimes).toHaveBeenCalledTimes(2);
    expect(listHarnesses).toHaveBeenCalledOnce();
  });

  it("persists homepage composer run choices without creating an ACP session", async () => {
    const updateRunPreferences = vi.fn(async () => ({
      preferences: {
        agent_id: "codex-acp",
        config_by_agent: {
          "codex-acp": {
            model: "gpt-5.6-sol",
            effort: "high",
          },
        },
        mode_by_agent: {
          "codex-acp": "agent",
        },
      },
    }));
    const createSession = vi.fn(async () => ({ session_id: "unused" }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        createSession,
        updateRunPreferences,
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const response = await app.request("/api/v1/runtimes/desktop-local/preferences", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        config_values: {
          model: "gpt-5.6-sol",
          effort: "high",
        },
        mode_id: "agent",
      }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      preferences: {
        agent_id: "codex-acp",
        config_by_agent: {
          "codex-acp": {
            model: "gpt-5.6-sol",
            effort: "high",
          },
        },
        mode_by_agent: {
          "codex-acp": "agent",
        },
      },
    });
    expect(updateRunPreferences).toHaveBeenCalledWith({
      agent_id: "codex-acp",
      config_values: {
        model: "gpt-5.6-sol",
        effort: "high",
      },
      mode_id: "agent",
    });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("surfaces and starts the desktop local ACP runtime from an agent without exposing agent roles", async () => {
    const starts: unknown[] = [];
    const updateRunPreferences = vi.fn(async () => ({
      preferences: {
        agent_id: "codex-acp",
        config_by_agent: {
          "codex-acp": {
            model: "gpt-5.6-sol",
            effort: "high",
          },
        },
        mode_by_agent: {
          "codex-acp": "agent",
        },
      },
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [{ id: "codex-acp", binary: "codex-acp" }],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession(params) {
          starts.push(params);
          return { session_id: "local-session-1" };
        },
        updateRunPreferences,
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const runtimes = await app.request("/api/v1/runtimes");
    expect(await runtimes.json()).toEqual({
      runtimes: [
        {
          id: "desktop-local",
          machine_id: "desktop-local",
          hostname: "This Mac",
          os: "darwin/arm64",
          agents: [{ id: "codex-acp", binary: "codex-acp" }],
          version: "desktop",
          status: "online",
          last_heartbeat: 1_700_000_000,
          created_at: 1_700_000_000,
        },
      ],
    });

    const utf8Runtime = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [{ id: "qwen-code", label: "通义千问", binary: "clash-acp-qwen-code" }],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession() {
          return { session_id: "local-session-1" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });
    const utf8Runtimes = await utf8Runtime.request("/api/v1/runtimes");
    const utf8Body = await utf8Runtimes.text();
    expect(utf8Runtimes.headers.get("content-length")).toBeNull();
    expect(Buffer.byteLength(utf8Body)).toBe(utf8Body.length);
    expect(utf8Body).toContain("\\u901a\\u4e49\\u5343\\u95ee");
    expect(utf8Body).not.toContain("通义千问");
    expect(JSON.parse(utf8Body).runtimes[0].agents[0].label).toBe("通义千问");

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        config_values: {
          model: "gpt-5.6-sol",
          effort: "high",
        },
        permission_mode: "agent",
        project_id: "project-1",
        resume_session_id: "acp-existing",
      }),
    });
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      session_id: "local-session-1",
      mutation: {
        operation: "runtime_session_create",
        entity: { kind: "session", id: "local-session-1" },
        resultEntityId: "local-session-1",
        accepted: true,
      },
    });
    await expectSingleMutationAudit(app, {
      operation: "runtime_session_create",
      entityId: "local-session-1",
      entityKind: "session",
      reason: "runtime session create",
    });
    expect(starts).toMatchObject([
      {
        runtimeId: "desktop-local",
        agentTemplateId: "master-clash",
        agentId: "codex-acp",
        projectId: "project-1",
        resumeAcpSessionId: "acp-existing",
      },
    ]);
    expect(starts[0]).toEqual(expect.objectContaining({
      configValues: {
        model: "gpt-5.6-sol",
        effort: "high",
      },
      onReady: expect.any(Function),
      onError: expect.any(Function),
    }));
    expect(updateRunPreferences).toHaveBeenCalledWith({
      agent_id: "codex-acp",
      config_values: {
        model: "gpt-5.6-sol",
        effort: "high",
      },
      mode_id: "agent",
    });

    const listedProjectSessions = await app.request("/api/v1/sessions?projectId=project-1");
    expect(await listedProjectSessions.json()).toMatchObject({
      sessions: [
        {
          id: "local-session-1",
          threadId: "local-session-1",
          type: "runtime",
          projectId: "project-1",
          title: "New session",
          runtimeId: "desktop-local",
          agentId: "codex-acp",
          status: "starting",
        },
      ],
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const persistedProjectSessions = await reopened.request("/api/v1/sessions?projectId=project-1");
    expect(await persistedProjectSessions.json()).toMatchObject({
      sessions: [
        {
          id: "local-session-1",
          threadId: "local-session-1",
          type: "runtime",
          projectId: "project-1",
          title: "New session",
          runtimeId: "desktop-local",
          agentId: "codex-acp",
          status: "starting",
        },
      ],
    });

    const sessions = await app.request("/api/v1/runtimes/desktop-local/local-sessions/scan");
    expect(await sessions.json()).toEqual({ sessions: [] });
  });

  it("passes explicit runtime probe granularity through to the local ACP adapter", async () => {
    const listRuntimes = vi.fn(async () => ({ runtimes: [] }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        listRuntimes,
        async createSession() {
          return { session_id: "local-session-1" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const res = await app.request("/api/v1/runtimes?probe=config&refresh=1");
    expect(res.status).toBe(200);
    expect(listRuntimes).toHaveBeenCalledWith({ probe: "config", refresh: true });
  });

  it("persists each cold-created runtime session instead of replacing project history", async () => {
    let next = 1;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [{ id: "codex-acp", binary: "codex-acp" }],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession() {
          return { session_id: `local-session-${next++}` };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    for (let i = 0; i < 2; i += 1) {
      const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_template_id: "master-clash",
          agent_id: "codex-acp",
          project_id: "project-history",
        }),
      });
      expect(created.status).toBe(200);
    }

    const listedProjectSessions = await app.request("/api/v1/sessions?projectId=project-history");
    expect(await listedProjectSessions.json()).toMatchObject({
      sessions: [
        { id: "local-session-2", type: "runtime", agentId: "codex-acp" },
        { id: "local-session-1", type: "runtime", agentId: "codex-acp" },
      ],
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const persistedProjectSessions = await reopened.request("/api/v1/sessions?projectId=project-history");
    expect(await persistedProjectSessions.json()).toMatchObject({
      sessions: [
        { id: "local-session-2", type: "runtime", agentId: "codex-acp" },
        { id: "local-session-1", type: "runtime", agentId: "codex-acp" },
      ],
    });
  });

  it("records rejected mutation envelopes for invalid runtime session requests", async () => {
    const unavailable = createLocalApiApp({ dataDir, userId: "local-user" });
    const noRuntime = await unavailable.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "codex-acp" }),
    });
    expect(noRuntime.status).toBe(404);
    expect(await noRuntime.json()).toEqual({
      error: "Local agent runtime unavailable",
      mutation: {
        operation: "runtime_session_create",
        entity: { kind: "session", id: "" },
        accepted: false,
        error: "Local agent runtime unavailable",
      },
    });

    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "unused" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });
    const missingAgent = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingAgent.status).toBe(400);
    expect(await missingAgent.json()).toEqual({
      error: "Missing agent_id",
      mutation: {
        operation: "runtime_session_create",
        entity: { kind: "session", id: "" },
        accepted: false,
        error: "Missing agent_id",
      },
    });
  });

  it("deletes local runtime sessions from persisted project history", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession(params: any) {
          return { session_id: params.sessionId };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-delete",
      }),
    });
    expect(created.status).toBe(200);
    const { session_id } = await created.json() as { session_id: string };

    const deleted = await app.request(`/api/v1/sessions?threadId=${encodeURIComponent(session_id)}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({
      ok: true,
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: session_id },
        resultEntityId: session_id,
        accepted: true,
      },
    });

    const listedProjectSessions = await app.request("/api/v1/sessions?projectId=project-delete");
    expect(await listedProjectSessions.json()).toEqual({ sessions: [] });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const persistedProjectSessions = await reopened.request("/api/v1/sessions?projectId=project-delete");
    expect(await persistedProjectSessions.json()).toEqual({ sessions: [] });
  });

  it("persists the Clash runtime session before starting ACP and keeps startup errors in history", async () => {
    let sawPrecreatedSession = false;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession(params: any) {
          const sessions = await app.request("/api/v1/sessions?projectId=project-start-fail");
          const sessionJson = await sessions.json() as {
            sessions?: Array<{ id: string; projectId: string; status?: string }>;
          };
          sawPrecreatedSession = Boolean(
            params.sessionId &&
            sessionJson.sessions?.some((session) =>
              session.id === params.sessionId &&
              session.projectId === "project-start-fail" &&
              session.status === "starting"
            ),
          );
          throw new Error("agent child failed to start");
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-start-fail",
      }),
    });
    expect(created.status).toBe(503);
    expect(sawPrecreatedSession).toBe(true);
    const createdJson = await created.json() as { error: string; session_id: string; mutation?: unknown };
    expect(createdJson.error).toBe("agent child failed to start");
    expect(createdJson.session_id).toEqual(expect.any(String));
    expect(createdJson.mutation).toEqual({
      operation: "runtime_session_create",
      entity: { kind: "session", id: createdJson.session_id },
      resultEntityId: createdJson.session_id,
      accepted: true,
    });

    const listed = await app.request("/api/v1/sessions?projectId=project-start-fail");
    const listedJson = await listed.json() as { sessions: Array<{ id: string; status?: string; type?: string }> };
    expect(listedJson.sessions).toHaveLength(1);
    expect(listedJson.sessions[0]).toMatchObject({
      type: "runtime",
      status: "error",
    });

    const messages = await app.request(`/api/v1/local-sessions/${listedJson.sessions[0]!.id}/messages`);
    expect(messages.status).toBe(200);
    expect(await messages.json()).toMatchObject({
      messages: [
        {
          sender_kind: "agent",
          events: [{ type: "promptError", error: "agent child failed to start" }],
        },
      ],
    });
  });

  it("writes ACP session id back when a runtime session becomes ready", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [{ id: "codex-acp", binary: "codex-acp" }],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession(params) {
          queueMicrotask(() => {
            void params.onReady?.({
              sessionId: "local-session-ready",
              acpSessionId: "acp-session-ready",
            });
          });
          return { session_id: "local-session-ready" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_template_id: "master-clash",
        agent_id: "codex-acp",
        project_id: "project-ready",
      }),
    });
    expect(created.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const listedProjectSessions = await app.request("/api/v1/sessions?projectId=project-ready");
    expect(await listedProjectSessions.json()).toMatchObject({
      sessions: [
        {
          id: "local-session-ready",
          acpSessionId: "acp-session-ready",
          status: "active",
        },
      ],
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const persistedProjectSessions = await reopened.request("/api/v1/sessions?projectId=project-ready");
    expect(await persistedProjectSessions.json()).toMatchObject({
      sessions: [
        {
          id: "local-session-ready",
          acpSessionId: "acp-session-ready",
          status: "active",
        },
      ],
    });
  });

  it("passes an explicit local ACP agent override when starting a runtime session", async () => {
    const starts: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [
                  { id: "claude-acp", binary: "claude-agent-acp" },
                  { id: "gemini", binary: "gemini" },
                ],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession(params) {
          starts.push(params);
          return { session_id: "local-session-agent" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_template_id: "master-clash",
        agent_id: "gemini",
        permission_mode: "gemini:full-access",
        project_id: "project-agent",
      }),
    });

    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      session_id: "local-session-agent",
      mutation: {
        operation: "runtime_session_create",
        entity: { kind: "session", id: "local-session-agent" },
        resultEntityId: "local-session-agent",
        accepted: true,
      },
    });
    expect(starts).toMatchObject([
      {
        runtimeId: "desktop-local",
        agentTemplateId: "master-clash",
        agentId: "gemini",
        permissionMode: "gemini:full-access",
        projectId: "project-agent",
      },
    ]);
    expect(starts[0]).toEqual(expect.objectContaining({
      onReady: expect.any(Function),
      onError: expect.any(Function),
    }));
  });

  it("exposes and updates local harness enablement", async () => {
    let savedHarnessIds: string[] = [];
    const listHarnesses = vi.fn(async () => ({
      harnesses: [
        {
          id: "codex-acp",
          label: "Codex",
          binary: "codex-acp",
          enabled: true,
          available: true,
        },
        {
          id: "claude-acp",
          label: "Claude",
          binary: "claude-agent-acp",
          enabled: false,
          available: true,
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        listHarnesses,
        async updateHarnesses(enabledIds) {
          savedHarnessIds = enabledIds;
          return {
            harnesses: [
              {
                id: "codex-acp",
                label: "Codex",
                binary: "codex-acp",
                enabled: enabledIds.includes("codex-acp"),
                available: true,
              },
              {
                id: "claude-acp",
                label: "Claude",
                binary: "claude-agent-acp",
                enabled: enabledIds.includes("claude-acp"),
                available: true,
              },
            ],
          };
        },
      },
    });

    const listed = await app.request("/api/v1/local/harnesses?probe=auth&refresh=1");
    expect(listed.status).toBe(200);
    expect(listHarnesses).toHaveBeenCalledWith({ probe: "auth", refresh: true });
    expect(await listed.json()).toMatchObject({
      harnesses: [
        { id: "codex-acp", enabled: true },
        { id: "claude-acp", enabled: false },
      ],
    });

    const updated = await app.request("/api/v1/local/harnesses", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
    });
    expect(updated.status).toBe(200);
    expect(savedHarnessIds).toEqual(["claude-acp"]);
    expect(await updated.json()).toMatchObject({
      harnesses: [
        { id: "codex-acp", enabled: false },
        { id: "claude-acp", enabled: true },
      ],
      mutation: {
        operation: "local_harness_enablement_update",
        entity: { kind: "local-harness-config", id: "enabled" },
        accepted: true,
        resultEntityId: "enabled",
      },
    });
  });

  it("requires receipt-bearing local harness reads before agent enablement changes", async () => {
    let savedHarnessIds = ["codex-acp"];
    const harnessRows = (enabledIds: string[]) => [
      {
        id: "codex-acp",
        label: "Codex",
        binary: "codex-acp",
        enabled: enabledIds.includes("codex-acp"),
        available: true,
      },
      {
        id: "claude-acp",
        label: "Claude",
        binary: "claude-agent-acp",
        enabled: enabledIds.includes("claude-acp"),
        available: true,
      },
    ];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async listHarnesses() {
          return { harnesses: harnessRows(savedHarnessIds) };
        },
        async updateHarnesses(enabledIds) {
          savedHarnessIds = enabledIds;
          return { harnesses: harnessRows(savedHarnessIds) };
        },
      },
    });

    const initial = await app.request("/api/v1/local/harnesses");
    const initialJson = await initial.json() as { harnesses: Array<{ id: string; enabled: boolean }>; readToken?: string };
    expect(initialJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const missing = await app.request("/api/v1/local/harnesses", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      mutation: {
        operation: "local_harness_enablement_update",
        entity: { kind: "local-harness-config", id: "enabled" },
        accepted: false,
      },
    });

    const bare = await app.request("/api/v1/local/harnesses", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(initialJson.readToken!),
      },
      body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
    });
    expect(bare.status).toBe(409);
    const bareJson = await bare.json() as { error?: string };
    expect(bareJson.error).toContain("Missing local harness enablement update read receipt");

    const humanUpdate = await app.request("/api/v1/local/harnesses", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled_harness_ids: ["codex-acp", "claude-acp"] }),
    });
    expect(humanUpdate.status).toBe(200);

    const stale = await app.request("/api/v1/local/harnesses", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
      body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
    });
    expect(stale.status).toBe(409);
    const staleJson = await stale.json() as { mutation?: any };
    expect(staleJson.mutation.expectedReadToken).toBe(initialJson.readToken);
    expect(staleJson.mutation.beforeReadToken).not.toBe(baseReadToken(initialJson.readToken!));

    const refreshed = await app.request("/api/v1/local/harnesses");
    const refreshedJson = await refreshed.json() as { harnesses: Array<{ id: string; enabled: boolean }>; readToken?: string };
    expect(refreshedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);
    const accepted = await app.request("/api/v1/local/harnesses", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": refreshedJson.readToken!,
      },
      body: JSON.stringify({ enabled_harness_ids: ["claude-acp"] }),
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as { readToken?: string; mutation?: any; harnesses: Array<{ id: string; enabled: boolean }> };
    expect(acceptedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);
    expect(acceptedJson.mutation).toMatchObject({
      operation: "local_harness_enablement_update",
      entity: { kind: "local-harness-config", id: "enabled" },
      expectedReadToken: refreshedJson.readToken,
      beforeReadToken: baseReadToken(refreshedJson.readToken!),
      afterReadToken: acceptedJson.readToken,
      accepted: true,
    });
    expect(acceptedJson.harnesses.find((row) => row.id === "claude-acp")?.enabled).toBe(true);
    expect(acceptedJson.harnesses.find((row) => row.id === "codex-acp")?.enabled).toBe(false);
    const audit = await app.request("/api/v1/mutation-audit?operation=local_harness_enablement_update&entityId=enabled");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(2);
    const humanAuditRecord = auditJson.records.find((record) => record.actorClientType == null);
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(humanAuditRecord).toMatchObject({
      operation: "local_harness_enablement_update",
      entity: { kind: "local-harness-config", id: "enabled" },
      actorClientType: null,
      accepted: true,
      reason: "local harness enablement update",
      resultEntityId: "enabled",
    });
    expect(agentAuditRecord).toMatchObject({
      operation: "local_harness_enablement_update",
      entity: { kind: "local-harness-config", id: "enabled" },
      actorClientType: "agent",
      accepted: true,
      reason: "local harness enablement update",
      resultEntityId: "enabled",
    });
    for (const record of auditJson.records) {
      expect(JSON.stringify(record.mutation ?? {})).not.toContain("receipt");
      expect(record.mutation.expectedReadToken).toBeUndefined();
      expect(record.mutation.beforeReadToken).toBeUndefined();
      expect(record.mutation.afterReadToken).toBeUndefined();
    }
  });

  it("requires receipt-bearing local harness reads before agent runtime actions", async () => {
    let installed = false;
    const harnessRows = () => [
      {
        id: "gemini",
        label: "Gemini",
        binary: "gemini",
        enabled: installed,
        available: installed,
        installed,
        installable: true,
        installSource: "registry" as const,
        installedVersion: installed ? "1.1.0" : undefined,
        latestVersion: "1.1.0",
      },
    ];
    const installHarness = vi.fn(async (id: string) => {
      installed = true;
      return { harnesses: harnessRows().map((harness) => ({ ...harness, id })) };
    });
    const uninstallHarness = vi.fn(async (id: string) => {
      installed = false;
      return { harnesses: harnessRows().map((harness) => ({ ...harness, id })) };
    });
    const upgradeHarness = vi.fn(async (id: string) => ({
      harnesses: harnessRows().map((harness) => ({ ...harness, id, installedVersion: "1.2.0", latestVersion: "1.2.0" })),
    }));
    const authenticateHarness = vi.fn(async (id: string) => ({
      harnesses: harnessRows().map((harness) => ({
        ...harness,
        id,
        auth: { status: "configured" as const, message: "configured" },
      })),
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async listHarnesses() {
          return { harnesses: harnessRows() };
        },
        async installHarness(id) {
          return installHarness(id);
        },
        async uninstallHarness(id) {
          return uninstallHarness(id);
        },
        async upgradeHarness(id) {
          return upgradeHarness(id);
        },
        async authenticateHarness(id) {
          return authenticateHarness(id);
        },
      },
    });

    const actionRequests = [
      {
        path: "/api/v1/local/harnesses/gemini/install",
        method: "POST",
        operation: "local_harness_install",
        spy: installHarness,
      },
      {
        path: "/api/v1/local/harnesses/gemini/install",
        method: "DELETE",
        operation: "local_harness_uninstall",
        spy: uninstallHarness,
      },
      {
        path: "/api/v1/local/harnesses/gemini/upgrade",
        method: "POST",
        operation: "local_harness_upgrade",
        spy: upgradeHarness,
      },
      {
        path: "/api/v1/local/harnesses/gemini/authenticate",
        method: "POST",
        operation: "local_harness_authenticate",
        spy: authenticateHarness,
        body: { method_id: "api-key" },
      },
    ];

    for (const action of actionRequests) {
      const response = await app.request(action.path, {
        method: action.method,
        headers: {
          "content-type": "application/json",
          "x-clash-client-type": "agent",
        },
        ...(action.body ? { body: JSON.stringify(action.body) } : {}),
      });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        mutation: {
          operation: action.operation,
          entity: { kind: "local-harness", id: "gemini" },
          accepted: false,
        },
      });
      expect(action.spy).not.toHaveBeenCalled();
    }

    const initial = await app.request("/api/v1/local/harnesses");
    const initialJson = await initial.json() as { readToken?: string };
    expect(initialJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const bare = await app.request("/api/v1/local/harnesses/gemini/install", {
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(initialJson.readToken!),
      },
    });
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({
      mutation: {
        operation: "local_harness_install",
        accepted: false,
      },
    });
    expect(installHarness).not.toHaveBeenCalled();

    const accepted = await app.request("/api/v1/local/harnesses/gemini/install", {
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as { readToken?: string; mutation?: any };
    expect(acceptedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);
    expect(acceptedJson.readToken).not.toBe(initialJson.readToken);
    expect(acceptedJson.mutation).toMatchObject({
      operation: "local_harness_install",
      entity: { kind: "local-harness", id: "gemini" },
      expectedReadToken: initialJson.readToken,
      beforeReadToken: baseReadToken(initialJson.readToken!),
      afterReadToken: acceptedJson.readToken,
      accepted: true,
      resultEntityId: "gemini",
    });
    expect(installHarness).toHaveBeenCalledTimes(1);
    const audit = await app.request("/api/v1/mutation-audit?operation=local_harness_install&entityId=gemini");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "local_harness_install",
      entity: { kind: "local-harness", id: "gemini" },
      actorClientType: "agent",
      accepted: true,
      reason: "local harness install",
      resultEntityId: "gemini",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();

    const staleUninstall = await app.request("/api/v1/local/harnesses/gemini/install", {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
    });
    expect(staleUninstall.status).toBe(409);
    expect(await staleUninstall.json()).toMatchObject({
      mutation: {
        operation: "local_harness_uninstall",
        entity: { kind: "local-harness", id: "gemini" },
        expectedReadToken: initialJson.readToken,
        accepted: false,
      },
    });
    expect(uninstallHarness).not.toHaveBeenCalled();

    const humanUpgrade = await app.request("/api/v1/local/harnesses/gemini/upgrade", {
      method: "POST",
    });
    expect(humanUpgrade.status).toBe(200);
    expect(upgradeHarness).toHaveBeenCalledTimes(1);
  });

  it("returns a structured error when harness enablement is blocked", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async updateHarnesses() {
          throw new Error("Authenticate Devin before enabling.");
        },
      },
    });

    const updated = await app.request("/api/v1/local/harnesses", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled_harness_ids: ["devin"] }),
    });

    expect(updated.status).toBe(400);
    expect(await updated.json()).toEqual({
      error: "Authenticate Devin before enabling.",
      mutation: {
        operation: "local_harness_enablement_update",
        entity: { kind: "local-harness-config", id: "enabled" },
        accepted: false,
        error: "Authenticate Devin before enabling.",
      },
    });
  });

  it("exposes and updates Zed-style custom agent server settings", async () => {
    const updateAgentServers = vi.fn(async (servers: LocalAcpAgentServersConfig) => ({
      agent_servers: servers,
      harnesses: [
        {
          id: "custom-openclaw-acp",
          label: "OpenClaw ACP",
          binary: "openclaw",
          enabled: true,
          available: false,
          custom: true,
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async listAgentServers() {
          return {
            agent_servers: {
              "OpenClaw ACP": {
                type: "custom",
                command: "openclaw",
                args: ["acp"],
                env: {},
              },
            },
          };
        },
        updateAgentServers,
      },
    });

    const listed = await app.request("/api/v1/local/agent-servers");
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      agent_servers: {
        "OpenClaw ACP": {
          type: "custom",
          command: "openclaw",
          args: ["acp"],
          env: {},
        },
      },
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
    });

    const body = {
      agent_servers: {
        "OpenClaw ACP": {
          type: "custom",
          command: "openclaw",
          args: ["acp", "--session", "agent:design:main"],
          env: {},
        },
      },
    };
    const updated = await app.request("/api/v1/local/agent-servers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    expect(updated.status).toBe(200);
    expect(updateAgentServers).toHaveBeenCalledWith(body.agent_servers);
    expect(await updated.json()).toMatchObject({
      agent_servers: body.agent_servers,
      harnesses: [{ id: "custom-openclaw-acp", custom: true }],
      mutation: {
        operation: "local_agent_servers_update",
        entity: { kind: "local-harness-config", id: "agent-servers" },
        accepted: true,
        resultEntityId: "agent-servers",
      },
    });
  });

  it("requires receipt-bearing agent-server reads before agent server config changes", async () => {
    let savedServers: LocalAcpAgentServersConfig = {
      "OpenClaw ACP": {
        type: "custom",
        command: "openclaw",
        args: ["acp"],
        env: {},
      },
    };
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async listAgentServers() {
          return { agent_servers: savedServers };
        },
        async updateAgentServers(servers: LocalAcpAgentServersConfig) {
          savedServers = servers;
          return {
            agent_servers: savedServers,
            harnesses: [{
              id: "custom-openclaw-acp",
              label: "OpenClaw ACP",
              binary: "openclaw",
              enabled: true,
              available: false,
              custom: true,
            }],
          };
        },
      },
    });

    const initial = await app.request("/api/v1/local/agent-servers");
    const initialJson = await initial.json() as { agent_servers: LocalAcpAgentServersConfig; readToken?: string };
    expect(initialJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);

    const nextServers = {
      "OpenClaw ACP": {
        type: "custom",
        command: "openclaw",
        args: ["acp", "--session", "agent:design:main"],
        env: {},
      },
    };
    const missing = await app.request("/api/v1/local/agent-servers", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({ agent_servers: nextServers }),
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      mutation: {
        operation: "local_agent_servers_update",
        entity: { kind: "local-harness-config", id: "agent-servers" },
        accepted: false,
      },
    });

    const bare = await app.request("/api/v1/local/agent-servers", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(initialJson.readToken!),
      },
      body: JSON.stringify({ agent_servers: nextServers }),
    });
    expect(bare.status).toBe(409);
    const bareJson = await bare.json() as { error?: string };
    expect(bareJson.error).toContain("Missing local agent servers update read receipt");

    const humanServers = {
      "OpenClaw ACP": {
        type: "custom",
        command: "openclaw",
        args: ["acp", "--human"],
        env: {},
      },
    };
    const humanUpdate = await app.request("/api/v1/local/agent-servers", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_servers: humanServers }),
    });
    expect(humanUpdate.status).toBe(200);

    const stale = await app.request("/api/v1/local/agent-servers", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": initialJson.readToken!,
      },
      body: JSON.stringify({ agent_servers: nextServers }),
    });
    expect(stale.status).toBe(409);
    const staleJson = await stale.json() as { mutation?: any };
    expect(staleJson.mutation.expectedReadToken).toBe(initialJson.readToken);
    expect(staleJson.mutation.beforeReadToken).not.toBe(baseReadToken(initialJson.readToken!));

    const refreshed = await app.request("/api/v1/local/agent-servers");
    const refreshedJson = await refreshed.json() as { readToken?: string };
    expect(refreshedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);
    const accepted = await app.request("/api/v1/local/agent-servers", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": refreshedJson.readToken!,
      },
      body: JSON.stringify({ agent_servers: nextServers }),
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as { agent_servers: LocalAcpAgentServersConfig; readToken?: string; mutation?: any };
    expect(acceptedJson.readToken).toMatch(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE);
    expect(acceptedJson.agent_servers).toEqual(nextServers);
    expect(acceptedJson.mutation).toMatchObject({
      operation: "local_agent_servers_update",
      entity: { kind: "local-harness-config", id: "agent-servers" },
      expectedReadToken: refreshedJson.readToken,
      beforeReadToken: baseReadToken(refreshedJson.readToken!),
      afterReadToken: acceptedJson.readToken,
      accepted: true,
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=local_agent_servers_update&entityId=agent-servers");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(2);
    const humanAuditRecord = auditJson.records.find((record) => record.actorClientType == null);
    const agentAuditRecord = auditJson.records.find((record) => record.actorClientType === "agent");
    expect(humanAuditRecord).toMatchObject({
      operation: "local_agent_servers_update",
      entity: { kind: "local-harness-config", id: "agent-servers" },
      actorClientType: null,
      accepted: true,
      reason: "local agent servers update",
      resultEntityId: "agent-servers",
    });
    expect(agentAuditRecord).toMatchObject({
      operation: "local_agent_servers_update",
      entity: { kind: "local-harness-config", id: "agent-servers" },
      actorClientType: "agent",
      accepted: true,
      reason: "local agent servers update",
      resultEntityId: "agent-servers",
    });
    for (const record of auditJson.records) {
      expect(JSON.stringify(record.mutation ?? {})).not.toContain("receipt");
      expect(record.mutation.expectedReadToken).toBeUndefined();
      expect(record.mutation.beforeReadToken).toBeUndefined();
      expect(record.mutation.afterReadToken).toBeUndefined();
    }
  });

  it("installs local registry agents through the local ACP adapter", async () => {
    const installHarness = vi.fn(async (id: string) => ({
      harnesses: [
        {
          id,
          label: "Gemini",
          binary: "clash-acp-gemini",
          enabled: false,
          available: true,
          installable: true,
          installSource: "registry" as const,
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async installHarness(id) {
          return installHarness(id);
        },
      },
    });

    const response = await app.request("/api/v1/local/harnesses/gemini/install", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(installHarness).toHaveBeenCalledWith("gemini");
    expect(await response.json()).toMatchObject({
      harnesses: [{ id: "gemini", available: true, installSource: "registry" }],
      mutation: {
        operation: "local_harness_install",
        entity: { kind: "local-harness", id: "gemini" },
        accepted: true,
        resultEntityId: "gemini",
      },
    });
  });

  it("installs local registry agents through the explicit adapter route", async () => {
    const installHarnessAdapter = vi.fn(async (id: string) => ({
      harnesses: [
        {
          id,
          label: "Gemini",
          binary: "clash-acp-gemini",
          enabled: false,
          available: true,
          installable: true,
          installSource: "registry" as const,
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async installHarnessAdapter(id) {
          return installHarnessAdapter(id);
        },
      },
    });

    const response = await app.request("/api/v1/local/harnesses/gemini/install-adapter", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(installHarnessAdapter).toHaveBeenCalledWith("gemini");
    expect(await response.json()).toMatchObject({
      harnesses: [{ id: "gemini", available: true, installSource: "registry" }],
      mutation: {
        operation: "local_harness_install",
        entity: { kind: "local-harness", id: "gemini" },
        accepted: true,
        resultEntityId: "gemini",
      },
    });
    await expectSingleMutationAudit(app, {
      operation: "local_harness_install",
      entityId: "gemini",
      entityKind: "local-harness",
      reason: "local harness install",
    });
  });

  it("uninstalls local registry agents through the local ACP adapter", async () => {
    const uninstallHarness = vi.fn(async (id: string) => ({
      harnesses: [
        {
          id,
          label: "Gemini",
          binary: "clash-acp-gemini",
          enabled: false,
          available: false,
          installable: true,
          installSource: "registry" as const,
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async uninstallHarness(id) {
          return uninstallHarness(id);
        },
      },
    });

    const response = await app.request("/api/v1/local/harnesses/gemini/install", {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(uninstallHarness).toHaveBeenCalledWith("gemini");
    expect(await response.json()).toMatchObject({
      harnesses: [{ id: "gemini", available: false, installSource: "registry" }],
      mutation: {
        operation: "local_harness_uninstall",
        entity: { kind: "local-harness", id: "gemini" },
        accepted: true,
        resultEntityId: "gemini",
      },
    });
    await expectSingleMutationAudit(app, {
      operation: "local_harness_uninstall",
      entityId: "gemini",
      entityKind: "local-harness",
      reason: "local harness uninstall",
    });
  });

  it("upgrades local registry agents through the local ACP adapter", async () => {
    const upgradeHarness = vi.fn(async (id: string) => ({
      harnesses: [
        {
          id,
          label: "Gemini",
          binary: "clash-acp-gemini",
          enabled: true,
          available: true,
          installed: true,
          installable: true,
          installSource: "registry" as const,
          installedVersion: "1.1.0",
          latestVersion: "1.1.0",
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async upgradeHarness(id) {
          return upgradeHarness(id);
        },
      },
    });

    const response = await app.request("/api/v1/local/harnesses/gemini/upgrade", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(upgradeHarness).toHaveBeenCalledWith("gemini");
    expect(await response.json()).toMatchObject({
      harnesses: [{ id: "gemini", installedVersion: "1.1.0", latestVersion: "1.1.0" }],
      mutation: {
        operation: "local_harness_upgrade",
        entity: { kind: "local-harness", id: "gemini" },
        accepted: true,
        resultEntityId: "gemini",
      },
    });
    await expectSingleMutationAudit(app, {
      operation: "local_harness_upgrade",
      entityId: "gemini",
      entityKind: "local-harness",
      reason: "local harness upgrade",
    });
  });

  it("authenticates harnesses through the local ACP adapter", async () => {
    const authenticateHarness = vi.fn(async (id: string, _options?: { methodId?: string }) => ({
      harnesses: [
        {
          id,
          label: "Gemini",
          binary: "gemini",
          enabled: true,
          available: true,
          auth: {
            status: "configured" as const,
            message: "Gemini authentication is configured for ACP.",
          },
        },
      ],
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async authenticateHarness(id, options) {
          return authenticateHarness(id, options);
        },
      },
    });

    const response = await app.request("/api/v1/local/harnesses/gemini/authenticate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method_id: "api-key" }),
    });

    expect(response.status).toBe(200);
    expect(authenticateHarness).toHaveBeenCalledWith("gemini", { methodId: "api-key" });
    expect(await response.json()).toMatchObject({
      harnesses: [{ id: "gemini", auth: { status: "configured" } }],
      mutation: {
        operation: "local_harness_authenticate",
        entity: { kind: "local-harness", id: "gemini" },
        accepted: true,
        resultEntityId: "gemini",
      },
    });
    await expectSingleMutationAudit(app, {
      operation: "local_harness_authenticate",
      entityId: "gemini",
      entityKind: "local-harness",
      reason: "local harness authenticate",
    });
  });

  it("resolves local agent_member_id when starting a desktop ACP session", async () => {
    const starts: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [{ id: "codex-acp", binary: "codex-acp" }],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession(params) {
          starts.push(params);
          return { session_id: "local-session-agent" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const agents = await app.request("/api/v1/agents");
    const { agents: rows } = (await agents.json()) as {
      agents: Array<{ id: string; template_id: string; runtime_id: string }>;
    };
    const masterClash = rows.find((row) => row.template_id === "master-clash");
    expect(masterClash).toBeTruthy();

    const created = await app.request(`/api/v1/runtimes/${masterClash!.runtime_id}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_member_id: masterClash!.id,
        project_id: "project-agent",
      }),
    });

    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({
      session_id: "local-session-agent",
      mutation: {
        operation: "runtime_session_create",
        entity: { kind: "session", id: "local-session-agent" },
        resultEntityId: "local-session-agent",
        accepted: true,
      },
    });
    expect(starts).toMatchObject([
      {
        runtimeId: "desktop-local",
        agentTemplateId: "master-clash",
        agentMemberId: masterClash!.id,
        projectId: "project-agent",
      },
    ]);
    expect(starts[0]).toEqual(expect.objectContaining({
      onReady: expect.any(Function),
      onError: expect.any(Function),
    }));
  });

  it("returns a readable local ACP session creation error", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return {
            runtimes: [
              {
                id: "desktop-local",
                machine_id: "desktop-local",
                hostname: "This Mac",
                os: "darwin/arm64",
                agents: [],
                version: "desktop",
                status: "online",
                last_heartbeat: 1_700_000_000,
                created_at: 1_700_000_000,
              },
            ],
          };
        },
        async createSession() {
          throw new Error("No local ACP agent found on PATH");
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      },
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_template_id: "master-clash", project_id: "project-1" }),
    });

    expect(created.status).toBe(503);
    const body = await created.json() as { error: string; session_id: string; mutation?: unknown };
    expect(body.error).toBe("No local agent found. Install or enable an agent in Settings > Agents, then retry.");
    expect(body.session_id).toEqual(expect.any(String));
    expect(body.mutation).toEqual({
      operation: "runtime_session_create",
      entity: { kind: "session", id: body.session_id },
      resultEntityId: body.session_id,
      accepted: true,
    });
  });

  it("returns local ACP session history with the cloud-compatible message shape", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "unused" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async listSessionMessages(sessionId) {
          if (sessionId !== "local-session-history") return null;
          return {
            messages: [
              {
                id: "turn-1-user",
                sender_kind: "user",
                sender_id: "local-user",
                turn_id: "turn-1",
                events: [{ type: "text", text: "hello agent" }],
                created_at: 1_700_000_000,
              },
              {
                id: "turn-1-agent",
                sender_kind: "agent",
                sender_id: "local-master-clash",
                turn_id: "turn-1",
                events: [{ type: "text", text: "agent reply" }],
                created_at: 1_700_000_001,
              },
            ],
          };
        },
      },
    });

    const res = await app.request("/api/v1/local-sessions/local-session-history/messages");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messages: [
        {
          id: "turn-1-user",
          sender_kind: "user",
          sender_id: "local-user",
          turn_id: "turn-1",
          events: [{ type: "text", text: "hello agent" }],
          created_at: 1_700_000_000,
        },
        {
          id: "turn-1-agent",
          sender_kind: "agent",
          sender_id: "local-master-clash",
          turn_id: "turn-1",
          events: [{ type: "text", text: "agent reply" }],
          created_at: 1_700_000_001,
        },
      ],
    });

    const missing = await app.request("/api/v1/local-sessions/missing/messages");
    expect(missing.status).toBe(404);
  });

  it("exposes held ACP version status and restarts the selected local session", async () => {
    const restartSession = vi.fn(async () => ({
      session_id: "local-session-update",
      status: "pending" as const,
    }));
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "unused" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        async getSessionRuntimeStatus(sessionId: string) {
          return sessionId === "local-session-update"
            ? {
                session_id: sessionId,
                harness_id: "codex-acp",
                harness_label: "Codex",
                running_version: "1.0.1",
                installed_version: "1.0.2",
                restart_required: true,
                busy: true,
                restart_pending: false,
              }
            : null;
        },
        restartSession,
      } as any,
    });

    const status = await app.request("/api/v1/local-sessions/local-session-update/runtime-status");
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual(expect.objectContaining({
      harness_id: "codex-acp",
      installed_version: "1.0.2",
      restart_required: true,
      busy: true,
    }));

    const restart = await app.request("/api/v1/local-sessions/local-session-update/restart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "after-turn" }),
    });
    expect(restart.status).toBe(200);
    expect(await restart.json()).toEqual({
      session_id: "local-session-update",
      status: "pending",
    });
    expect(restartSession).toHaveBeenCalledWith("local-session-update", { mode: "after-turn" });
  });

  it("reattaches a persisted runtime ACP session without creating another history row", async () => {
    const attaches: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-existing" };
        },
        async attachSession(params: unknown) {
          attaches.push(params);
          return { session_id: "local-session-existing" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-reattach",
        permission_mode: "full-access",
      }),
    });
    expect(created.status).toBe(200);

    const attach = await app.request("/api/v1/local-sessions/local-session-existing/_attach", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(attach.status).toBe(200);
    expect(await attach.json()).toEqual({
      session_id: "local-session-existing",
      mutation: {
        operation: "runtime_session_attach",
        entity: { kind: "session", id: "local-session-existing" },
        resultEntityId: "local-session-existing",
        accepted: true,
      },
    });
    await expectSingleMutationAudit(app, {
      operation: "runtime_session_attach",
      entityId: "local-session-existing",
      entityKind: "session",
      reason: "runtime session attach",
    });
    expect(attaches).toMatchObject([
      {
        sessionId: "local-session-existing",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        projectId: "project-reattach",
        permissionMode: "full-access",
      },
    ]);

    const sessions = await app.request("/api/v1/sessions?projectId=project-reattach");
    expect((await sessions.json()).sessions).toHaveLength(1);
  });

  it("requires a receipt-bearing session read token before agent runtime session attach", async () => {
    const attaches: unknown[] = [];
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-attach-cas" };
        },
        async attachSession(params: unknown) {
          attaches.push(params);
          return { session_id: "local-session-attach-cas" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-attach-cas",
      }),
    });
    expect(created.status).toBe(200);

    const listed = await app.request("/api/v1/sessions?projectId=project-attach-cas");
    const listedJson = await listed.json() as { sessions: Array<{ id: string; readToken?: string }> };
    const session = listedJson.sessions.find((candidate) => candidate.id === "local-session-attach-cas");
    expect(session?.readToken).toMatch(SESSION_RECEIPT_READ_TOKEN_RE);

    const missing = await app.request("/api/v1/local-sessions/local-session-attach-cas/_attach", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({}),
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("Missing runtime session attach read proof"),
      mutation: {
        operation: "runtime_session_attach",
        entity: { kind: "session", id: "local-session-attach-cas" },
        accepted: false,
        error: expect.stringContaining("Missing runtime session attach read proof"),
      },
    });

    const bareReadToken = baseReadToken(session!.readToken!);
    const bare = await app.request("/api/v1/local-sessions/local-session-attach-cas/_attach", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": bareReadToken,
      },
      body: JSON.stringify({}),
    });
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({
      error: expect.stringContaining("Missing runtime session attach read receipt"),
      mutation: {
        operation: "runtime_session_attach",
        entity: { kind: "session", id: "local-session-attach-cas" },
        expectedReadToken: bareReadToken,
        beforeReadToken: bareReadToken,
        accepted: false,
        error: expect.stringContaining("Missing runtime session attach read receipt"),
      },
    });

    const sqlite = openSqlite();
    try {
      sqlite.prepare("UPDATE runtime_session SET updated_at = ? WHERE id = ?")
        .run("2026-07-07T03:31:00.000Z", "local-session-attach-cas");
    } finally {
      sqlite.close();
    }

    const stale = await app.request("/api/v1/local-sessions/local-session-attach-cas/_attach", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": session!.readToken!,
      },
      body: JSON.stringify({}),
    });
    expect(stale.status).toBe(409);
    const staleJson = await stale.json() as { error: string; mutation: { beforeReadToken?: string; expectedReadToken?: string } };
    expect(staleJson.error).toContain("Stale runtime session attach rejected");
    expect(staleJson.mutation.expectedReadToken).toBe(session!.readToken);
    expect(staleJson.mutation.beforeReadToken).toMatch(/^session-v1:[a-f0-9]{16}$/);
    expect(staleJson.mutation.beforeReadToken).not.toBe(baseReadToken(session!.readToken!));
    expect(attaches).toHaveLength(0);

    const refreshed = await app.request("/api/v1/sessions?projectId=project-attach-cas");
    const refreshedJson = await refreshed.json() as { sessions: Array<{ id: string; readToken?: string }> };
    const freshReadToken = refreshedJson.sessions.find((candidate) => candidate.id === "local-session-attach-cas")?.readToken;
    expect(freshReadToken).toMatch(SESSION_RECEIPT_READ_TOKEN_RE);

    const accepted = await app.request("/api/v1/local-sessions/local-session-attach-cas/_attach", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": freshReadToken!,
      },
      body: JSON.stringify({}),
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      session_id: "local-session-attach-cas",
      mutation: {
        operation: "runtime_session_attach",
        entity: { kind: "session", id: "local-session-attach-cas" },
        expectedReadToken: freshReadToken,
        beforeReadToken: baseReadToken(freshReadToken!),
        resultEntityId: "local-session-attach-cas",
        accepted: true,
        afterReadToken: expect.stringMatching(SESSION_RECEIPT_READ_TOKEN_RE),
      },
    });
    expect(attaches).toHaveLength(1);
  });

  it("records a mutation envelope when runtime ACP session attach fails", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession(params: any) {
          return { session_id: params.sessionId };
        },
        async attachSession() {
          throw new Error("ACP session init timed out after 10ms");
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-attach-fail",
      }),
    });
    expect(created.status).toBe(200);
    const { session_id: sessionId } = await created.json() as { session_id: string };

    const attach = await app.request(`/api/v1/local-sessions/${encodeURIComponent(sessionId)}/_attach`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(attach.status).toBe(503);
    expect(await attach.json()).toEqual({
      error: "ACP session init timed out after 10ms",
      session_id: sessionId,
      mutation: {
        operation: "runtime_session_attach",
        entity: { kind: "session", id: sessionId },
        resultEntityId: sessionId,
        accepted: true,
      },
    });
    await expectSingleMutationAudit(app, {
      operation: "runtime_session_attach",
      entityId: sessionId,
      entityKind: "session",
      reason: "runtime session attach",
    });

    const listed = await app.request("/api/v1/sessions?projectId=project-attach-fail");
    expect(await listed.json()).toMatchObject({
      sessions: [{ id: sessionId, status: "error" }],
    });
  });

  it("uses the visible user prompt for a session title instead of protocol comments", async () => {
    let messageStore: any = null;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-protocol-title" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        setSessionMessageStore(store: any) {
          messageStore = store;
        },
      } as any,
    });

    await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-protocol-title",
      }),
    });
    await messageStore.appendUserPrompt("local-session-protocol-title", {
      id: "turn-protocol-user",
      sender_kind: "user",
      sender_id: "local-user",
      turn_id: "turn-protocol",
      events: [{
        type: "text",
        text: '<!-- clash-workspace-context {"version":1,"projectId":"project-protocol-title"} -->\nRun pwd with your shell tool.',
      }],
      created_at: 1_700_000_000,
    });

    const listed = await app.request("/api/v1/sessions?projectId=project-protocol-title");
    expect(await listed.json()).toMatchObject({
      sessions: [{
        id: "local-session-protocol-title",
        title: "Run pwd with your sh...",
      }],
    });
  });

  it("persists runtime ACP transcript messages in the local DB for cold restore", async () => {
    let messageStore: any = null;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-persisted" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        setSessionMessageStore(store: any) {
          messageStore = store;
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_template_id: "master-clash",
        agent_id: "codex-acp",
        project_id: "project-transcript",
      }),
    });
    expect(created.status).toBe(200);
    expect(messageStore).toBeTruthy();

    await messageStore.appendUserPrompt("local-session-persisted", {
      id: "turn-1-user",
      sender_kind: "user",
      sender_id: "local-user",
      turn_id: "turn-1",
      events: [{ type: "text", text: "hello agent" }],
      created_at: 1_700_000_000,
    });
    await messageStore.appendAgentEvent("local-session-persisted", {
      id: "turn-1-agent",
      sender_kind: "agent",
      sender_id: "local-master-clash",
      turn_id: "turn-1",
      events: [{ type: "agent_message_chunk", content: { type: "text", text: "hello human" } }],
      created_at: 1_700_000_001,
    });
    await messageStore.appendAgentEvent("local-session-persisted", {
      id: "turn-1-agent",
      sender_kind: "agent",
      sender_id: "local-master-clash",
      turn_id: "turn-1",
      events: [{ sessionUpdate: "session_info_update", title: "Generated title" }],
      created_at: 1_700_000_001,
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const restored = await reopened.request("/api/v1/local-sessions/local-session-persisted/messages");
    const sessions = await reopened.request("/api/v1/sessions?projectId=project-transcript");

    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      messages: [
        {
          id: "turn-1-user",
          sender_kind: "user",
          sender_id: "local-user",
          turn_id: "turn-1",
          events: [{ type: "text", text: "hello agent" }],
          created_at: 1_700_000_000,
        },
        {
          id: "turn-1-agent",
          sender_kind: "agent",
          sender_id: "local-master-clash",
          turn_id: "turn-1",
          events: [
            { type: "agent_message_chunk", content: { type: "text", text: "hello human" } },
            { sessionUpdate: "session_info_update", title: "Generated title" },
          ],
          created_at: 1_700_000_001,
        },
      ],
    });
    expect(await sessions.json()).toMatchObject({
      sessions: [{ id: "local-session-persisted", title: "Generated title" }],
    });
  });

  it("deduplicates repeated persisted ACP events for the same runtime turn", async () => {
    let messageStore: any = null;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-dedupe" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        setSessionMessageStore(store: any) {
          messageStore = store;
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-dedupe",
      }),
    });
    expect(created.status).toBe(200);

    const event = {
      sessionUpdate: "tool_call_update",
      toolCallId: "tool-pwd",
      status: "completed",
      rawOutput: { stdout: "/Users/xiaoyang/project\n" },
    };
    await messageStore.appendAgentEvent("local-session-dedupe", {
      id: "turn-1-agent",
      sender_kind: "agent",
      sender_id: "local-agent",
      turn_id: "turn-1",
      events: [event],
      created_at: 1_700_000_001,
    });
    await messageStore.appendAgentEvent("local-session-dedupe", {
      id: "turn-1-agent",
      sender_kind: "agent",
      sender_id: "local-agent",
      turn_id: "turn-1",
      events: [event],
      created_at: 1_700_000_001,
    });

    const restored = await app.request("/api/v1/local-sessions/local-session-dedupe/messages");

    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      messages: [
        {
          id: "turn-1-agent",
          sender_kind: "agent",
          sender_id: "local-agent",
          turn_id: "turn-1",
          events: [event],
          created_at: 1_700_000_001,
        },
      ],
    });
  });

  it("preserves repeated ACP text chunks when a cumulative transcript snapshot is persisted", async () => {
    let messageStore: any = null;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-repeated-chunks" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        setSessionMessageStore(store: any) {
          messageStore = store;
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "codex-acp",
        project_id: "project-repeated-chunks",
      }),
    });
    expect(created.status).toBe(200);

    const chunk = (text: string) => ({
      sessionUpdate: "agent_message_chunk",
      messageId: "final-answer",
      content: { type: "text", text },
    });
    const message = {
      id: "turn-1-agent",
      sender_kind: "agent" as const,
      sender_id: "local-agent",
      turn_id: "turn-1",
      created_at: 1_700_000_001,
    };

    await messageStore.appendAgentEvent("local-session-repeated-chunks", {
      ...message,
      events: [chunk("/")],
    });
    await messageStore.appendAgentEvent("local-session-repeated-chunks", {
      ...message,
      events: [
        chunk("/"),
        chunk("Users"),
        chunk("/"),
        chunk("project"),
        chunk("-"),
        chunk("-"),
      ],
    });

    const restored = await app.request(
      "/api/v1/local-sessions/local-session-repeated-chunks/messages",
    );

    expect(restored.status).toBe(200);
    const restoredJson = await restored.json() as {
      messages: Array<{ events: Array<{ content?: { text?: string } }> }>;
    };
    expect(
      restoredJson.messages[0]?.events.map((event) => event.content?.text).join(""),
    ).toBe("/Users/project--");
  });

  it("keeps runtime session history when transcript events write concurrently", async () => {
    let messageStore: any = null;
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: {
        async listRuntimes() {
          return { runtimes: [] };
        },
        async createSession() {
          return { session_id: "local-session-race" };
        },
        async listResumeSessions() {
          return { sessions: [] };
        },
        setSessionMessageStore(store: any) {
          messageStore = store;
        },
      } as any,
    });

    const created = await app.request("/api/v1/runtimes/desktop-local/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_template_id: "master-clash",
        agent_id: "codex-acp",
        project_id: "project-race",
      }),
    });
    expect(created.status).toBe(200);
    expect(messageStore).toBeTruthy();

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        index % 2 === 0
          ? messageStore.appendUserPrompt("local-session-race", {
              id: `turn-${index}-user`,
              sender_kind: "user",
              sender_id: "local-user",
              turn_id: `turn-${index}`,
              events: [{ type: "text", text: `prompt ${index}` }],
              created_at: 1_700_000_000 + index,
            })
          : messageStore.appendAgentEvent("local-session-race", {
              id: `turn-${index}-agent`,
              sender_kind: "agent",
              sender_id: "local-master-clash",
              turn_id: `turn-${index}`,
              events: [{ type: "agent_message_chunk", content: { type: "text", text: `reply ${index}` } }],
              created_at: 1_700_000_000 + index,
            })
      ),
    );

    const sessions = await app.request("/api/v1/sessions?projectId=project-race");
    const restored = await app.request("/api/v1/local-sessions/local-session-race/messages");

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select count(*) as count from chat_message").get()).toEqual({ count: 24 });
    } finally {
      sqlite.close();
    }
    expect(await sessions.json()).toMatchObject({
      sessions: [{ id: "local-session-race", type: "runtime", projectId: "project-race" }],
    });
    expect((await restored.json()).messages).toHaveLength(24);
  });

  it("creates, lists, renames, and deletes local projects", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "A local-first video project",
        description: "A local-first video project",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { id: string; readToken?: string; mutation?: any };
    const { id } = createdJson;
    expect(createdJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(createdJson.mutation).toEqual({
      operation: "project_create",
      entity: { kind: "project", id },
      afterReadToken: createdJson.readToken,
      resultEntityId: id,
      accepted: true,
    });

    const listed = await app.request("/api/v1/projects");
    const listedJson = (await listed.json()) as { projects: Array<{
      id: string;
      ownerId: string;
      name: string;
      description: string;
      assets: unknown[];
      readToken?: string;
    }> };
    const projects = listedJson.projects;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id,
      ownerId: "local-user",
      name: "A local-first video project",
      description: "A local-first video project",
      assets: [],
    });
    expect(projects[0].readToken).toBe(createdJson.readToken);

    const renamed = await app.request(`/api/v1/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
      headers: { "content-type": "application/json" },
    });
    expect(renamed.status).toBe(200);
    const renamedJson = (await renamed.json()) as { readToken?: string; mutation?: any };
    expect(renamedJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(renamedJson.readToken).not.toBe(createdJson.readToken);
    expect(renamedJson.mutation).toMatchObject({
      operation: "project_update",
      entity: { kind: "project", id },
      beforeReadToken: baseReadToken(createdJson.readToken!),
      afterReadToken: renamedJson.readToken,
      resultEntityId: id,
      accepted: true,
    });

    const loaded = await app.request(`/api/v1/projects/${id}`);
    expect(await loaded.json()).toMatchObject({
      id,
      ownerId: "local-user",
      name: "Renamed",
      readToken: renamedJson.readToken,
    });

    const deleted = await app.request(`/api/v1/projects/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const deletedJson = (await deleted.json()) as { readToken?: string; mutation?: any };
    expect(deletedJson).toMatchObject({ deleted: true, recoverable: true, id });
    expect(deletedJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(deletedJson.mutation).toMatchObject({
      operation: "project_delete",
      entity: { kind: "project", id },
      beforeReadToken: baseReadToken(renamedJson.readToken!),
      afterReadToken: deletedJson.readToken,
      resultEntityId: id,
      accepted: true,
    });
    const audit = await app.request(`/api/v1/mutation-audit?operation=project_delete&entityId=${id}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "project_delete",
      entity: { kind: "project", id },
      accepted: true,
      actorClientType: null,
      reason: "project soft delete",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();
    expect(await (await app.request("/api/v1/projects")).json()).toEqual({ projects: [] });
  });

  it("writes sanitized mutation audit records for local project creation", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const v1Created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Agent Project" }),
      headers: { "content-type": "application/json", "x-clash-client-type": "agent" },
    });
    expect(v1Created.status).toBe(201);
    const v1Project = await v1Created.json() as { id: string; readToken: string };

    const v1Audit = await app.request(`/api/v1/mutation-audit?operation=project_create&entityId=${encodeURIComponent(v1Project.id)}`);
    expect(v1Audit.status).toBe(200);
    const v1AuditJson = await v1Audit.json() as { records: Array<any> };
    expect(v1AuditJson.records).toHaveLength(1);
    expect(v1AuditJson.records[0]).toMatchObject({
      operation: "project_create",
      entity: { kind: "project", id: v1Project.id },
      actorClientType: "agent",
      accepted: true,
      reason: "v1 project create",
      resultEntityId: v1Project.id,
    });
    expect(JSON.stringify(v1AuditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(v1AuditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(v1AuditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(v1AuditJson.records[0].mutation.afterReadToken).toBeUndefined();

  });

  it("does not expose obsolete local project endpoints", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "V1 Only Project" }),
      headers: { "content-type": "application/json" },
    });
    const project = await created.json() as { id: string };

    for (const [method, path, body] of [
      ["GET", "/api/projects", undefined],
      ["POST", "/api/projects", { prompt: "Old create" }],
      ["GET", `/api/projects/${project.id}`, undefined],
      ["PATCH", `/api/projects/${project.id}`, { name: "Old rename" }],
      ["DELETE", `/api/projects/${project.id}`, undefined],
    ] as const) {
      const response = await app.request(path, {
        method,
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(response.status).toBe(404);
    }
  });

  it("requires agent project writes to carry a fresh read proof", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Read Proof Project" }),
      headers: { "content-type": "application/json" },
    });
    const createdJson = await created.json() as { id: string; readToken: string };

    const missing = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "No proof" }),
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("Missing project update read proof for agent"),
      mutation: {
        operation: "project_update",
        entity: { kind: "project", id: createdJson.id },
        beforeReadToken: baseReadToken(createdJson.readToken),
        accepted: false,
        error: expect.stringContaining("Missing project update read proof for agent"),
      },
    });

    const unchanged = await app.request(`/api/v1/projects/${createdJson.id}`);
    expect(await unchanged.json()).toMatchObject({
      name: "Read Proof Project",
      readToken: createdJson.readToken,
    });

    const humanRename = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Concurrent human rename" }),
      headers: { "content-type": "application/json" },
    });
    const humanRenameJson = await humanRename.json() as { readToken: string };
    expect(humanRenameJson.readToken).not.toBe(createdJson.readToken);

    const stale = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Stale agent rename" }),
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": createdJson.readToken,
      },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: expect.stringContaining("Stale project update rejected"),
      mutation: {
        operation: "project_update",
        entity: { kind: "project", id: createdJson.id },
        expectedReadToken: createdJson.readToken,
        beforeReadToken: baseReadToken(humanRenameJson.readToken),
        accepted: false,
        error: expect.stringContaining("Stale project update rejected"),
      },
    });

    const fresh = await app.request(`/api/v1/projects/${createdJson.id}`);
    const freshJson = await fresh.json() as { readToken: string };
    const accepted = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Fresh agent rename" }),
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": freshJson.readToken,
      },
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as { readToken: string; mutation?: any };
    expect(acceptedJson.mutation).toMatchObject({
      operation: "project_update",
      entity: { kind: "project", id: createdJson.id },
      expectedReadToken: freshJson.readToken,
      beforeReadToken: baseReadToken(freshJson.readToken),
      afterReadToken: acceptedJson.readToken,
      accepted: true,
    });
    const updateAudit = await app.request(`/api/v1/mutation-audit?operation=project_update&entityId=${encodeURIComponent(createdJson.id)}`);
    expect(updateAudit.status).toBe(200);
    const updateAuditJson = await updateAudit.json() as { records: Array<any> };
    expect(updateAuditJson.records).toHaveLength(2);
    const agentUpdateAuditRecord = updateAuditJson.records.find((record) => record.actorClientType === "agent");
    const humanUpdateAuditRecord = updateAuditJson.records.find((record) => record.actorClientType == null);
    expect(humanUpdateAuditRecord).toMatchObject({
      operation: "project_update",
      entity: { kind: "project", id: createdJson.id },
      actorClientType: null,
      accepted: true,
      reason: "project update",
      resultEntityId: createdJson.id,
    });
    expect(agentUpdateAuditRecord).toMatchObject({
      operation: "project_update",
      entity: { kind: "project", id: createdJson.id },
      actorClientType: "agent",
      accepted: true,
      reason: "project update",
      resultEntityId: createdJson.id,
    });
    for (const record of updateAuditJson.records) {
      expect(JSON.stringify(record.mutation ?? {})).not.toContain("receipt");
      expect(record.mutation.expectedReadToken).toBeUndefined();
      expect(record.mutation.beforeReadToken).toBeUndefined();
      expect(record.mutation.afterReadToken).toBeUndefined();
    }

    const missingDelete = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missingDelete.status).toBe(409);
    expect(await missingDelete.json()).toMatchObject({
      error: expect.stringContaining("Missing project delete read proof for agent"),
      mutation: {
        operation: "project_delete",
        entity: { kind: "project", id: createdJson.id },
        beforeReadToken: baseReadToken(acceptedJson.readToken),
        accepted: false,
      },
    });

    const deleted = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "DELETE",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": acceptedJson.readToken,
      },
    });
    expect(deleted.status).toBe(200);
    const deletedJson = await deleted.json() as { readToken: string; mutation?: any };
    expect(deletedJson.mutation).toMatchObject({
      operation: "project_delete",
      entity: { kind: "project", id: createdJson.id },
      expectedReadToken: acceptedJson.readToken,
      beforeReadToken: baseReadToken(acceptedJson.readToken),
      afterReadToken: deletedJson.readToken,
      accepted: true,
    });
  });

  it("requires local-api issued project read receipts for agent writes", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Receipt Project" }),
      headers: { "content-type": "application/json" },
    });
    const createdJson = await created.json() as { id: string; readToken: string };
    expect(createdJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);

    const syntheticCasOnly = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Synthetic CAS" }),
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(createdJson.readToken),
      },
    });
    expect(syntheticCasOnly.status).toBe(409);
    expect(await syntheticCasOnly.json()).toMatchObject({
      error: expect.stringContaining("Missing project update read receipt for agent"),
      mutation: {
        operation: "project_update",
        entity: { kind: "project", id: createdJson.id },
        expectedReadToken: baseReadToken(createdJson.readToken),
        beforeReadToken: baseReadToken(createdJson.readToken),
        accepted: false,
      },
    });

    const read = await app.request(`/api/v1/projects/${createdJson.id}`);
    const readJson = await read.json() as { readToken: string };
    expect(readJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);

    const accepted = await app.request(`/api/v1/projects/${createdJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Host receipt rename" }),
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": readJson.readToken,
      },
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as { readToken: string; mutation?: any };
    expect(acceptedJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(acceptedJson.mutation).toMatchObject({
      operation: "project_update",
      entity: { kind: "project", id: createdJson.id },
      expectedReadToken: readJson.readToken,
      beforeReadToken: baseReadToken(readJson.readToken),
      afterReadToken: acceptedJson.readToken,
      accepted: true,
    });
  });

  it("supports the v1 project contract used by the local agent CLI", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Agent CLI Project",
        description: "Created through the local CLI shim",
      }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { id: string; name: string; description: string };
    expect(createdJson).toMatchObject({
      name: "Agent CLI Project",
      description: "Created through the local CLI shim",
    });

    const listed = await app.request("/api/v1/projects");
    expect(await listed.json()).toEqual({
      projects: [
        expect.objectContaining({
          id: createdJson.id,
          name: "Agent CLI Project",
          description: "Created through the local CLI shim",
          created_at: expect.any(Number),
          updated_at: expect.any(Number),
        }),
      ],
    });

    const loaded = await app.request(`/api/v1/projects/${createdJson.id}`);
    expect(await loaded.json()).toEqual(
      expect.objectContaining({
        id: createdJson.id,
        name: "Agent CLI Project",
      }),
    );

    const deleted = await app.request(`/api/v1/projects/${createdJson.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toMatchObject({ deleted: true, recoverable: true });
  });

  it("exposes local project status roots over HTTP", async () => {
    const clashRoot = join(dataDir, "clash-home");
    const app = createLocalApiApp({ dataDir, userId: "local-user", clashRoot });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Status Project" }),
      headers: { "content-type": "application/json" },
    });
    const project = (await created.json()) as { id: string; readToken: string; mutation?: unknown };
    expect(project.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(project.mutation).toEqual({
      operation: "project_create",
      entity: { kind: "project", id: project.id },
      afterReadToken: project.readToken,
      resultEntityId: project.id,
      accepted: true,
    });

    const statusRes = await app.request(`/api/v1/projects/${project.id}/status`);

    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as any;
    expect(status).toMatchObject({
      projectId: project.id,
      source: "explicit",
      mode: "local",
      syncMode: "local-only",
      collaboration: {
        schemaVersion: 1,
        mode: "local-only",
        rawMode: "local-only",
        webOpenable: false,
        multiUser: false,
        roomAuthority: "local",
        cloudProjectRoom: "disabled",
        syncReadiness: {
          status: "disabled",
          ready: false,
          required: ["canvas", "asset-metadata", "revision-content"],
          missing: ["canvas", "asset-metadata", "revision-content"],
        },
        actions: {
          openInWeb: {
            allowed: false,
            reason: "project-is-local-only",
            requirements: ["enable-sync"],
          },
          enableSync: {
            allowed: true,
            reason: null,
            requirements: [],
          },
          shareProject: {
            allowed: false,
            reason: "project-is-local-only",
            requirements: ["enable-sync"],
          },
          runLocalAgent: {
            allowed: true,
            reason: null,
            requirements: ["owner-machine-online"],
          },
        },
        localAgentRuntime: {
          requiredForLocalActions: true,
          availability: "owner-machine-online",
        },
        projectRoom: {
          schemaVersion: 1,
          localSurface: "removed",
          localPersistence: false,
          localApiEndpoints: "404",
          cliCommand: "unregistered",
          cloudSurface: "disabled",
          rawAgentTrace: false,
          agentDefaultChannels: ["sessions", "canvas", "actions"],
        },
        tracePolicy: {
          schemaVersion: 1,
          roomMessages: {
            kind: "project-chat",
            syncDefault: "sync-when-project-sync-enabled",
            rawAgentTrace: false,
          },
          agentSessionMetadata: {
            kind: "public-session-metadata",
            syncDefault: "sync-when-project-sync-enabled",
            rawAgentTrace: false,
          },
          rawAgentTraces: {
            kind: "private-runtime-trace",
            syncDefault: "local-only",
            optInRequiredForSync: true,
            excludedFromRoom: true,
            sensitiveFields: ["tool-logs", "local-file-paths", "scratch-context"],
            syncAdmission: {
              allowed: false,
              reason: "explicit-policy-required",
              requirements: ["user-opt-in-or-team-policy"],
              defaultAllowed: false,
            },
            retention: {
              default: "until-session-delete",
              scope: "per-session",
              api: "DELETE /api/v1/sessions",
              cliCommand: "clash sessions delete",
              clears: ["runtime_session", "chat_message"],
            },
          },
        },
      },
      clashHome: clashRoot,
      localApiDataDir: dataDir,
      localSqlitePath: join(dataDir, "local.sqlite"),
      roots: {
        drafts: join(clashRoot, "projects", project.id, "drafts"),
        projections: join(clashRoot, "projects", project.id, "projections"),
        timelines: join(clashRoot, "projects", project.id, "timelines"),
        assetLinks: join(clashRoot, "projects", project.id, "assets", "links"),
        runtime: join(clashRoot, "projects", project.id, "runtime"),
      },
      loro: {
        snapshotPath: join(dataDir, "projects", encodeURIComponent(project.id), "loro", "snapshot.bin"),
      },
    });
    expect(status.runtimeRoot).toBe(status.roots.runtime);
    expect(status.editablePaths).toContain(status.roots.projections);
    expect(status.editablePaths).toContain(status.roots.timelines);
    expect(status.protectedPaths).toContain(status.loro.snapshotPath);
    expect(status.protectedPaths).toContain(join(clashRoot, "assets", "blobs"));
    expect(status.protectedPaths).toContain(status.roots.runtime);
    expect(status.storage.workspace).toMatchObject({
      role: "agent-draft-and-projection-workspace",
      root: status.projectWorkspaceRoot,
      ownsCanonicalSnapshot: false,
      ownsCanonicalMetadata: false,
      viewFiles: {
        texts: {
          kind: "agent-editable-projection-files",
          path: join(status.roots.projections, "text"),
          defaultFilePattern: "<node-id>.md",
          applyCommand: "clash text apply",
          casRequired: true,
          ownsCanonicalState: false,
        },
        timelines: {
          kind: "agent-editable-view-files",
          path: status.roots.timelines,
          defaultFilePattern: "<timeline-id>.timeline.yaml",
          pullCommand: "clash timeline pull --timeline <id>",
          applyCommand: "clash timeline apply --timeline <id>",
          casRequired: true,
          ownsCanonicalState: false,
        },
        timelineProjections: {
          kind: "agent-editable-projection-files",
          path: join(status.roots.projections, "timelines"),
          defaultFilePattern: "<timeline-id>.timeline.yaml",
          applyCommand: "clash timeline apply --timeline <id>",
          casRequired: true,
          ownsCanonicalState: false,
        },
      },
    });
    expect(status.storage.canonicalReplica).toMatchObject({
      role: "single-machine-project-replica",
      scope: "machine",
      projectId: project.id,
      metadata: {
        kind: "sqlite",
        path: status.localSqlitePath,
        agentWritable: false,
      },
      projectState: {
        kind: "loro",
        snapshotPath: status.loro.snapshotPath,
        updatesLogPath: status.loro.updatesLogPath,
        agentWritable: false,
      },
      mediaAssets: {
        kind: "content-addressed-files",
        path: join(clashRoot, "assets", "blobs"),
        storageKeyPrefix: "local-blobs/",
        immutable: true,
        deduplicatedBy: "sha256",
        agentWritable: false,
        referencedBy: "sqlite-asset-rows-and-project-asset-links",
      },
      contentBlobs: {
        textRevisions: {
          kind: "content-addressed-files",
          path: join(dataDir, "text-revision-blobs"),
          mediaType: "text/markdown",
          immutable: true,
          agentWritable: false,
        },
      },
    });
    expect(status.storage.contentModel).toMatchObject({
      role: "agent-projections-over-host-owned-canonical-state",
      textNodes: {
        liveState: "loro-canvas-text-node-data",
        editableProjection: "storage.workspace.viewFiles.texts",
        projectionPath: join(status.roots.projections, "text"),
        applyCommand: "clash text apply",
        replaceCommand: "clash text replace",
        casRequired: true,
        copyOnWriteWhenReferenced: true,
        revisionRegistry: "text_revisions",
        revisionBlobPath: join(dataDir, "text-revision-blobs"),
        mediaAsset: false,
        agentWritableCanonicalState: false,
      },
      timelines: {
        liveState: "loro-project-timeline-entity",
        timelineIdentity: "timeline-id",
        editableProjection: "storage.workspace.viewFiles.timelines",
        projectionPath: status.roots.timelines,
        projectionFilePattern: "<timeline-id>.timeline.yaml",
        pullCommand: "clash timeline pull --timeline <id>",
        applyCommand: "clash timeline apply --timeline <id>",
        publicCommands: [
          "clash timeline list",
          "clash timeline create --id <id> --name <name>",
          "clash timeline attach --timeline <id> --canvas <id> --node <action-node-id>",
          "clash timeline detach --timeline <id>",
          "clash timeline copy --timeline <id> --canvas <id> --new-timeline <id> --new-node <action-node-id>",
          "clash timeline pull --timeline <id>",
          "clash timeline apply --timeline <id>",
        ],
        casRequired: true,
        copyOnWriteWhenReferenced: false,
        downstreamRendersPinRevision: true,
        revisionAuthority: "loro-project-history",
        revisionIdentity: "state-hash",
        agentWritableCanonicalState: false,
      },
    });

    const missing = await app.request("/api/v1/projects/not-found/status");
    expect(missing.status).toBe(404);
  });

  it("keeps cloud-sync project status pending until all sync capabilities are ready", async () => {
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      syncEnv: {
        CLASH_REMOTE_LORO_URL: "https://api.example.com",
        CLASH_REMOTE_LORO_TOKEN: "token-1",
      },
    });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Synced Status Project" }),
      headers: { "content-type": "application/json" },
    });
    const project = (await created.json()) as { id: string };

    const statusRes = await app.request(`/api/v1/projects/${project.id}/status`);

    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as any;
    expect(status).toMatchObject({
      projectId: project.id,
      mode: "local",
      syncMode: "cloud-sync",
      collaboration: {
        schemaVersion: 1,
        mode: "synced",
        rawMode: "cloud-sync",
        webOpenable: false,
        multiUser: false,
        roomAuthority: "local",
        cloudProjectRoom: "disabled",
        syncReadiness: {
          status: "pending",
          ready: false,
          required: ["canvas", "asset-metadata", "revision-content"],
          missing: ["canvas", "asset-metadata", "revision-content"],
        },
        actions: {
          openInWeb: {
            allowed: false,
            reason: "cloud-sync-not-ready",
            requirements: ["canvas", "asset-metadata", "revision-content"],
          },
          enableSync: {
            allowed: false,
            reason: "already-cloud-connected",
            requirements: [],
          },
          shareProject: {
            allowed: false,
            reason: "cloud-sync-not-ready",
            requirements: ["canvas", "asset-metadata", "revision-content"],
          },
          runLocalAgent: {
            allowed: true,
            reason: null,
            requirements: ["owner-machine-online"],
          },
        },
        localAgentRuntime: {
          requiredForLocalActions: true,
          availability: "owner-machine-online",
        },
      },
    });
  });

  it("marks cloud-sync project status ready only after local sync capabilities are ready", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });
    const sync = await app.request("/api/v1/local/sync", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mode: "cloud-sync",
        remote_loro_url: "https://api.example.com",
        capabilities: {
          canvas: true,
          asset_metadata: true,
          revision_content: true,
        },
      }),
    });
    expect(sync.status).toBe(200);

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Ready Synced Status Project" }),
      headers: { "content-type": "application/json" },
    });
    const project = (await created.json()) as { id: string };

    const statusRes = await app.request(`/api/v1/projects/${project.id}/status`);

    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as any;
    expect(status).toMatchObject({
      projectId: project.id,
      mode: "local",
      syncMode: "cloud-sync",
      collaboration: {
        mode: "synced",
        rawMode: "cloud-sync",
        webOpenable: true,
        roomAuthority: "local-with-cloud-mirror",
        cloudProjectRoom: "disabled",
        syncReadiness: {
          status: "ready",
          ready: true,
          required: ["canvas", "asset-metadata", "revision-content"],
          missing: [],
        },
        actions: {
          openInWeb: {
            allowed: true,
            reason: null,
            requirements: [],
          },
          shareProject: {
            allowed: true,
            reason: null,
            requirements: [],
          },
        },
      },
    });
  });

  it("soft-deletes local projects and can restore their persisted sessions", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Project with sessions" }),
      headers: { "content-type": "application/json" },
    });
    const project = (await created.json()) as { id: string; readToken: string };

    const session = await app.request("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId: project.id, title: "Session to delete" }),
      headers: { "content-type": "application/json" },
    });
    const sessionJson = (await session.json()) as { threadId: string };

    const sqlite = openSqlite();
    try {
      sqlite.prepare(`
        INSERT INTO chat_message (session_id, id, sender_kind, sender_id, turn_id, events_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sessionJson.threadId, "message-1", "agent", "agent-1", null, "[]", 1);
    } finally {
      sqlite.close();
    }

    const deleted = await app.request(`/api/v1/projects/${project.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const deletedJson = await deleted.json() as {
      deleted?: boolean;
      recoverable?: boolean;
      id?: string;
      deletedAt?: string;
      readToken?: string;
      mutation?: any;
    };
    expect(deletedJson).toMatchObject({ deleted: true, recoverable: true });
    expect(deletedJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(deletedJson.mutation).toMatchObject({
      operation: "project_delete",
      entity: { kind: "project", id: project.id },
      beforeReadToken: baseReadToken(project.readToken),
      afterReadToken: deletedJson.readToken,
      resultEntityId: project.id,
      accepted: true,
    });

    const hiddenProject = await app.request(`/api/v1/projects/${project.id}`);
    expect(hiddenProject.status).toBe(404);
    const hiddenStatus = await app.request(`/api/v1/projects/${project.id}/status`);
    expect(hiddenStatus.status).toBe(404);

    const listedSessions = await app.request(`/api/v1/sessions?projectId=${project.id}`);
    expect(await listedSessions.json()).toEqual({ sessions: [] });

    const check = openSqlite();
    try {
      expect(check.prepare("select deleted_at from project where id = ?").get(project.id)).toMatchObject({
        deleted_at: expect.any(String),
      });
      expect(check.prepare("select count(*) as count from runtime_session where project_id = ?").get(project.id)).toEqual({ count: 1 });
      expect(check.prepare("select count(*) as count from chat_message where session_id = ?").get(sessionJson.threadId)).toEqual({ count: 1 });
    } finally {
      check.close();
    }

    const restored = await app.request(`/api/v1/projects/${project.id}/restore`, { method: "POST" });
    expect(restored.status).toBe(200);
    const restoredJson = await restored.json() as {
      restored?: boolean;
      id?: string;
      readToken?: string;
      mutation?: any;
    };
    expect(restoredJson).toMatchObject({ restored: true, id: project.id });
    expect(restoredJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(restoredJson.mutation).toMatchObject({
      operation: "project_restore",
      entity: { kind: "project", id: project.id },
      beforeReadToken: baseReadToken(deletedJson.readToken!),
      afterReadToken: restoredJson.readToken,
      resultEntityId: project.id,
      accepted: true,
    });

    const visibleAgain = await app.request(`/api/v1/projects/${project.id}`);
    expect(visibleAgain.status).toBe(200);
    const restoredSessions = await app.request(`/api/v1/sessions?projectId=${project.id}`);
    expect(await restoredSessions.json()).toMatchObject({
      sessions: [{ id: sessionJson.threadId, projectId: project.id }],
    });

    const restoredCheck = openSqlite();
    try {
      expect(restoredCheck.prepare("select deleted_at from project where id = ?").get(project.id)).toEqual({
        deleted_at: null,
      });
    } finally {
      restoredCheck.close();
    }

    const missingDelete = await app.request("/api/v1/projects/missing-project", { method: "DELETE" });
    expect(missingDelete.status).toBe(404);
    expect(await missingDelete.json()).toEqual({
      error: "Project not found",
      mutation: {
        operation: "project_delete",
        entity: { kind: "project", id: "missing-project" },
        accepted: false,
        error: "Project not found",
      },
    });

    const missingRestore = await app.request("/api/v1/projects/missing-project/restore", { method: "POST" });
    expect(missingRestore.status).toBe(404);
    expect(await missingRestore.json()).toEqual({
      error: "Project recovery point not found",
      mutation: {
        operation: "project_restore",
        entity: { kind: "project", id: "missing-project" },
        accepted: false,
        error: "Project recovery point not found",
      },
    });
  });

  it("requires a receipt-bearing deleted project read before an agent can restore", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Agent Restore CAS Project" }),
    });
    expect(created.status).toBe(201);
    const project = await created.json() as { id: string; readToken: string };
    expect(project.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);

    const deleted = await app.request(`/api/v1/projects/${project.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const deletedJson = await deleted.json() as { deletedAt: string; readToken: string };
    expect(deletedJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(deletedJson.readToken).not.toBe(project.readToken);

    const hidden = await app.request(`/api/v1/projects/${project.id}`);
    expect(hidden.status).toBe(404);

    const deletedRead = await app.request(`/api/v1/projects/${project.id}?includeDeleted=true`);
    expect(deletedRead.status).toBe(200);
    const deletedReadJson = await deletedRead.json() as {
      id: string;
      deletedAt: string;
      readToken: string;
    };
    expect(deletedReadJson).toMatchObject({
      id: project.id,
      deletedAt: deletedJson.deletedAt,
      readToken: deletedJson.readToken,
    });
    expect(deletedReadJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);

    const missing = await app.request(`/api/v1/projects/${project.id}/restore`, {
      method: "POST",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missing.status).toBe(409);
    expect(await missing.json()).toMatchObject({
      error: expect.stringContaining("Missing project restore read proof for agent"),
      mutation: {
        operation: "project_restore",
        entity: { kind: "project", id: project.id },
        accepted: false,
      },
    });

    const bare = await app.request(`/api/v1/projects/${project.id}/restore`, {
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(deletedReadJson.readToken),
      },
    });
    expect(bare.status).toBe(409);
    expect(await bare.json()).toMatchObject({
      error: expect.stringContaining("Missing project restore read receipt for agent"),
      mutation: {
        operation: "project_restore",
        entity: { kind: "project", id: project.id },
        expectedReadToken: baseReadToken(deletedReadJson.readToken),
        beforeReadToken: baseReadToken(deletedReadJson.readToken),
        accepted: false,
      },
    });

    const stale = await app.request(`/api/v1/projects/${project.id}/restore`, {
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": project.readToken,
      },
    });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({
      error: expect.stringContaining("Stale project restore rejected"),
      mutation: {
        operation: "project_restore",
        entity: { kind: "project", id: project.id },
        expectedReadToken: project.readToken,
        beforeReadToken: baseReadToken(deletedReadJson.readToken),
        accepted: false,
      },
    });

    const accepted = await app.request(`/api/v1/projects/${project.id}/restore`, {
      method: "POST",
      headers: {
        "x-clash-client-type": "agent",
        "x-clash-if-match": deletedReadJson.readToken,
      },
    });
    expect(accepted.status).toBe(200);
    const acceptedJson = await accepted.json() as { readToken: string; mutation?: any };
    expect(acceptedJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(acceptedJson.readToken).not.toBe(deletedReadJson.readToken);
    expect(acceptedJson).toMatchObject({
      restored: true,
      id: project.id,
      mutation: {
        operation: "project_restore",
        entity: { kind: "project", id: project.id },
        expectedReadToken: deletedReadJson.readToken,
        beforeReadToken: baseReadToken(deletedReadJson.readToken),
        afterReadToken: acceptedJson.readToken,
        resultEntityId: project.id,
        accepted: true,
      },
    });

    const audit = await app.request(`/api/v1/mutation-audit?operation=project_restore&entityId=${project.id}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "project_restore",
      entity: { kind: "project", id: project.id },
      accepted: true,
      actorClientType: "agent",
      reason: "project restore",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();
  });

  it("marks cloud-sync project delete restore and purge as local replica recovery only", async () => {
    const syncConfig = createLocalSyncConfigStore({
      dataDir,
      env: {},
    });
    await syncConfig.updateFromRequest({
      mode: "cloud-sync",
      remote_loro_url: "https://api.example.com",
      remote_loro_token: "token-1",
      capabilities: {
        canvas: true,
        asset_metadata: true,
        revision_content: true,
      },
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncConfig });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Cloud Sync Local Recovery Project" }),
    });
    const project = await created.json() as { id: string; readToken: string };
    const expectedPolicy = {
      scope: "local-canonical-replica",
      collaborationMode: "synced",
      rawSyncMode: "cloud-sync",
      roomAuthority: "local-with-cloud-mirror",
      cloudProjectRoom: "disabled",
      syncReadinessStatus: "ready",
      localRestoreAllowed: true,
      cloudStateIncluded: false,
      cloudStateMutated: false,
      requiresCloudConflictReview: true,
      reason: "cloud-sync-local-replica-review-required",
    };

    const deleted = await app.request(`/api/v1/projects/${project.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const deletedJson = await deleted.json() as { readToken: string };
    expect(deletedJson).toMatchObject({
      deleted: true,
      recoverable: true,
      recoveryPolicy: expectedPolicy,
    });

    const restored = await app.request(`/api/v1/projects/${project.id}/restore`, { method: "POST" });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({
      restored: true,
      recoveryPolicy: expectedPolicy,
    });

    const deletedAgain = await app.request(`/api/v1/projects/${project.id}`, { method: "DELETE" });
    expect(deletedAgain.status).toBe(200);
    await deletedAgain.json();
    ageDeletedProjectForPurge(project.id);
    const agedDeleted = await app.request(`/api/v1/projects/${project.id}?includeDeleted=true`);
    expect(agedDeleted.status).toBe(200);
    const agedDeletedJson = await agedDeleted.json() as { readToken: string };
    const purged = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": agedDeletedJson.readToken,
      },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(purged.status).toBe(200);
    expect(await purged.json()).toMatchObject({
      purged: true,
      recoverable: false,
      recoveryPolicy: {
        ...expectedPolicy,
        localRestoreAllowed: false,
      },
    });
  });

  it("purges deleted project recovery points only after explicit confirmation", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Project to purge" }),
    });
    expect(created.status).toBe(201);
    const project = await created.json() as { id: string; readToken: string };

    const session = await app.request("/api/v1/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, title: "Session to purge" }),
    });
    expect(session.status).toBe(200);
    const sessionJson = await session.json() as { threadId: string };

    const replica = new FileReplicaStore(join(dataDir, "projects"));
    const doc = new LoroDoc();
    doc.getMap("nodes").set("purge-node", { type: "text", data: { label: "Delete me" } });
    await replica.saveSnapshotAtomic(project.id, doc.export({ mode: "snapshot" }));
    await expect(stat(join(dataDir, "projects", encodeURIComponent(project.id), "loro", "snapshot.bin"))).resolves.toMatchObject({
      size: expect.any(Number),
    });

    const sqlite = openSqlite();
    try {
      const now = Date.now();
      sqlite.prepare(`
        INSERT INTO chat_message (session_id, id, sender_kind, sender_id, turn_id, events_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sessionJson.threadId, "purge-chat-message", "agent", "agent-1", null, "[]", now);
      sqlite.prepare(`
        INSERT INTO assets (
          id, user_id, kind, src_r2_key, cover_r2_key, metadata, source_model, source_prompt,
          source_task_id, sources, signed_url, signed_url_exp, created_at, updated_at, project_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "purge-asset",
        "local-user",
        "image",
        "blobs/purge-asset.png",
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        now,
        now,
        project.id,
      );
      sqlite.prepare("INSERT OR REPLACE INTO asset_refs (asset_id, project_id, imported_at) VALUES (?, ?, ?)")
        .run("purge-asset", project.id, now);
      sqlite.prepare(`
        INSERT OR REPLACE INTO asset_node_refs (
          asset_id, project_id, node_id, node_type, field_path, reference_role, observed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run("purge-asset", project.id, "purge-node", "image", "data.assetId", "asset", now);
      sqlite.prepare(`
        INSERT INTO project_preview_asset (project_id, asset_id, url, type, storage_key, created_at, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(project.id, "purge-asset", "file:///purge-asset.png", "image", "blobs/purge-asset.png", new Date(now).toISOString(), 0);
    } finally {
      sqlite.close();
    }

    const activePurge = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(activePurge.status).toBe(409);
    expect(await activePurge.json()).toMatchObject({
      error: "Project must be deleted before purge",
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        accepted: false,
      },
    });

    const deleted = await app.request(`/api/v1/projects/${project.id}`, { method: "DELETE" });
    expect(deleted.status).toBe(200);
    const deletedJson = await deleted.json() as { deletedAt: string; readToken: string };
    expect(deletedJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);

    const missingConfirm = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(missingConfirm.status).toBe(400);
    expect(await missingConfirm.json()).toMatchObject({
      error: "confirm must be \"purge\"",
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        accepted: false,
      },
    });

    const missingReadProof = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
      },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(missingReadProof.status).toBe(409);
    expect(await missingReadProof.json()).toMatchObject({
      error: expect.stringContaining("Missing project purge read proof for agent"),
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        accepted: false,
      },
    });

    const bareReadToken = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": baseReadToken(deletedJson.readToken),
      },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(bareReadToken.status).toBe(409);
    expect(await bareReadToken.json()).toMatchObject({
      error: expect.stringContaining("Missing project purge read receipt for agent"),
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        expectedReadToken: baseReadToken(deletedJson.readToken),
        beforeReadToken: baseReadToken(deletedJson.readToken),
        accepted: false,
      },
    });

    const delayed = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": deletedJson.readToken,
      },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(delayed.status).toBe(409);
    const delayedJson = await delayed.json() as any;
    expect(delayedJson).toMatchObject({
      recoverable: true,
      purgeAfter: expect.any(String),
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        expectedReadToken: deletedJson.readToken,
        beforeReadToken: baseReadToken(deletedJson.readToken),
        accepted: false,
      },
    });
    expect(delayedJson.error).toBe(`Project purge is delayed until ${delayedJson.purgeAfter}.`);
    expect(delayedJson.error).not.toMatch(/\b(force|admin)\b/i);
    expect(Date.parse(delayedJson.purgeAfter)).toBeGreaterThan(Date.parse(deletedJson.deletedAt));

    ageDeletedProjectForPurge(project.id);
    const agedDeleted = await app.request(`/api/v1/projects/${project.id}?includeDeleted=true`);
    expect(agedDeleted.status).toBe(200);
    const agedDeletedJson = await agedDeleted.json() as { deletedAt: string; readToken: string };

    const purged = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": agedDeletedJson.readToken,
      },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(purged.status).toBe(200);
    expect(await purged.json()).toMatchObject({
      purged: true,
      recoverable: false,
      id: project.id,
      deletedAt: agedDeletedJson.deletedAt,
      purgeAfter: expect.any(String),
      replicaDeleted: true,
      removed: {
        projects: 1,
        projectPreviewAssets: 1,
        sessions: 1,
        sessionMessages: 1,
        assetRowsUnlinked: 1,
        assetRefs: 1,
        assetNodeRefs: 1,
      },
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        expectedReadToken: agedDeletedJson.readToken,
        beforeReadToken: baseReadToken(agedDeletedJson.readToken),
        resultEntityId: project.id,
        accepted: true,
      },
    });

    await expect(stat(join(dataDir, "projects", encodeURIComponent(project.id)))).rejects.toMatchObject({ code: "ENOENT" });

    const hidden = await app.request(`/api/v1/projects/${project.id}?includeDeleted=true`);
    expect(hidden.status).toBe(404);
    const restore = await app.request(`/api/v1/projects/${project.id}/restore`, { method: "POST" });
    expect(restore.status).toBe(404);

    const check = openSqlite();
    try {
      expect(check.prepare("select count(*) as count from project where id = ?").get(project.id)).toEqual({ count: 0 });
      expect(check.prepare("select count(*) as count from project_preview_asset where project_id = ?").get(project.id)).toEqual({ count: 0 });
      expect(check.prepare("select count(*) as count from runtime_session where project_id = ?").get(project.id)).toEqual({ count: 0 });
      expect(check.prepare("select count(*) as count from chat_message where session_id = ?").get(sessionJson.threadId)).toEqual({ count: 0 });
      expect(check.prepare("select count(*) as count from asset_refs where project_id = ?").get(project.id)).toEqual({ count: 0 });
      expect(check.prepare("select count(*) as count from asset_node_refs where project_id = ?").get(project.id)).toEqual({ count: 0 });
      expect(check.prepare("select count(*) as count from assets where id = ?").get("purge-asset")).toEqual({ count: 1 });
      expect(check.prepare("select project_id from assets where id = ?").get("purge-asset")).toEqual({ project_id: null });
    } finally {
      check.close();
    }

    const audit = await app.request(`/api/v1/mutation-audit?operation=project_purge&entityId=${project.id}`);
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as {
      records: Array<{
        operation: string;
        entity: { kind: string; id: string };
        accepted: boolean;
        actorClientType?: string;
        reason?: string;
        mutation: Record<string, unknown>;
      }>;
    };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "project_purge",
      entity: { kind: "project", id: project.id },
      accepted: true,
      actorClientType: "agent",
      reason: "project purge",
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        accepted: true,
        resultEntityId: project.id,
      },
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
  });

  it("returns local project preview assets for the desktop project grid", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Desktop grid previews" }),
      headers: { "content-type": "application/json" },
    });
    const { id: projectId } = (await created.json()) as { id: string };

    for (let index = 1; index <= 12; index++) {
      const res = await app.request("/api/v1/assets", {
        method: "POST",
        body: JSON.stringify({
          projectId,
          kind: "image",
          srcR2Key: `uploads/preview-${index}.png`,
        }),
        headers: { "content-type": "application/json" },
      });
      expect(res.status).toBe(200);
    }

    const sqlite = openSqlite();
    try {
      sqlite.prepare(`
        INSERT INTO project_preview_asset
          (project_id, asset_id, url, type, storage_key, created_at, position)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        projectId,
        "legacy-preview-id",
        "/assets/uploads/preview-12.png",
        "image",
        "uploads/preview-12.png",
        new Date().toISOString(),
        99,
      );
    } finally {
      sqlite.close();
    }

    const listed = await app.request("/api/v1/projects");
    const listedJson = (await listed.json()) as { projects: Array<{
      id: string;
      assets: Array<{ url: string; type: string; storageKey: string }>;
      assetCount: number;
    }> };
    const projects = listedJson.projects;
    expect(projects[0].id).toBe(projectId);
    expect(projects[0].assets).toHaveLength(4);
    expect(projects[0].assetCount).toBe(12);
    expect(new Set(projects[0].assets.map((asset) => asset.url)).size).toBe(4);
    expect(projects[0].assets.every((asset) =>
      /^\/assets\/uploads\/preview-(?:[1-9]|1[0-2])\.png$/.test(asset.url),
    )).toBe(true);

    const loaded = await app.request(`/api/v1/projects/${projectId}`);
    const project = (await loaded.json()) as { assets: unknown[]; assetCount: number };
    expect(project.assets).toHaveLength(12);
    expect(project.assetCount).toBe(12);
  });

  it("stores uploaded files locally and exposes unsigned asset URLs", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const missingForm = new FormData();
    const missing = await app.request("/upload", { method: "POST", body: missingForm });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({
      error: "Missing file",
      mutation: {
        operation: "asset_blob_upload",
        entity: { kind: "asset-blob", id: "" },
        accepted: false,
        error: "Missing file",
      },
    });

    const form = new FormData();
    form.append("file", new File(["hello"], "hello world.txt", { type: "text/plain" }));

    const upload = await app.request("/upload", { method: "POST", body: form });
    expect(upload.status).toBe(200);
    const { storageKey, mutation } = (await upload.json()) as { storageKey: string; mutation?: unknown };
    expect(storageKey).toMatch(/^uploads\/.+-hello_world\.txt$/);
    expect(mutation).toEqual({
      operation: "asset_blob_upload",
      entity: { kind: "asset-blob", id: storageKey },
      accepted: true,
      resultEntityId: storageKey,
    });
    await expectSingleMutationAudit(app, {
      operation: "asset_blob_upload",
      entityId: storageKey,
      entityKind: "asset-blob",
      reason: "asset blob upload",
    });

    const sign = await app.request(`/assets/sign?key=${encodeURIComponent(storageKey)}`);
    expect(await sign.json()).toMatchObject({ url: `http://localhost/assets/${storageKey}` });

    const served = await app.request(`/assets/${storageKey}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("text/plain");
    expect(await served.text()).toBe("hello");
  });

  it("serves byte ranges for media assets", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const form = new FormData();
    form.append(
      "file",
      new File(["0123456789"], "sample.mp4", { type: "video/mp4" }),
    );

    const upload = await app.request("/upload", {
      method: "POST",
      body: form,
    });
    const { storageKey } = (await upload.json()) as { storageKey: string };
    const served = await app.request(`/assets/${storageKey}`, {
      headers: { range: "bytes=2-5" },
    });

    expect(served.status).toBe(206);
    expect(served.headers.get("accept-ranges")).toBe("bytes");
    expect(served.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(served.headers.get("content-length")).toBe("4");
    expect(await served.text()).toBe("2345");
  });

  it("rejects local asset uploads when the storage parent escapes through a symlink", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "clash-local-api-outside-assets-"));
    try {
      await mkdir(join(dataDir, "assets"), { recursive: true });
      await symlink(outsideDir, join(dataDir, "assets", "uploads"));
      const app = createLocalApiApp({ dataDir, userId: "local-user" });

      const form = new FormData();
      form.append("file", new File(["escape"], "escape.txt", { type: "text/plain" }));
      const upload = await app.request("/upload", { method: "POST", body: form });

      expect(upload.status).toBe(400);
      expect(await upload.json()).toMatchObject({
        error: "Asset path escapes local asset storage",
        mutation: {
          operation: "asset_blob_upload",
          entity: { kind: "asset-blob", id: expect.stringMatching(/^uploads\/.+-escape\.txt$/) },
          accepted: false,
          error: "Asset path escapes local asset storage",
        },
      });
      await expect(readdir(outsideDir)).resolves.toEqual([]);
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("rejects local asset uploads when the storage root escapes through a symlink", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "clash-local-api-outside-asset-root-"));
    const assetRootPath = join(dataDir, "assets");
    try {
      await symlink(outsideDir, assetRootPath);
      const app = createLocalApiApp({ dataDir, userId: "local-user" });

      const form = new FormData();
      form.append("file", new File(["root-escape"], "root escape.txt", { type: "text/plain" }));
      const upload = await app.request("/upload", { method: "POST", body: form });

      expect(upload.status).toBe(400);
      expect(await upload.json()).toMatchObject({
        error: "Asset path escapes local asset storage",
        mutation: {
          operation: "asset_blob_upload",
          entity: { kind: "asset-blob", id: expect.stringMatching(/^uploads\/.+-root_escape\.txt$/) },
          accepted: false,
          error: "Asset path escapes local asset storage",
        },
      });
      await expect(readdir(outsideDir)).resolves.toEqual([]);
    } finally {
      await rm(assetRootPath, { force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("does not serve local assets through a symlinked storage parent outside the asset root", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "clash-local-api-outside-read-"));
    try {
      await writeFile(join(outsideDir, "outside.txt"), "outside");
      await mkdir(join(dataDir, "assets"), { recursive: true });
      await symlink(outsideDir, join(dataDir, "assets", "uploads"));
      const app = createLocalApiApp({ dataDir, userId: "local-user" });

      const served = await app.request("/assets/uploads/outside.txt");

      expect(served.status).toBe(404);
      expect(await served.text()).not.toBe("outside");
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("does not serve local assets when the storage root escapes through a symlink", async () => {
    const outsideDir = await mkdtemp(join(tmpdir(), "clash-local-api-outside-root-read-"));
    const assetRootPath = join(dataDir, "assets");
    try {
      await mkdir(join(outsideDir, "uploads"), { recursive: true });
      await writeFile(join(outsideDir, "uploads", "outside.txt"), "outside");
      await symlink(outsideDir, assetRootPath);
      const app = createLocalApiApp({ dataDir, userId: "local-user" });

      const served = await app.request("/assets/uploads/outside.txt");

      expect(served.status).toBe(404);
      expect(await served.text()).not.toBe("outside");
    } finally {
      await rm(assetRootPath, { force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  });

  it("returns absolute local API asset URLs for desktop clash:// pages", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const origin = "http://127.0.0.1:49321";

    const created = await app.request(`${origin}/api/v1/assets`, {
      method: "POST",
      body: JSON.stringify({
        projectId: "project-1",
        kind: "image",
        srcR2Key: "generated/mock.svg",
      }),
      headers: { "content-type": "application/json" },
    });
    const createdJson = (await created.json()) as { id: string; signedUrl?: string };
    expect(createdJson.signedUrl).toBe(`${origin}/assets/generated/mock.svg`);

    const loaded = await app.request(`${origin}/api/v1/assets/${createdJson.id}`);
    const asset = (await loaded.json()) as { signedUrl?: string };
    expect(asset.signedUrl).toBe(`${origin}/assets/generated/mock.svg`);

    const signed = await app.request(`${origin}/assets/sign?key=${encodeURIComponent("generated/mock.svg")}`);
    expect(await signed.json()).toMatchObject({
      url: `${origin}/assets/generated/mock.svg`,
    });
  });

  it("simulates the fal queue API and media CDN locally", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const origin = "http://127.0.0.1:49321";
    const modelId = "fal-ai/flux/dev";

    const submitted = await app.request(`${origin}/fal/${modelId}`, {
      method: "POST",
      headers: {
        authorization: "Key mock",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: "a local fal dog",
        image_size: "landscape_16_9",
        output_format: "png",
      }),
    });
    expect(submitted.status).toBe(200);
    const submitJson = (await submitted.json()) as {
      request_id: string;
      response_url: string;
      status_url: string;
      cancel_url: string;
      queue_position: number;
    };
    expect(submitJson.request_id).toMatch(/^fal-mock-/);
    expect(submitJson.response_url).toBe(`${origin}/fal/${modelId}/requests/${submitJson.request_id}/response`);
    expect(submitJson.status_url).toBe(`${origin}/fal/${modelId}/requests/${submitJson.request_id}/status`);
    expect(submitJson.cancel_url).toBe(`${origin}/fal/${modelId}/requests/${submitJson.request_id}/cancel`);
    expect(submitJson.queue_position).toBe(0);

    const queued = await app.request(submitJson.status_url);
    expect(queued.status).toBe(202);
    expect(await queued.json()).toMatchObject({
      status: "IN_QUEUE",
      request_id: submitJson.request_id,
      queue_position: 0,
      response_url: submitJson.response_url,
    });

    const running = await app.request(`${submitJson.status_url}?logs=1`);
    expect(running.status).toBe(202);
    expect(await running.json()).toMatchObject({
      status: "IN_PROGRESS",
      request_id: submitJson.request_id,
      response_url: submitJson.response_url,
      logs: expect.arrayContaining([
        expect.objectContaining({ message: expect.stringContaining("Generating") }),
      ]),
    });

    const completed = await app.request(`${submitJson.status_url}?logs=1`);
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({
      status: "COMPLETED",
      request_id: submitJson.request_id,
      response_url: submitJson.response_url,
      logs: [expect.objectContaining({ message: "Done." })],
      metrics: { inference_time: expect.any(Number) },
    });

    const result = await app.request(submitJson.response_url);
    expect(result.status).toBe(200);
    const resultJson = (await result.json()) as {
      images: Array<{ url: string; width: number; height: number; content_type: string }>;
      prompt: string;
      seed: number;
      has_nsfw_concepts: boolean[];
    };
    expect(resultJson).toMatchObject({
      prompt: "a local fal dog",
      seed: expect.any(Number),
      has_nsfw_concepts: [false],
    });
    expect(resultJson.images[0]).toMatchObject({
      url: `${origin}/fal/media/${submitJson.request_id}.svg`,
      width: 1024,
      height: 576,
      content_type: "image/svg+xml",
    });

    const media = await app.request(resultJson.images[0].url);
    expect(media.status).toBe(200);
    expect(media.headers.get("content-type")).toContain("image/svg+xml");
    expect(await media.text()).toContain("a local fal dog");
  });

  it("simulates fal video and audio outputs with prompt, aspect ratio, and duration", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const origin = "http://127.0.0.1:49321";

    const videoSubmitted = await app.request(`${origin}/fal/fal-ai/sora-2/text-to-video`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "vertical video prompt",
        duration: 4,
        aspect_ratio: "9:16",
      }),
    });
    const videoSubmitJson = (await videoSubmitted.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };
    await app.request(videoSubmitJson.status_url);
    await app.request(videoSubmitJson.status_url);
    await app.request(videoSubmitJson.status_url);
    const videoResponse = await app.request(videoSubmitJson.response_url);
    expect(videoResponse.status).toBe(200);
    const videoJson = (await videoResponse.json()) as {
      video: { url: string; width: number; height: number; duration: number; content_type: string };
      prompt: string;
    };
    expect(videoJson.prompt).toBe("vertical video prompt");
    expect(videoJson.video).toMatchObject({
      url: `${origin}/fal/media/${videoSubmitJson.request_id}.mp4`,
      width: 720,
      height: 1280,
      duration: 4,
      content_type: "video/mp4",
    });
    const videoMedia = await app.request(videoJson.video.url);
    expect(videoMedia.status).toBe(200);
    expect(videoMedia.headers.get("content-type")).toContain("video/mp4");
    expect(videoMedia.headers.get("content-length")).not.toBe("0");

    const audioSubmitted = await app.request(`${origin}/fal/fal-ai/minimax/speech-02-hd`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "audio content prompt",
        duration: 3,
      }),
    });
    const audioSubmitJson = (await audioSubmitted.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };
    await app.request(audioSubmitJson.status_url);
    await app.request(audioSubmitJson.status_url);
    await app.request(audioSubmitJson.status_url);
    const audioResponse = await app.request(audioSubmitJson.response_url);
    expect(audioResponse.status).toBe(200);
    const audioJson = (await audioResponse.json()) as {
      audio: { url: string; duration: number; content_type: string };
      prompt: string;
      transcript: string;
    };
    expect(audioJson.prompt).toBe("audio content prompt");
    expect(audioJson.transcript).toBe("audio content prompt");
    expect(audioJson.audio).toMatchObject({
      url: `${origin}/fal/media/${audioSubmitJson.request_id}.wav`,
      duration: 3,
      content_type: "audio/wav",
    });
    const audioMedia = await app.request(audioJson.audio.url);
    expect(audioMedia.status).toBe(200);
    expect(audioMedia.headers.get("content-type")).toContain("audio/wav");
    expect(await audioMedia.text()).toContain("audio content prompt");
  });
});
