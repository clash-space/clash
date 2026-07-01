import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalApiApp, type LocalAcpAgentServersConfig } from "./app";
import { createLocalAudioConfigStore } from "./audio-config";
import { createMockFalQueueService } from "./fal-mock";
import { createLocalSyncConfigStore } from "./sync-config";

let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "clash-local-api-"));
});

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

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
    });
    expect(builtinInstall).toHaveBeenCalledWith({ model: "iic/SenseVoiceSmall", pythonBinary: "python3" });
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
    expect(await res.json()).toEqual({ text: "你好 Clash" });
    expect(builtinTranscribe).toHaveBeenCalledTimes(1);
  });

  it("stores local settings variables without exposing secret values", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const created = await app.request("/api/settings/variables", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "OPENAI_API_KEY", value: "sk-local" }),
    });
    expect(created.status).toBe(200);
    const createdJson = (await created.json()) as { id: string; key: string; value?: string };
    expect(createdJson).toMatchObject({ key: "OPENAI_API_KEY" });
    expect(createdJson.value).toBeUndefined();

    const listed = await app.request("/api/settings/variables");
    expect(await listed.json()).toEqual([
      expect.objectContaining({
        id: createdJson.id,
        key: "OPENAI_API_KEY",
      }),
    ]);

    const removed = await app.request(`/api/settings/variables/${createdJson.id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    const afterDelete = await app.request("/api/settings/variables");
    expect(await afterDelete.json()).toEqual([]);
  });

  it("serves CLI-compatible v1 variable endpoints from the local variable store", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const set = await app.request("/api/v1/vars/FAL_API_KEY", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "fal-local-key" }),
    });
    expect(set.status).toBe(200);
    expect(await set.json()).toEqual({ ok: true, key: "FAL_API_KEY" });

    const listed = await app.request("/api/v1/vars");
    const listedJson = (await listed.json()) as { variables: Array<{ key: string; createdAt: number | null }> };
    expect(listedJson.variables).toEqual([
      expect.objectContaining({
        key: "FAL_API_KEY",
        createdAt: expect.any(Number),
      }),
    ]);

    const settingsListed = await app.request("/api/settings/variables");
    expect(await settingsListed.json()).toEqual([
      expect.objectContaining({ key: "FAL_API_KEY" }),
    ]);

    const deleted = await app.request("/api/v1/vars/FAL_API_KEY", { method: "DELETE" });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({ ok: true, key: "FAL_API_KEY" });

    const afterDelete = await app.request("/api/v1/vars");
    expect(await afterDelete.json()).toEqual({ variables: [] });
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
    expect(await providers.json()).toEqual(savedJson);

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
    expect(await providers.json()).toEqual(secondJson);
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
      message: "Replicate configuration is ready for Nano Banana 2.",
    });
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
            upstreamId: "google",
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
          upstreamId: "google",
          region: "global",
          enabled: true,
        },
        modelId: "gemini-flash-image-2",
      }),
    });

    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({
      ok: true,
      providerId: "official",
      upstreamId: "google",
      region: "global",
      modelId: "gemini-flash-image-2",
      message: "Google configuration is ready for Gemini Flash Image 2.",
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

    expect(deleted.status).toBe(204);
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
    });
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
    expect(await created.json()).toEqual({ session_id: "local-session-1" });
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
    expect(deleted.status).toBe(204);

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
          const rawDb = JSON.parse(await readFile(join(dataDir, "db.json"), "utf8")) as {
            sessions?: Array<{ id: string; projectId: string; status?: string }>;
          };
          sawPrecreatedSession = Boolean(
            params.sessionId &&
            rawDb.sessions?.some((session) =>
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
    expect(await created.json()).toEqual({ session_id: "local-session-agent" });
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
    });
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
    expect(await updated.json()).toEqual({ error: "Authenticate Devin before enabling." });
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
    expect(await created.json()).toEqual({ session_id: "local-session-agent" });
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
    expect(await created.text()).toBe(
      "No local agent found. Install or enable an agent in Settings > Runtimes, then retry.",
    );
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
    expect(await attach.json()).toEqual({ session_id: "local-session-existing" });
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
    const rawDb = await readFile(join(dataDir, "db.json"), "utf8");

    expect(() => JSON.parse(rawDb)).not.toThrow();
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
    const { id } = (await created.json()) as { id: string };

    const listed = await app.request("/api/projects");
    const projects = (await listed.json()) as Array<{ id: string; name: string; description: string; assets: unknown[] }>;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id,
      ownerId: "local-user",
      name: "A local-first video ...",
      description: "A local-first video project",
      assets: [],
    });

    const renamed = await app.request(`/api/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: "Renamed" }),
      headers: { "content-type": "application/json" },
    });
    expect(renamed.status).toBe(200);

    const loaded = await app.request(`/api/projects/${id}`);
    expect(await loaded.json()).toMatchObject({ id, name: "Renamed" });

    const deleted = await app.request(`/api/projects/${id}`, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect(await (await app.request("/api/projects")).json()).toEqual([]);
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
    expect(await deleted.json()).toEqual({ deleted: true });
  });

  it("persists local project room messages", async () => {
    const app = createLocalApiApp({ dataDir, userId: "local-user" });

    const first = await app.request("/api/v1/projects/project-room/room/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello local room",
        mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
      }),
    });
    expect(first.status).toBe(201);
    const firstJson = (await first.json()) as { id: string; type: string };
    expect(firstJson).toMatchObject({
      type: "room.message",
      project_id: "project-room",
      sender_kind: "user",
      sender_id: "local-user",
      sender_user_id: "local-user",
      mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
      text: "hello local room",
    });

    const listed = await app.request("/api/v1/projects/project-room/room/messages");
    expect(await listed.json()).toMatchObject({
      messages: [
        {
          id: firstJson.id,
          project_id: "project-room",
          sender_kind: "user",
          sender_id: "local-user",
          sender_user_id: "local-user",
          mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
          text: "hello local room",
        },
      ],
    });

    const reopened = createLocalApiApp({ dataDir, userId: "local-user" });
    const persisted = await reopened.request("/api/v1/projects/project-room/room/messages");
    expect(await persisted.json()).toMatchObject({
      messages: [{ id: firstJson.id, text: "hello local room" }],
    });
  });

  it("mirrors local project room messages to the configured cloud room API", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://cloud.example/api/v1/projects/project-room/room/messages" && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "remote-message-1" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      syncConfig: createLocalSyncConfigStore({
        dataDir,
        env: {
          CLASH_REMOTE_LORO_URL: "https://cloud.example/",
          CLASH_REMOTE_LORO_TOKEN: "clsh_room_secret",
        },
        fetch: fetchImpl,
      }),
    });

    const res = await app.request("/api/v1/projects/project-room/room/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello synced room",
        mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
      }),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      type: "room.message",
      text: "hello synced room",
      sync: {
        mode: "cloud-sync",
        remote_room: { enabled: true, status: "mirrored" },
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];
    expect(String(input)).toBe("https://cloud.example/api/v1/projects/project-room/room/messages");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer clsh_room_secret");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      id: expect.any(String),
      text: "hello synced room",
      mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
      sender_kind: "user",
      sender_id: "local-user",
    });
  });

  it("imports cloud room messages into the local room list when cloud sync is enabled", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url === "https://cloud.example/api/v1/projects/project-room/room/messages" && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          messages: [
            {
              id: "remote-web-message",
              project_id: "project-room",
              sender_kind: "user",
              sender_id: "web-user",
              sender_user_id: "web-user",
              mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
              text: "hello from web",
              at: 1_700_000_100,
            },
          ],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const app = createLocalApiApp({
      dataDir,
      userId: "local-user",
      syncConfig: createLocalSyncConfigStore({
        dataDir,
        env: {
          CLASH_REMOTE_LORO_URL: "https://cloud.example/",
          CLASH_REMOTE_LORO_TOKEN: "clsh_room_secret",
        },
        fetch: fetchImpl,
      }),
    });

    const listed = await app.request("/api/v1/projects/project-room/room/messages");

    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      sync: {
        mode: "cloud-sync",
        remote_room: { enabled: true, status: "imported" },
      },
      messages: [
        {
          id: "remote-web-message",
          project_id: "project-room",
          sender_kind: "user",
          sender_id: "web-user",
          sender_user_id: "web-user",
          mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
          text: "hello from web",
          at: 1_700_000_100,
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0];
    expect(String(input)).toBe("https://cloud.example/api/v1/projects/project-room/room/messages");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer clsh_room_secret");

    const offlineApp = createLocalApiApp({ dataDir, userId: "local-user", syncEnv: {} });
    const persisted = await offlineApp.request("/api/v1/projects/project-room/room/messages");
    expect(await persisted.json()).toMatchObject({
      messages: [{ id: "remote-web-message", text: "hello from web" }],
    });
  });

  it("dispatches local project room mentions to the local ACP adapter", async () => {
    const pushed: unknown[] = [];
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
        async pushRoomMention(projectId, agentMemberId, mention) {
          pushed.push({ projectId, agentMemberId, mention });
          return true;
        },
      },
    });

    const res = await app.request("/api/v1/projects/project-room/room/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: "hello local master-clash",
        mentions: [{ user_id: "local-user", agent_member_id: "local-master-clash" }],
      }),
    });
    expect(res.status).toBe(201);
    const message = (await res.json()) as { id: string };

    expect(pushed).toEqual([
      {
        projectId: "project-room",
        agentMemberId: "local-master-clash",
        mention: {
          message_id: message.id,
          from_kind: "user",
          from_id: "local-user",
          from_user_id: "local-user",
          text: "hello local master-clash",
        },
      },
    ]);
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
    const form = new FormData();
    form.append("file", new File(["hello"], "hello world.txt", { type: "text/plain" }));

    const upload = await app.request("/upload", { method: "POST", body: form });
    expect(upload.status).toBe(200);
    const { storageKey } = (await upload.json()) as { storageKey: string };
    expect(storageKey).toMatch(/^uploads\/.+-hello_world\.txt$/);

    const sign = await app.request(`/assets/sign?key=${encodeURIComponent(storageKey)}`);
    expect(await sign.json()).toMatchObject({ url: `http://localhost/assets/${storageKey}` });

    const served = await app.request(`/assets/${storageKey}`);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toContain("text/plain");
    expect(await served.text()).toBe("hello");
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
