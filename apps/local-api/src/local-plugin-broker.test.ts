import { describe, expect, it, vi } from "vitest";
import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
} from "@clash/shared-types";

import { createLocalExecutablePluginBroker } from "./local-plugin-broker";

const manifest = ExecutablePluginManifestSchema.parse({
  apiVersion: "clash.plugin/v1" as const,
  id: "broker-plugin",
  version: "1.0.0",
  name: "Broker Plugin",
  runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "handler.mjs" },
  exports: { cards: [], functions: [] },
  permissions: {
    secrets: ["provider:fal"],
    network: { domains: ["queue.fal.run"] },
    assets: ["read" as const],
    filesystem: { read: [], write: [] },
    externalWrites: true,
  },
  contractTests: [],
});

function context(invocationId = "invocation-1") {
  return {
    manifest,
    invocation: ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1" as const,
      invocationId,
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "broker-plugin",
        version: "1.0.0",
        exportId: "project",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-projector" as const,
      },
      input: { values: {}, references: [] },
      actor: { kind: "agent" as const, id: "agent-1" },
    }),
  };
}

describe("local executable plugin capability broker", () => {
  it("keeps provider credentials opaque and redeems them only inside an approved network fetch", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Key fal-super-secret");
      return new Response(JSON.stringify({ request_id: "fal-request-1" }), {
        status: 201,
        headers: { "content-type": "application/json", "x-request-id": "fal-request-1" },
      });
    });
    const audit = vi.fn(async () => undefined);
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [{
        id: "fal-primary",
        providerId: "fal",
        upstreamId: "fal",
        enabled: true,
        credentials: { apiKey: "fal-super-secret" },
      }],
      fetch: fetch as typeof globalThis.fetch,
      audit,
    });

    const credential = await broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "credential-1",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:fal" },
    }, context()) as { handle: string };
    expect(credential.handle).toMatch(/^clash-secret:\/\//);
    expect(JSON.stringify(credential)).not.toContain("fal-super-secret");

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "network-1",
      invocationId: "invocation-1",
      operation: {
        kind: "network.fetch",
        url: "https://queue.fal.run/minimax/h3",
        method: "POST",
        headers: { authorization: "plugin-must-not-choose-this", "content-type": "application/json" },
        body: { prompt: "Turn around" },
        credentialHandle: credential.handle,
      },
    }, context())).resolves.toMatchObject({
      status: 201,
      body: { request_id: "fal-request-1" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("fal-super-secret");
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: "broker-plugin",
      projectId: "project-1",
      invocationId: "invocation-1",
      operation: "network.fetch",
      target: "queue.fal.run",
      status: "ok",
    }));

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "network-cross-scope",
      invocationId: "invocation-2",
      operation: {
        kind: "network.fetch",
        url: "https://queue.fal.run/minimax/h3",
        method: "GET",
        headers: {},
        credentialHandle: credential.handle,
      },
    }, context("invocation-2"))).rejects.toThrow(/does not belong to invocation/);
  });

  it("sends Hilo Hub OAuth tokens in both required authentication headers", async () => {
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer hub-oauth-token");
      expect(headers.get("token")).toBe("hub-oauth-token");
      return new Response(JSON.stringify({ taskId: "hub-task-1" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [{
        id: "hilo-hub-primary",
        providerId: "hilo-hub",
        upstreamId: "hilo-hub",
        enabled: true,
        credentials: { apiKey: "hub-oauth-token" },
      }],
      fetch: fetch as typeof globalThis.fetch,
    });
    const hiloContext = context();
    hiloContext.manifest.permissions.secrets = ["provider:hilo-hub"];
    hiloContext.manifest.permissions.network.domains = ["hub.minimax.io"];

    const credential = await broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "hilo-credential-1",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:hilo-hub" },
    }, hiloContext) as { handle: string };

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "hilo-network-1",
      invocationId: "invocation-1",
      operation: {
        kind: "network.fetch",
        url: "https://hub.minimax.io/api/v2/image/nano_banana/generate",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { prompt: "A lighthouse" },
        credentialHandle: credential.handle,
      },
    }, hiloContext)).resolves.toMatchObject({
      status: 201,
      body: { taskId: "hub-task-1" },
    });
  });

  it("keeps a credential handle usable for longer than the executor's polling ceiling", async () => {
    // Video generations poll for up to 25 minutes. A shorter handle lifetime
    // discarded already-billed upstream tasks mid-poll. The handle is not a
    // security boundary on its own: a plugin holding provider:* may mint a new
    // one at any time, so the real limits are the sandbox, the domain
    // allowlist, and the invocation/plugin binding.
    let clock = 0;
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [{
        id: "hilo-hub-primary",
        providerId: "hilo-hub",
        upstreamId: "hilo-hub",
        enabled: true,
        credentials: { apiKey: "hub-token" },
      }],
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock,
    });
    const ctx = context();
    ctx.manifest.permissions.secrets = ["provider:hilo-hub"];
    ctx.manifest.permissions.network.domains = ["hub.minimax.io"];

    const credential = await broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "cred-long",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:hilo-hub" },
    }, ctx) as { handle: string };

    // Past the executor's full 25-minute polling ceiling plus per-request
    // network time, which is exactly where the 15-minute default used to
    // discard already-billed seedance tasks at ~919s.
    clock += 26 * 60_000;

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "fetch-long",
      invocationId: "invocation-1",
      operation: {
        kind: "network.fetch",
        url: "https://hub.minimax.io/api/v1/video/seedance/tasks/t-1",
        method: "GET",
        headers: {},
        credentialHandle: credential.handle,
      },
    }, ctx)).resolves.toMatchObject({ status: 200 });
  });

  it("lets the host configure the credential handle lifetime", async () => {
    let clock = 0;
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => Response.json({ ok: true }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [{
        id: "hilo-hub-primary",
        providerId: "hilo-hub",
        upstreamId: "hilo-hub",
        enabled: true,
        credentials: { apiKey: "hub-token" },
      }],
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => clock,
      credentialHandleTtlMs: 60_000,
    });
    const ctx = context();
    ctx.manifest.permissions.secrets = ["provider:hilo-hub"];
    ctx.manifest.permissions.network.domains = ["hub.minimax.io"];

    const credential = await broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "cred-cfg",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:hilo-hub" },
    }, ctx) as { handle: string };

    clock += 61_000;

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "fetch-cfg",
      invocationId: "invocation-1",
      operation: {
        kind: "network.fetch",
        url: "https://hub.minimax.io/api/v1/video/seedance/tasks/t-1",
        method: "GET",
        headers: {},
        credentialHandle: credential.handle,
      },
    }, ctx)).rejects.toThrow(/unknown or expired/);
  });

  it("reads only project-scoped assets through the broker", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      fetch: vi.fn(),
      readAsset: async ({ assetId, projectId }) => {
        expect({ assetId, projectId }).toEqual({ assetId: "asset-1", projectId: "project-1" });
        return {
          kind: "image",
          mediaType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        };
      },
    });

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "asset-1",
      invocationId: "invocation-1",
      operation: {
        kind: "asset.read",
        asset: { assetId: "asset-1", uri: "clash-asset://asset-1", kind: "image" },
      },
    }, context())).resolves.toMatchObject({
      handle: expect.stringMatching(/^clash-plugin-asset:\/\//),
      kind: "image",
      mediaType: "image/png",
      byteLength: 3,
      dataBase64: "AQID",
    });
  });

  it("writes plugin-produced bytes through the project asset broker", async () => {
    const writeAsset = vi.fn(async () => ({
      assetId: "asset-output-1",
      uri: "clash-asset://asset-output-1",
      kind: "image" as const,
      mediaType: "image/png",
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      fetch: vi.fn(),
      writeAsset,
    });
    const writableContext = context();
    writableContext.manifest.permissions.assets = ["write"];

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "asset-write-1",
      invocationId: "invocation-1",
      operation: {
        kind: "asset.write",
        slot: "image",
        assetKind: "image",
        mediaType: "image/png",
        dataBase64: "AQID",
      },
    } as any, writableContext)).resolves.toEqual({
      assetId: "asset-output-1",
      uri: "clash-asset://asset-output-1",
      kind: "image",
      mediaType: "image/png",
    });
    expect(writeAsset).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      invocationId: "invocation-1",
      slot: "image",
      kind: "image",
      mediaType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    }));
  });

  it("runs Codex ImageGen through the kernel and persists the result as a project asset", async () => {
    const generateCodexImage = vi.fn(async (input: any) => {
      expect(input).toMatchObject({
        prompt: "A paper-cut moon",
        aspectRatio: "16:9",
        references: [{
          asset: { assetId: "reference-1", kind: "image" },
          mediaType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        }],
      });
      return { mediaType: "image/png", bytes: new Uint8Array([137, 80, 78, 71]) };
    });
    const writeAsset = vi.fn(async () => ({
      assetId: "generated-1",
      uri: "clash-asset://generated-1",
      kind: "image" as const,
      mediaType: "image/png",
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
      writeAsset,
      generateCodexImage,
    });
    const imagegenContext = context();
    imagegenContext.manifest.permissions.assets = ["read", "write"];
    imagegenContext.manifest.permissions.hostTools = ["codex.imagegen"];

    await expect(broker({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "codex-imagegen-1",
      invocationId: "invocation-1",
      operation: {
        kind: "codex.image.generate",
        prompt: "A paper-cut moon",
        aspectRatio: "16:9",
        slot: "image",
        references: [{
          assetId: "reference-1",
          uri: "clash-asset://reference-1",
          kind: "image",
          mediaType: "image/png",
        }],
      },
    }, imagegenContext)).resolves.toEqual({
      assetId: "generated-1",
      uri: "clash-asset://generated-1",
      kind: "image",
      mediaType: "image/png",
    });
    expect(generateCodexImage).toHaveBeenCalledTimes(1);
    expect(writeAsset).toHaveBeenCalledWith(expect.objectContaining({
      pluginId: "broker-plugin",
      projectId: "project-1",
      slot: "image",
      kind: "image",
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    }));
  });
});
