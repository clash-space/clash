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
  canvasEdgeReadToken,
  canvasEdgesReadToken,
  canvasNodeReadToken,
  type Asset,
} from "@clash/shared-types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalApiApp, type LocalAcpAgentServersConfig } from "./app";
import { createLocalAudioConfigStore } from "./audio-config";
import { createMockFalQueueService } from "./fal-mock";
import { FileReplicaStore } from "./loro/file-replica-store";
import { createLocalSyncConfigStore } from "./sync-config";

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
    forced: false,
    accepted: true,
    resultEntityId: `${providerId}:${modelId}`,
  };
}

const PROJECT_RECEIPT_READ_TOKEN_RE = /^project-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
const NODE_RECEIPT_READ_TOKEN_RE = /^node-v1:[a-f0-9]{16}:receipt:[A-Za-z0-9._~-]+$/;
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

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-"));
});

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

async function createTestPrivateKeyPem(): Promise<string> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const body = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g)?.join("\n") ?? "";
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`;
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

  it("persists local cloud sync configuration without exposing the token", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });

    const initial = await app.request("/api/v1/local/sync");
    expect(await initial.json()).toEqual({
      mode: "local-only",
      remote_loro: {
        enabled: false,
        url: null,
        has_token: false,
        source: "none",
      },
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
    expect(await updated.json()).toEqual({
      mode: "cloud-sync",
      remote_loro: {
        enabled: true,
        url: "https://cloud.example",
        has_token: true,
        source: "config",
      },
      readToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      mutation: {
        operation: "local_sync_config_update",
        entity: { kind: "local-config", id: "sync" },
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
    expect(await accepted.json()).toMatchObject({
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
        forced: false,
        accepted: true,
        resultEntityId: "sync",
        afterReadToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      },
    });
  });

  it("persists built-in local audio ASR configuration without requiring an endpoint", async () => {
    const audioConfig = createLocalAudioConfigStore({
      dataDir,
      builtinStatus: async () => ({ available: false, message: "FunASR is not installed" }),
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", audioConfig });

    const initial = await app.request("/api/v1/local/audio");
    expect(await initial.json()).toEqual({
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
    expect(await updated.json()).toEqual({
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
        forced: false,
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
    expect(await legacyEndpointConfig.json()).toEqual({
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
        forced: false,
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
    expect(await persisted.json()).toEqual({
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
        forced: false,
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
        forced: false,
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
        forced: false,
        accepted: true,
        resultEntityId: "audio",
        afterReadToken: expect.stringMatching(LOCAL_CONFIG_RECEIPT_READ_TOKEN_RE),
      },
    });
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
    expect(await install.json()).toEqual({
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
        forced: false,
        accepted: true,
        resultEntityId: "audio",
      },
    });
    expect(builtinInstall).toHaveBeenCalledWith({ model: "iic/SenseVoiceSmall", pythonBinary: "python3" });
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
        forced: false,
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
      return { text: "你好 Clash" };
    });
    const audioConfig = createLocalAudioConfigStore({ dataDir, builtinTranscribe });
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
    const form = new FormData();
    form.append("file", new File(["voice-bytes"], "voice.webm", { type: "audio/webm" }));

    const res = await app.request("/api/v1/local/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      text: "你好 Clash",
      mutation: {
        operation: "local_audio_transcription",
        entity: { kind: "local-action", id: "audio-transcription" },
        forced: false,
        accepted: true,
        resultEntityId: "audio-transcription",
      },
    });
    expect(builtinTranscribe).toHaveBeenCalledTimes(1);
  });

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
      error: "Local ASR is not enabled. Open Settings > Audio and enable voice input.",
      mutation: {
        operation: "local_audio_transcription",
        entity: { kind: "local-action", id: "audio-transcription" },
        forced: false,
        accepted: false,
        error: "Local ASR is not enabled. Open Settings > Audio and enable voice input.",
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
        forced: false,
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

  it("persists local project metadata in SQLite without creating legacy db.json", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Private DB permissions" }),
    });

    expect(created.status).toBe(201);
    await expect(stat(join(dataDir, "local.sqlite"))).resolves.toMatchObject({ mode: expect.any(Number) });
    await expect(stat(join(dataDir, "db.json"))).rejects.toMatchObject({ code: "ENOENT" });

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
        forced: false,
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId, title: "Editable session" }),
    });
    expect(created.status).toBe(200);
    const createdJson = await created.json() as { threadId: string; title: string; mutation?: unknown };
    expect(createdJson.title).toBe("Editable session");
    expect(createdJson.mutation).toEqual({
      operation: "session_create",
      entity: { kind: "session", id: createdJson.threadId },
      resultEntityId: createdJson.threadId,
      forced: false,
      accepted: true,
    });

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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
      forced: false,
      actorClientType: "agent",
      reason: "session delete",
      mutation: {
        operation: "session_delete",
        entity: { kind: "session", id: threadId },
        resultEntityId: threadId,
        forced: false,
        accepted: true,
      },
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
  });

  it("keeps all concurrent asset creates for a project preview", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const createdProject = await app.request("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Concurrent Asset Project" }),
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
          contentHash,
          mediaType: "text/markdown",
          url: `/api/v1/projects/project-text/text-revisions/${revision.revisionId}/content`,
          immutable: true,
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
  });

  it("indexes applied timeline revisions with immutable content blobs without creating media asset rows", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const content = [
      "tracks:",
      "  - id: main",
      "    items:",
      "      - id: scene-001-video",
      "        type: video",
      "        from: start",
      "        durationInFrames: 30",
      "        sourceNodeId: scene-001",
      "        assetId: asset-001",
      "        componentId: lower-third",
      "        textNodeId: script-001",
      "",
    ].join("\n");
    const timelineHash = "e727416a48c14543";
    const revision = {
      schemaVersion: 1,
      kind: "clash.timeline.revision",
      timelineId: "timeline:project-timeline:editor",
      revisionId: "tlrev-1234567890abcdef-feedfacecafe",
      parentRevisionId: "tlrev-parent",
      projectId: "project-timeline",
      nodeId: "editor",
      createdAt: "2026-07-07T00:00:00.000Z",
      timelineHash,
      hashAlgorithm: "sha256-64",
      sourceFilePath: "timelines/main.timeline.yaml",
      sourceFileHash: timelineHash,
      actor: { actorType: "agent", actorUserId: "user-1", actorAgentId: "agent-1" },
      loroFrontiers: [{ peer: "1", counter: 4 }],
      loroVersionVector: { "1": 4 },
      dependencies: {
        sourceNodeIds: ["scene-001"],
        assetIds: ["asset-001"],
        componentIds: ["lower-third"],
        textNodeIds: ["script-001"],
      },
    };

    const registered = await app.request("/api/v1/timeline-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, content }),
    });
    expect(registered.status).toBe(200);
    const registeredJson = await registered.json();
    expect(registeredJson).toMatchObject({
      revision,
      content: {
        kind: "timeline-revision-content",
        stored: true,
        timelineHash,
        mediaType: "application/yaml",
        url: `/api/v1/projects/project-timeline/timeline-revisions/${revision.revisionId}/content`,
        immutable: true,
      },
      mutation: {
        operation: "timeline_revision_index",
        entity: { kind: "timeline", id: "project-timeline:editor" },
        resultEntityId: revision.revisionId,
        accepted: true,
      },
    });

    const listed = await app.request("/api/v1/projects/project-timeline/timeline-revisions?nodeId=editor");
    expect(await listed.json()).toEqual({
      revisions: [{
        ...revision,
        content: {
          kind: "timeline-revision-content",
          timelineHash,
          mediaType: "application/yaml",
          url: `/api/v1/projects/project-timeline/timeline-revisions/${revision.revisionId}/content`,
          immutable: true,
        },
      }],
    });

    const contentResponse = await app.request(registeredJson.content.url);
    expect(contentResponse.status).toBe(200);
    expect(contentResponse.headers.get("content-type")).toContain("application/yaml");
    expect(contentResponse.headers.get("x-clash-timeline-hash")).toBe(timelineHash);
    expect(await contentResponse.text()).toBe(content);

    const blobPath = join(dataDir, "timeline-revision-blobs", timelineHash.slice(0, 2), `${timelineHash}.timeline.yaml`);
    expect(await readFile(blobPath, "utf8")).toBe(content);
    expect((await stat(blobPath)).mode & 0o777).toBe(0o444);

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select count(*) as count from timeline_revisions").get()).toEqual({ count: 1 });
      expect(sqlite.prepare("select count(*) as count from assets").get()).toEqual({ count: 0 });
    } finally {
      sqlite.close();
    }
  });

  it("rejects timeline revision content whose semantic hash does not match the revision", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const revision = {
      schemaVersion: 1,
      kind: "clash.timeline.revision",
      timelineId: "timeline:project-timeline:editor",
      revisionId: "tlrev-1234567890abcdef-badcontent",
      projectId: "project-timeline",
      nodeId: "editor",
      createdAt: "2026-07-07T00:00:00.000Z",
      timelineHash: "1234567890abcdef",
      hashAlgorithm: "sha256-64",
      sourceFilePath: "timelines/main.timeline.yaml",
      sourceFileHash: "1234567890abcdef",
      dependencies: {
        sourceNodeIds: [],
        assetIds: [],
        componentIds: [],
        textNodeIds: [],
      },
    };

    const registered = await app.request("/api/v1/timeline-revisions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revision, content: "tracks: []\n" }),
    });

    expect(registered.status).toBe(400);
    expect(await registered.json()).toMatchObject({
      error: "timeline revision timelineHash does not match content",
      mutation: {
        operation: "timeline_revision_index",
        accepted: false,
        error: "timeline revision timelineHash does not match content",
      },
    });

    const listed = await app.request("/api/v1/projects/project-timeline/timeline-revisions?nodeId=editor");
    expect(await listed.json()).toEqual({ revisions: [] });
    await expect(stat(join(dataDir, "timeline-revision-blobs", "12", "1234567890abcdef.timeline.yaml")))
      .rejects.toMatchObject({ code: "ENOENT" });
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
        forced: false,
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
        forced: false,
        accepted: false,
      },
    });

    await expect(stat(join(dataDir, "local.sqlite"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("requires projectId when removing an asset reference", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/assets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: "project-a", kind: "image", srcR2Key: "uploads/shared.png" }),
    });
    const { id: assetId, mutation: createMutation } = await created.json() as { id: string; mutation?: unknown };
    expect(createMutation).toEqual({
      operation: "asset_create",
      entity: { kind: "asset", id: assetId },
      resultEntityId: assetId,
      forced: false,
      accepted: true,
    });

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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
      forced: false,
      accepted: true,
    });

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
        forced: false,
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
        forced: false,
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
        forced: false,
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
      headers: { "content-type": "application/json" },
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
        forced: false,
        accepted: true,
      },
    });
    expect(importedJson.signedUrl).toContain(`/assets/local-blobs/${contentHash}/original.png`);

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
        forced: false,
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
        forced: false,
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
        forced: false,
        accepted: false,
      },
    });

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
        forced: false,
        accepted: true,
        resultEntityId: "image-replacement",
      },
    });

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
    const edges = recovered.getMap("edges");
    expect(edges.get("image-source-image-replacement")).toMatchObject({
      source: "image-source",
      target: "image-replacement",
      type: "copy-on-write",
    });
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
      forced: false,
      actorClientType: "agent",
      reason: "canvas edge delete",
      mutation: {
        operation: "canvas_delete_edge",
        entity: { kind: "canvas-edge", id: "edge-bc" },
        resultEntityId: "edge-bc",
        forced: false,
        accepted: true,
      },
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("afterReadToken");

    const recovered = await new FileReplicaStore(join(dataDir, "projects")).recover(projectId);
    expect(recovered.getMap("edges").get("edge-ab")).toMatchObject({
      source: "node-a",
      target: "node-b",
    });
    expect(recovered.getMap("edges").get("edge-bc")).toBeUndefined();
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
        forced: false,
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
      forced: false,
      actorClientType: "agent",
      reason: "asset garbage collection",
      mutation: {
        operation: "asset_gc",
        entity: { kind: "asset-store", id: "local" },
        resultEntityId: "local",
        forced: false,
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

    const refresh = await app.request(`/api/v1/assets/${encodeURIComponent(assetId)}/references/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectIds: [projectId] }),
    });

    expect(refresh.status).toBe(200);
    expect(await refresh.json()).toEqual({
      assetId,
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
        resultEntityId: assetId,
        forced: false,
        accepted: true,
      },
    });
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
        forced: false,
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
        forced: false,
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
        forced: false,
        accepted: true,
        resultEntityId: "task-image",
      },
    });

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
        forced: false,
        accepted: false,
        error: expect.stringContaining("Custom action output already exists with different checkpoint content"),
      },
    });

    const bytes = await app.request("/assets/projects/project-custom/custom/task-rerun.png");
    expect(bytes.status).toBe(200);
    expect(await bytes.text()).toBe("first-checkpoint");
  });

  it("ignores legacy local metadata db.json instead of making JSON authoritative", async () => {
    await writeFile(
      join(dataDir, "db.json"),
      JSON.stringify({
        projects: [
          {
            id: "legacy-project",
            ownerId: "local-user",
            name: "Legacy Project",
            description: "from db.json",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            assets: [],
          },
        ],
        sessions: [
          {
            id: "legacy-session",
            projectId: "legacy-project",
            title: "Legacy Session",
            type: "runtime",
            runtimeId: "desktop-local",
            agentId: "codex-acp",
            createdAt: "2026-01-01T00:00:01.000Z",
            updatedAt: "2026-01-01T00:00:01.000Z",
          },
        ],
        sessionMessages: [
          {
            session_id: "legacy-session",
            id: "legacy-message",
            sender_kind: "agent",
            sender_id: "local-agent",
            turn_id: "turn-legacy",
            events: [{ type: "text", text: "legacy transcript" }],
            created_at: 1_767_225_601,
          },
        ],
      }),
      "utf8",
    );

    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const listed = await app.request("/api/projects");
    expect(await listed.json()).toEqual([]);

    const sessions = await app.request("/api/v1/sessions?projectId=legacy-project");
    expect(await sessions.json()).toEqual({ sessions: [] });

    const renamed = await app.request("/api/projects/legacy-project", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "SQLite Project" }),
    });
    expect(renamed.status).toBe(404);
  });

  it("persists local provider accounts in SQLite without creating legacy db.json", async () => {
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
    await expect(stat(join(dataDir, "db.json"))).rejects.toMatchObject({ code: "ENOENT" });

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
        forced: false,
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
      forced: false,
      accepted: true,
    });

    const missing = await app.request("/api/v1/model-providers/missing-provider", { method: "DELETE" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Provider account not found",
      mutation: {
        operation: "provider_account_delete",
        entity: { kind: "provider-account", id: "missing-provider" },
        forced: false,
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
        forced: false,
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

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const providers = await reopened.request("/api/v1/model-providers");
    expect(await providers.json()).toEqual({
      providers: savedJson.providers,
      readToken: expect.stringMatching(PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE),
    });

    const catalog = await reopened.request("/api/v1/models/catalog");
    const catalogJson = (await catalog.json()) as {
      models: Array<{
        model: { id: string };
        tier: string;
        selectedRoute?: { providerId?: string; upstreamId?: string };
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
      tier: "configured-provider",
      candidateProviders: ["official"],
      missingCredentials: ["apiKey"],
    });
  });

  it("does not expose provider accounts from legacy db.json", async () => {
    await writeFile(
      join(dataDir, "db.json"),
      JSON.stringify({
        providerAccounts: [
          {
            userId: "local-user",
            providerId: "official",
            upstreamId: "google",
            region: "global",
            enabled: true,
            priority: 20,
          },
          {
            userId: "local-user",
            providerId: "official",
            region: "global",
            enabled: true,
            priority: 15,
          },
          {
            userId: "local-user",
            providerId: "official",
            upstreamId: "google-agent-platform",
            region: "global",
            enabled: true,
            priority: 25,
            credentials: { vertexCredentials: "{}" },
          },
        ],
      }),
      "utf8",
    );

    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const response = await app.request("/api/v1/model-providers");
    const body = (await response.json()) as { providers: Array<Record<string, unknown>> };

    expect(body.providers).toEqual([]);
  });

  it("ignores legacy provider accounts when SQLite already exists", async () => {
    const bootstrap = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await bootstrap.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Existing SQLite" }),
    });
    expect(created.status).toBe(201);
    await expect(stat(join(dataDir, "local.sqlite"))).resolves.toMatchObject({ mode: expect.any(Number) });

    await writeFile(
      join(dataDir, "db.json"),
      JSON.stringify({
        providerAccounts: [
          {
            id: "legacy-openai-account",
            userId: "local-user",
            providerId: "official",
            upstreamId: "openai",
            region: "global",
            enabled: true,
            credentials: { apiKey: "sk-legacy-openai" },
          },
        ],
      }),
      "utf8",
    );

    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const listed = await app.request("/api/v1/model-providers");
    const listedJson = (await listed.json()) as { providers: Array<Record<string, unknown>> };
    expect(listedJson.providers).toEqual([]);

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select count(*) as count from provider_accounts").get()).toEqual({ count: 0 });
      expect(sqlite.prepare("select id from local_migration where id = 'provider-accounts-sqlite-v1'").get()).toBeUndefined();
    } finally {
      sqlite.close();
    }
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
        forced: false,
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
      headers: { "content-type": "application/json" },
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

  it("tests OAuth-backed provider configs against only their own authorization", async () => {
    const oauth = {
      dreamina: {
        start: vi.fn(async () => ({
          verificationUri: "https://jimeng.jianying.com/device",
          userCode: "AAAA-BBBB",
          deviceCode: "device-code-primary",
          expiresAt: "2026-06-26T03:00:00.000Z",
          intervalSeconds: 5,
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
      modelId: "seedance-2-text",
      message: "Dreamina configuration is ready for Seedance 2.0 (Text).",
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
    expect(await secondary.json()).toEqual({
      ok: false,
      providerId: "jimeng",
      upstreamId: "jimeng",
      modelId: "seedance-2-text",
      mutation: providerModelTestMutation("jimeng", "seedance-2-text"),
      missingOAuth: ["dreamina"],
      message: "Dreamina needs authorization before testing Seedance 2.0 (Text).",
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
        forced: false,
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
        forced: false,
        accepted: true,
      },
    });
    const providers = await app.request("/api/v1/model-providers");
    const providersJson = (await providers.json()) as { providers: Array<{ id?: string }> };
    expect(providersJson.providers.map((provider) => provider.id)).toEqual(["replicate-secondary"]);
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
        forced: false,
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
        forced: false,
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
      accountId: "jimeng-primary",
      status: "pending",
      mutation: {
        operation: "provider_oauth_start",
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
        resultEntityId: "dreamina:jimeng-primary",
        forced: false,
        accepted: true,
      },
    });

    const missingDeviceCode = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-missing" }),
    });
    expect(missingDeviceCode.status).toBe(400);
    expect(await missingDeviceCode.json()).toEqual({
      error: "deviceCode is required",
      mutation: {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-missing" },
        forced: false,
        accepted: false,
        error: "deviceCode is required",
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
      accountId: "jimeng-primary",
      status: "authorized",
      mutation: {
        operation: "provider_oauth_complete",
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
        resultEntityId: "dreamina:jimeng-primary",
        forced: false,
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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
        resultEntityId: "dreamina:jimeng-primary",
        forced: false,
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
    const pending = listedPendingJson.providers.find((provider) =>
      provider.providerId === "dreamina" && provider.accountId === "jimeng-primary"
    );
    expect(pending?.readToken).toMatch(PROVIDER_OAUTH_RECEIPT_READ_TOKEN_RE);

    const missingDelete = await app.request("/api/v1/provider-oauth/dreamina?accountId=jimeng-primary", {
      method: "DELETE",
      headers: { "x-clash-client-type": "agent" },
    });
    expect(missingDelete.status).toBe(409);
    expect(await missingDelete.json()).toMatchObject({
      mutation: {
        operation: "provider_oauth_delete",
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
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
    const authorized = listedAuthorizedJson.providers.find((provider) =>
      provider.providerId === "dreamina" && provider.accountId === "jimeng-primary"
    );
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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
        expectedReadToken: authorized!.readToken,
        beforeReadToken: baseReadToken(authorized!.readToken!),
        resultEntityId: "dreamina:jimeng-primary",
        forced: false,
        accepted: true,
      },
    });
    const audit = await app.request("/api/v1/mutation-audit?operation=provider_oauth_delete&entityId=dreamina%3Ajimeng-primary");
    expect(audit.status).toBe(200);
    const auditJson = await audit.json() as { records: Array<any> };
    expect(auditJson.records).toHaveLength(1);
    expect(auditJson.records[0]).toMatchObject({
      operation: "provider_oauth_delete",
      entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
        forced: false,
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
    const pending = listedPendingJson.providers.find((provider) =>
      provider.providerId === "dreamina" && provider.accountId === "jimeng-primary"
    );
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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
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
      entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
      expectedReadToken: pending!.readToken,
      beforeReadToken: baseReadToken(pending!.readToken!),
      afterReadToken: acceptedStartJson.readToken,
      accepted: true,
      resultEntityId: "dreamina:jimeng-primary",
    });
    expect(oauth.dreamina.start).toHaveBeenCalledTimes(1);

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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
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
    const pending = listedPendingJson.providers.find((provider) =>
      provider.providerId === "dreamina" && provider.accountId === "jimeng-primary"
    );
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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
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
      entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
      expectedReadToken: pending!.readToken,
      beforeReadToken: baseReadToken(pending!.readToken!),
      afterReadToken: acceptedCompleteJson.readToken,
      accepted: true,
      resultEntityId: "dreamina:jimeng-primary",
    });
    expect(oauth.dreamina.complete).toHaveBeenCalledTimes(1);

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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
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
        forced: false,
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
    } finally {
      sqlite.close();
    }

    const complete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deviceCode: "device-code-1" }),
    });
    expect(complete.status).toBe(200);
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
        forced: false,
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

  it("keeps provider OAuth device flows scoped to individual provider configs", async () => {
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
      accountId: "jimeng-primary",
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
      accountId: "jimeng-secondary",
      status: "pending",
      deviceCode: "device-code-secondary",
    });

    const primaryComplete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-primary", deviceCode: "device-code-primary" }),
    });
    expect(primaryComplete.status).toBe(200);
    expect(await primaryComplete.json()).toMatchObject({
      providerId: "dreamina",
      accountId: "jimeng-primary",
      accountLabel: "Primary Dreamina",
      status: "authorized",
      hasAccessToken: true,
    });

    const secondaryComplete = await app.request("/api/v1/provider-oauth/dreamina/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId: "jimeng-secondary", deviceCode: "device-code-secondary" }),
    });
    expect(secondaryComplete.status).toBe(200);
    expect(await secondaryComplete.json()).toMatchObject({
      providerId: "dreamina",
      accountId: "jimeng-secondary",
      accountLabel: "Secondary Dreamina",
      status: "authorized",
      hasAccessToken: true,
    });

    const listed = await app.request("/api/v1/provider-oauth");
    expect(await listed.json()).toEqual({
      providers: [
        expect.objectContaining({
          providerId: "dreamina",
          accountId: "jimeng-primary",
          accountLabel: "Primary Dreamina",
          status: "authorized",
        }),
        expect.objectContaining({
          providerId: "dreamina",
          accountId: "jimeng-secondary",
          accountLabel: "Secondary Dreamina",
          status: "authorized",
        }),
      ],
    });

    const providers = await app.request("/api/v1/model-providers");
    expect(await providers.json()).toEqual({
      providers: [
        expect.objectContaining({
          id: "jimeng-primary",
          label: "Primary Dreamina",
          providerId: "jimeng",
          availableOAuth: ["dreamina"],
        }),
        expect.objectContaining({
          id: "jimeng-secondary",
          label: "Secondary Dreamina",
          providerId: "jimeng",
          availableOAuth: ["dreamina"],
        }),
      ],
      readToken: expect.stringMatching(PROVIDER_ACCOUNTS_RECEIPT_READ_TOKEN_RE),
    });
  });

  it("records provider OAuth completion failures on the scoped account", async () => {
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
        entity: { kind: "provider-oauth", id: "dreamina:jimeng-primary" },
        resultEntityId: "dreamina:jimeng-primary",
        forced: false,
        accepted: true,
      },
    });

    const listed = await app.request("/api/v1/provider-oauth");
    expect(await listed.json()).toEqual({
      providers: [
        expect.objectContaining({
          providerId: "dreamina",
          accountId: "jimeng-primary",
          accountLabel: "Primary Dreamina",
          status: "error",
          error: "Dreamina device code expired",
          hasAccessToken: false,
        }),
      ],
    });
  });

  it("allows browser requests from the local web runtime", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const preflight = await app.request("/api/projects", {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1:3001",
        "access-control-request-method": "GET",
      },
    });
    expect(preflight.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3001");
    expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

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

  it("surfaces and starts the desktop local ACP runtime from an agent without exposing agent roles", async () => {
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
          return { session_id: "local-session-1" };
        },
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
        forced: false,
        accepted: true,
      },
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
      onReady: expect.any(Function),
      onError: expect.any(Function),
    }));

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
        forced: false,
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
        forced: false,
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
        forced: false,
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
      forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
        accepted: true,
        resultEntityId: "gemini",
      },
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
        forced: false,
        accepted: true,
        resultEntityId: "gemini",
      },
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
        forced: false,
        accepted: true,
        resultEntityId: "gemini",
      },
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
        forced: false,
        accepted: true,
        resultEntityId: "gemini",
      },
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
        forced: false,
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
    expect(body.error).toBe("No local agent found. Install or enable an agent in Settings > Runtimes, then retry.");
    expect(body.session_id).toEqual(expect.any(String));
    expect(body.mutation).toEqual({
      operation: "runtime_session_create",
      entity: { kind: "session", id: body.session_id },
      resultEntityId: body.session_id,
      forced: false,
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
        forced: false,
        accepted: true,
      },
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
        accepted: true,
      },
    });

    const listed = await app.request("/api/v1/sessions?projectId=project-attach-fail");
    expect(await listed.json()).toMatchObject({
      sessions: [{ id: sessionId, status: "error" }],
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

    await expect(stat(join(dataDir, "db.json"))).rejects.toMatchObject({ code: "ENOENT" });
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

    const created = await app.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ prompt: "A local-first video project" }),
      headers: { "content-type": "application/json" },
    });
    expect(created.status).toBe(200);
    const createdJson = (await created.json()) as { id: string; readToken?: string; mutation?: any };
    const { id } = createdJson;
    expect(createdJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);
    expect(createdJson.mutation).toEqual({
      operation: "project_create",
      entity: { kind: "project", id },
      afterReadToken: createdJson.readToken,
      resultEntityId: id,
      forced: false,
      accepted: true,
    });

    const listed = await app.request("/api/projects");
    const projects = (await listed.json()) as Array<{
      id: string;
      name: string;
      description: string;
      assets: unknown[];
      readToken?: string;
    }>;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id,
      ownerId: "local-user",
      name: "A local-first video ...",
      description: "A local-first video project",
      assets: [],
    });
    expect(projects[0].readToken).toBe(createdJson.readToken);

    const renamed = await app.request(`/api/projects/${id}`, {
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
      forced: false,
      accepted: true,
    });

    const loaded = await app.request(`/api/projects/${id}`);
    expect(await loaded.json()).toMatchObject({ id, name: "Renamed", readToken: renamedJson.readToken });

    const deleted = await app.request(`/api/projects/${id}`, { method: "DELETE" });
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
      forced: false,
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
      reason: "legacy project soft delete",
    });
    expect(JSON.stringify(auditJson.records[0].mutation ?? {})).not.toContain("receipt");
    expect(auditJson.records[0].mutation.expectedReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.beforeReadToken).toBeUndefined();
    expect(auditJson.records[0].mutation.afterReadToken).toBeUndefined();
    expect(await (await app.request("/api/projects")).json()).toEqual([]);
  });

  it("requires agent project writes to carry a fresh read proof", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      body: JSON.stringify({ name: "Read Proof Project" }),
      headers: { "content-type": "application/json" },
    });
    const createdJson = await created.json() as { id: string; readToken: string };

    const missing = await app.request(`/api/projects/${createdJson.id}`, {
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
        forced: false,
        accepted: false,
        error: expect.stringContaining("Missing project update read proof for agent"),
      },
    });

    const unchanged = await app.request(`/api/v1/projects/${createdJson.id}`);
    expect(await unchanged.json()).toMatchObject({
      name: "Read Proof Project",
      readToken: createdJson.readToken,
    });

    const humanRename = await app.request(`/api/projects/${createdJson.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Concurrent human rename" }),
      headers: { "content-type": "application/json" },
    });
    const humanRenameJson = await humanRename.json() as { readToken: string };
    expect(humanRenameJson.readToken).not.toBe(createdJson.readToken);

    const stale = await app.request(`/api/projects/${createdJson.id}`, {
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
        forced: false,
        accepted: false,
        error: expect.stringContaining("Stale project update rejected"),
      },
    });

    const fresh = await app.request(`/api/projects/${createdJson.id}`);
    const freshJson = await fresh.json() as { readToken: string };
    const accepted = await app.request(`/api/projects/${createdJson.id}`, {
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
      forced: false,
      accepted: true,
    });

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
        forced: false,
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
      forced: false,
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

    const syntheticCasOnly = await app.request(`/api/projects/${createdJson.id}`, {
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
        forced: false,
        accepted: false,
      },
    });

    const read = await app.request(`/api/projects/${createdJson.id}`);
    const readJson = await read.json() as { readToken: string };
    expect(readJson.readToken).toMatch(PROJECT_RECEIPT_READ_TOKEN_RE);

    const accepted = await app.request(`/api/projects/${createdJson.id}`, {
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
      forced: false,
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
      forced: false,
      accepted: true,
    });

    const statusRes = await app.request(`/api/v1/projects/${project.id}/status`);

    expect(statusRes.status).toBe(200);
    const status = (await statusRes.json()) as any;
    expect(status).toMatchObject({
      projectId: project.id,
      source: "explicit",
      mode: "local-only",
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
          required: ["canvas", "room", "asset-metadata"],
          missing: ["canvas", "room", "asset-metadata"],
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
      },
      clashHome: clashRoot,
      localApiDataDir: dataDir,
      localSqlitePath: join(dataDir, "local.sqlite"),
      roots: {
        drafts: join(clashRoot, "projects", project.id, "drafts"),
        projections: join(clashRoot, "projects", project.id, "projections"),
        assetLinks: join(clashRoot, "projects", project.id, "assets", "links"),
        runtime: join(clashRoot, "projects", project.id, "runtime"),
      },
      loro: {
        snapshotPath: join(dataDir, "projects", encodeURIComponent(project.id), "loro", "snapshot.bin"),
      },
    });
    expect(status.runtimeRoot).toBe(status.roots.runtime);
    expect(status.editablePaths).toContain(status.roots.projections);
    expect(status.protectedPaths).toContain(status.loro.snapshotPath);
    expect(status.protectedPaths).toContain(status.roots.runtime);
    expect(status.storage.workspace).toMatchObject({
      role: "agent-draft-and-projection-workspace",
      root: status.projectWorkspaceRoot,
      ownsCanonicalSnapshot: false,
      ownsCanonicalMetadata: false,
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
      canvas: {
        kind: "loro",
        snapshotPath: status.loro.snapshotPath,
        updatesLogPath: status.loro.updatesLogPath,
        agentWritable: false,
      },
      contentBlobs: {
        textRevisions: {
          kind: "content-addressed-files",
          path: join(dataDir, "text-revision-blobs"),
          mediaType: "text/markdown",
          immutable: true,
          agentWritable: false,
        },
        timelineRevisions: {
          kind: "content-addressed-files",
          path: join(dataDir, "timeline-revision-blobs"),
          mediaType: "application/yaml",
          immutable: true,
          agentWritable: false,
        },
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
      mode: "cloud-sync",
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
          required: ["canvas", "room", "asset-metadata"],
          missing: ["canvas", "room", "asset-metadata"],
        },
        actions: {
          openInWeb: {
            allowed: false,
            reason: "cloud-sync-not-ready",
            requirements: ["canvas", "room", "asset-metadata"],
          },
          enableSync: {
            allowed: false,
            reason: "already-cloud-connected",
            requirements: [],
          },
          shareProject: {
            allowed: false,
            reason: "cloud-sync-not-ready",
            requirements: ["canvas", "room", "asset-metadata"],
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
      forced: false,
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
      forced: false,
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
        forced: false,
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
        forced: false,
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
        forced: false,
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
        INSERT INTO room_message (id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("purge-room-message", project.id, "agent", "agent-1", "local-user", "[]", "purge me", now);
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
      body: JSON.stringify({ confirm: "purge", force: true }),
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
      body: JSON.stringify({ force: true }),
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
    expect(Date.parse(delayedJson.purgeAfter)).toBeGreaterThan(Date.parse(deletedJson.deletedAt));

    const purged = await app.request(`/api/v1/projects/${project.id}/purge`, {
      method: "DELETE",
      headers: {
        "content-type": "application/json",
        "x-clash-client-type": "agent",
        "x-clash-if-match": deletedJson.readToken,
        "x-clash-force": "true",
      },
      body: JSON.stringify({ confirm: "purge" }),
    });
    expect(purged.status).toBe(200);
    expect(await purged.json()).toMatchObject({
      purged: true,
      recoverable: false,
      id: project.id,
      deletedAt: deletedJson.deletedAt,
      purgeAfter: delayedJson.purgeAfter,
      replicaDeleted: true,
      removed: {
        projects: 1,
        projectPreviewAssets: 1,
        sessions: 1,
        sessionMessages: 1,
        roomMessages: 1,
        assetRowsUnlinked: 1,
        assetRefs: 1,
        assetNodeRefs: 1,
      },
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        expectedReadToken: deletedJson.readToken,
        beforeReadToken: baseReadToken(deletedJson.readToken),
        resultEntityId: project.id,
        forced: true,
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
      expect(check.prepare("select count(*) as count from room_message where project_id = ?").get(project.id)).toEqual({ count: 0 });
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
        forced: boolean;
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
      forced: true,
      accepted: true,
      actorClientType: "agent",
      reason: "project purge",
      mutation: {
        operation: "project_purge",
        entity: { kind: "project", id: project.id },
        forced: true,
        accepted: true,
        resultEntityId: project.id,
      },
    });
    expect(JSON.stringify(auditJson.records[0].mutation)).not.toContain("receipt");
    expect(auditJson.records[0].mutation).not.toHaveProperty("expectedReadToken");
    expect(auditJson.records[0].mutation).not.toHaveProperty("beforeReadToken");
  });

  it("persists local project room messages in SQLite", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Project" }),
    });
    const project = await created.json() as { id: string };

    const posted = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-message-1",
        text: "hello local room",
        sender_kind: "agent",
        sender_id: "local-master-clash",
        mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
      }),
    });
    expect(posted.status).toBe(200);
    expect(await posted.json()).toMatchObject({
      id: "room-message-1",
      project_id: project.id,
      sender_kind: "agent",
      sender_id: "local-master-clash",
      sender_user_id: "local-user",
      text: "hello local room",
      mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
      sync: {
        mode: "local-only",
        remote_room: { enabled: false, status: "disabled" },
      },
      mutation: {
        operation: "room_message_create",
        entity: { kind: "room-message", id: "room-message-1" },
        resultEntityId: "room-message-1",
        forced: false,
        accepted: true,
      },
    });

    const listed = await app.request(`/api/v1/projects/${project.id}/room/messages`);
    expect(await listed.json()).toMatchObject({
      sync: {
        mode: "local-only",
        remote_room: { enabled: false, status: "disabled" },
      },
      messages: [
        {
          id: "room-message-1",
          sender_kind: "agent",
          sender_id: "local-master-clash",
          sender_user_id: "local-user",
          text: "hello local room",
        },
      ],
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const persisted = await reopened.request(`/api/v1/projects/${project.id}/room/messages`);
    expect(await persisted.json()).toMatchObject({
      messages: [{ id: "room-message-1", text: "hello local room" }],
    });

    const sqlite = openSqlite();
    try {
      expect(sqlite.prepare("select project_id, sender_kind, sender_id, text from room_message").get()).toEqual({
        project_id: project.id,
        sender_kind: "agent",
        sender_id: "local-master-clash",
        text: "hello local room",
      });
    } finally {
      sqlite.close();
    }
  });

  it("reports explicit room sync as pending in cloud-sync mode", async () => {
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Project" }),
    });
    const project = await created.json() as { id: string };

    const listed = await app.request(`/api/v1/projects/${project.id}/room/messages`);
    expect(await listed.json()).toMatchObject({
      sync: {
        mode: "cloud-sync",
        remote_room: {
          enabled: true,
          status: "pending",
        },
      },
      messages: [],
    });
  });

  it("checks project existence before room sync remote admission", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const synced = await app.request("/api/v1/projects/missing-project/room/sync", {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    expect(synced.status).toBe(404);
    expect(await synced.json()).toMatchObject({
      error: "not found",
      mutation: {
        operation: "room_sync",
        entity: { kind: "room", id: "missing-project" },
        forced: false,
        accepted: false,
        error: "not found",
      },
    });
  });

  it("returns explicit room sync admission when cloud sync is not configured", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Local Room Project" }),
    });
    const project = await created.json() as { id: string };

    const synced = await app.request(`/api/v1/projects/${project.id}/room/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });

    expect(synced.status).toBe(409);
    expect(await synced.json()).toMatchObject({
      error: "remote room sync is not configured",
      admission: {
        allowed: false,
        reason: "remote-room-not-configured",
        requirements: ["enable-sync"],
      },
      sync: {
        mode: "local-only",
        remote_room: {
          enabled: false,
          status: "disabled",
          error: "remote room sync is not configured",
        },
      },
      mutation: {
        operation: "room_sync",
        entity: { kind: "room", id: project.id },
        forced: false,
        accepted: false,
        error: "remote room sync is not configured",
      },
    });
  });

  it("explicitly mirrors local and remote room messages without a blind overwrite", async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({
          messages: [
            {
              id: "remote-room-1",
              project_id: "pending-project",
              sender_kind: "user",
              sender_id: "remote-user",
              sender_user_id: "remote-user",
              mentions: [{ user_id: "local-user" }],
              text: "remote only",
              at: 900,
            },
          ],
        }), { headers: { "content-type": "application/json" } });
      }
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected remote room request", { status: 500 });
    });
    const syncConfig = createLocalSyncConfigStore({
      dataDir,
      env: {
        CLASH_REMOTE_LORO_URL: "https://api.example.com",
        CLASH_REMOTE_LORO_TOKEN: "token-1",
      },
      fetch: fetchMock,
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncConfig });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Sync Project" }),
    });
    const project = await created.json() as { id: string };

    const posted = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "local-room-1",
        text: "local only",
        mentions: [{ user_id: "remote-user" }],
      }),
    });
    expect(posted.status).toBe(200);

    const synced = await app.request(`/api/v1/projects/${project.id}/room/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(synced.status).toBe(200);
    expect(await synced.json()).toMatchObject({
      sync: {
        mode: "cloud-sync",
        remote_room: { enabled: true, status: "mirrored" },
      },
      plan: {
        exportedIds: ["local-room-1"],
        importedIds: ["remote-room-1"],
        matchedIds: [],
        conflicts: [],
      },
      mutation: {
        operation: "room_sync",
        entity: { kind: "room", id: project.id },
        forced: false,
        accepted: true,
        resultEntityId: project.id,
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/v1/projects/${encodeURIComponent(project.id)}/room/messages`,
      expect.objectContaining({ method: "GET" }),
    );
    const remotePost = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(remotePost).toBeTruthy();
    expect(remotePost?.[0]).toBe(
      `https://api.example.com/api/v1/projects/${encodeURIComponent(project.id)}/room/messages`,
    );
    expect(JSON.parse(String(remotePost?.[1]?.body))).toEqual({
      id: "local-room-1",
      sender_kind: "user",
      sender_id: "local-user",
      sender_user_id: "local-user",
      text: "local only",
      mentions: [{ user_id: "remote-user" }],
    });
    const remotePostHeaders = remotePost?.[1]?.headers as Headers;
    expect(remotePostHeaders.get("authorization")).toBe("Bearer token-1");

    const listed = await app.request(`/api/v1/projects/${project.id}/room/messages`);
    expect(await listed.json()).toMatchObject({
      sync: {
        mode: "cloud-sync",
        remote_room: { enabled: true, status: "pending" },
      },
      messages: expect.arrayContaining([
        expect.objectContaining({ id: "local-room-1", text: "local only" }),
        expect.objectContaining({
          id: "remote-room-1",
          sender_id: "remote-user",
          sender_user_id: "remote-user",
          text: "remote only",
        }),
      ]),
    });
  });

  it("rejects explicit room sync conflicts without overwriting local rows", async () => {
    const fetchMock = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response(JSON.stringify({
          messages: [
            {
              id: "room-conflict",
              project_id: "ignored-project",
              sender_kind: "user",
              sender_id: "remote-user",
              sender_user_id: "remote-user",
              mentions: [],
              text: "remote text",
              at: 1000,
            },
          ],
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("unexpected remote room write", { status: 500 });
    });
    const syncConfig = createLocalSyncConfigStore({
      dataDir,
      env: {
        CLASH_REMOTE_LORO_URL: "https://api.example.com",
        CLASH_REMOTE_LORO_TOKEN: "token-1",
      },
      fetch: fetchMock,
    });
    const app = createLocalApiApp({ dataDir, userId: "local-user", syncConfig });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Conflict Project" }),
    });
    const project = await created.json() as { id: string };

    const posted = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-conflict",
        text: "local text",
      }),
    });
    expect(posted.status).toBe(200);

    const synced = await app.request(`/api/v1/projects/${project.id}/room/sync`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    expect(synced.status).toBe(409);
    expect(await synced.json()).toMatchObject({
      error: "room sync conflict",
      sync: {
        mode: "cloud-sync",
        remote_room: {
          enabled: true,
          status: "failed",
          error: "room sync conflict",
        },
      },
      plan: {
        exportedIds: [],
        importedIds: [],
        matchedIds: [],
        conflicts: [{ id: "room-conflict", reason: "content-mismatch" }],
      },
      mutation: {
        operation: "room_sync",
        entity: { kind: "room", id: project.id },
        forced: false,
        accepted: false,
        error: "room sync conflict",
      },
    });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);

    const listed = await app.request(`/api/v1/projects/${project.id}/room/messages`);
    expect(await listed.json()).toMatchObject({
      messages: [{ id: "room-conflict", text: "local text" }],
    });
  });

  it("paginates local room messages with a stable same-second cursor", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Project" }),
    });
    const project = await created.json() as { id: string };

    const sqlite = openSqlite();
    try {
      const insert = sqlite.prepare(`
        INSERT INTO room_message
          (id, project_id, sender_kind, sender_id, sender_user_id, mentions_json, text, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run("room-a", project.id, "user", "local-user", "local-user", "[]", "first", 1000);
      insert.run("room-b", project.id, "user", "local-user", "local-user", "[]", "second", 1000);
    } finally {
      sqlite.close();
    }

    const firstPage = await app.request(`/api/v1/projects/${project.id}/room/messages?limit=1`);
    expect(await firstPage.json()).toMatchObject({
      messages: [{ id: "room-b", text: "second" }],
    });

    const secondPage = await app.request(`/api/v1/projects/${project.id}/room/messages?limit=1&before=room-b`);
    expect(await secondPage.json()).toMatchObject({
      messages: [{ id: "room-a", text: "first" }],
    });
  });

  it("dispatches local room agent-member-only mentions", async () => {
    const pushRoomMention = vi.fn(async () => true);
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      localAcp: { pushRoomMention } as any,
    });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Project" }),
    });
    const project = await created.json() as { id: string };

    const posted = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-mention-1",
        text: "ping",
        mentions: [{ agent_member_id: "local-master-clash" }],
      }),
    });

    expect(posted.status).toBe(200);
    expect(await posted.json()).toMatchObject({
      id: "room-mention-1",
      mentions: [{ agent_member_id: "local-master-clash" }],
    });
    expect(pushRoomMention).toHaveBeenCalledWith(project.id, "local-master-clash", expect.objectContaining({
      message_id: "room-mention-1",
      from_kind: "user",
      from_id: "local-user",
      from_user_id: "local-user",
      text: "ping",
    }));
  });

  it("rejects duplicate local room message ids across projects", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const firstProjectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "First Room Project" }),
    });
    const firstProject = await firstProjectResponse.json() as { id: string };
    const secondProjectResponse = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Second Room Project" }),
    });
    const secondProject = await secondProjectResponse.json() as { id: string };

    const firstPost = await app.request(`/api/v1/projects/${firstProject.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-shared-id",
        text: "first",
      }),
    });
    expect(firstPost.status).toBe(200);

    const duplicatePost = await app.request(`/api/v1/projects/${secondProject.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-shared-id",
        text: "second",
      }),
    });
    expect(duplicatePost.status).toBe(409);
    expect(await duplicatePost.json()).toEqual({
      error: "room message id already exists",
      mutation: {
        operation: "room_message_create",
        entity: { kind: "room-message", id: "room-shared-id" },
        forced: false,
        accepted: false,
        error: "room message id already exists",
      },
    });
  });

  it("rejects same-project room message id reuse with different content", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Conflict Project" }),
    });
    const project = await created.json() as { id: string };

    const firstPost = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-local-conflict",
        text: "first",
      }),
    });
    expect(firstPost.status).toBe(200);

    const duplicatePost = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-local-conflict",
        text: "second",
      }),
    });
    expect(duplicatePost.status).toBe(409);
    expect(await duplicatePost.json()).toEqual({
      error: "room message id already exists with different content",
      mutation: {
        operation: "room_message_create",
        entity: { kind: "room-message", id: "room-local-conflict" },
        forced: false,
        accepted: false,
        error: "room message id already exists with different content",
      },
    });

    const listed = await app.request(`/api/v1/projects/${project.id}/room/messages`);
    expect(await listed.json()).toMatchObject({
      messages: [{ id: "room-local-conflict", text: "first" }],
    });
  });

  it("rejects local room messages from unknown agent members", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Project" }),
    });
    const project = await created.json() as { id: string };

    const posted = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "room-spoofed-agent",
        text: "spoofed",
        sender_kind: "agent",
        sender_id: "local-missing-agent",
      }),
    });

    expect(posted.status).toBe(403);
    expect(await posted.json()).toEqual({
      error: "sender_id is not an agent_member you own",
      mutation: {
        operation: "room_message_create",
        entity: { kind: "room-message", id: "room-spoofed-agent" },
        forced: false,
        accepted: false,
        error: "sender_id is not an agent_member you own",
      },
    });
  });

  it("records rejected mutation envelopes for invalid local room message writes", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });
    const created = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Room Project" }),
    });
    const project = await created.json() as { id: string };

    const missingText = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "room-empty-text", text: "   " }),
    });

    expect(missingText.status).toBe(400);
    expect(await missingText.json()).toEqual({
      error: "text required",
      mutation: {
        operation: "room_message_create",
        entity: { kind: "room-message", id: "room-empty-text" },
        forced: false,
        accepted: false,
        error: "text required",
      },
    });

    const missingSender = await app.request(`/api/v1/projects/${project.id}/room/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "room-missing-agent", text: "ping", sender_kind: "agent" }),
    });

    expect(missingSender.status).toBe(400);
    expect(await missingSender.json()).toEqual({
      error: "sender_id required for agent sender",
      mutation: {
        operation: "room_message_create",
        entity: { kind: "room-message", id: "room-missing-agent" },
        forced: false,
        accepted: false,
        error: "sender_id required for agent sender",
      },
    });
  });

  it("returns local project preview assets for the desktop project grid", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/projects", {
      method: "POST",
      body: JSON.stringify({ prompt: "Desktop grid previews" }),
      headers: { "content-type": "application/json" },
    });
    const { id: projectId } = (await created.json()) as { id: string };

    for (let index = 1; index <= 4; index++) {
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

    const listed = await app.request("/api/projects");
    const projects = (await listed.json()) as Array<{
      id: string;
      assets: Array<{ url: string; type: string; storageKey: string }>;
    }>;
    expect(projects[0].id).toBe(projectId);
    expect(projects[0].assets).toHaveLength(4);
    expect(new Set(projects[0].assets.map((asset) => asset.url))).toEqual(
      new Set([
        "/assets/uploads/preview-1.png",
        "/assets/uploads/preview-2.png",
        "/assets/uploads/preview-3.png",
        "/assets/uploads/preview-4.png",
      ]),
    );

    const loaded = await app.request(`/api/projects/${projectId}`);
    const project = (await loaded.json()) as { assets: unknown[] };
    expect(project.assets).toHaveLength(4);
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
        forced: false,
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
      forced: false,
      accepted: true,
      resultEntityId: storageKey,
    });

    const sign = await app.request(`/assets/sign?key=${encodeURIComponent(storageKey)}`);
    expect(await sign.json()).toMatchObject({ url: `http://localhost/assets/${storageKey}` });

    const served = await app.request(`/assets/${storageKey}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("text/plain");
    expect(await served.text()).toBe("hello");
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
          forced: false,
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
          forced: false,
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
