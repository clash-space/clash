import { describe, expect, it, vi } from "vitest";

import { signHostedExecutablePluginCapability } from "./hosted-plugin-capabilities";
import { createHostedExecutablePluginBroker } from "./hosted-plugin-broker";

async function capabilityToken(permissions: Record<string, unknown>) {
  const now = 1_785_840_000;
  return signHostedExecutablePluginCapability({
    protocol: "clash.plugin.hosted-capability/v1",
    capabilityId: "capability-1",
    issuedAt: now,
    expiresAt: now + 900,
    endpoint: "https://plugin.example.com/run",
    ownerUserId: "user-1",
    invocation: {
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      nodeId: "node-1",
      target: {
        pluginId: "acme.media",
        version: "1.2.3",
        exportId: "render",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "action",
      },
      actor: { kind: "user", id: "user-1" },
    },
    permissions,
  }, "capability-key");
}

describe("hosted executable-plugin broker", () => {
  it("keeps provider credentials in the Kernel and injects them only into allowed network calls", async () => {
    const token = await capabilityToken({
      network: { domains: ["queue.fal.run"] },
      secrets: ["provider:fal"],
      assets: [],
      filesystem: { read: [], write: [] },
      externalWrites: true,
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Key fal-secret");
      expect(headers.get("x-api-key")).toBeNull();
      return new Response(JSON.stringify({ request_id: "fal-1" }), {
        status: 201,
        headers: { "content-type": "application/json", "x-fal-request-id": "fal-1" },
      });
    });
    const audit = vi.fn();
    const broker = createHostedExecutablePluginBroker({
      capabilityKey: "capability-key",
      nowSeconds: () => 1_785_840_030,
      fetch: fetchMock as typeof fetch,
      loadCredential: vi.fn().mockResolvedValue({
        providerId: "fal",
        credentials: { apiKey: "fal-secret" },
      }),
      audit,
    });

    const handleResult = await broker(token, {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-handle",
      invocationId: "invocation-1",
      operation: { kind: "credential.handle", secretId: "provider:fal" },
    });
    expect(handleResult).toMatchObject({ providerId: "fal" });
    expect(JSON.stringify(handleResult)).not.toContain("fal-secret");

    const result = await broker(token, {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-network",
      invocationId: "invocation-1",
      operation: {
        kind: "network.fetch",
        url: "https://queue.fal.run/acme/model",
        method: "POST",
        headers: { authorization: "Bearer plugin-controlled", "x-api-key": "plugin-controlled" },
        body: { prompt: "hello" },
        credentialHandle: (handleResult as { handle: string }).handle,
      },
    });

    expect(result).toEqual({
      status: 201,
      headers: { "content-type": "application/json", "x-fal-request-id": "fal-1" },
      body: { request_id: "fal-1" },
    });
    expect(fetchMock).toHaveBeenCalledWith("https://queue.fal.run/acme/model", expect.objectContaining({
      method: "POST",
      redirect: "manual",
      body: JSON.stringify({ prompt: "hello" }),
    }));
    expect(audit).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(audit.mock.calls)).not.toContain("fal-secret");
  });

  it("brokers project-scoped asset reads and Kernel-owned writes", async () => {
    const token = await capabilityToken({
      network: { domains: [] },
      secrets: [],
      assets: ["read", "write"],
      filesystem: { read: [], write: [] },
      externalWrites: false,
    });
    const writeAsset = vi.fn().mockResolvedValue({
      assetId: "asset-output",
      uri: "clash-asset://asset-output",
      kind: "image",
      mediaType: "image/png",
    });
    const broker = createHostedExecutablePluginBroker({
      capabilityKey: "capability-key",
      nowSeconds: () => 1_785_840_030,
      loadCredential: vi.fn(),
      readAsset: vi.fn().mockResolvedValue({
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
      writeAsset,
    });

    await expect(broker(token, {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-read",
      invocationId: "invocation-1",
      operation: {
        kind: "asset.read",
        asset: { assetId: "asset-input", uri: "clash-asset://asset-input", kind: "image" },
      },
    })).resolves.toMatchObject({ dataBase64: "AQID", kind: "image", byteLength: 3 });

    await expect(broker(token, {
      protocol: "clash.plugin.broker-request/v1",
      requestId: "request-write",
      invocationId: "invocation-1",
      operation: {
        kind: "asset.write",
        slot: "output",
        assetKind: "image",
        mediaType: "image/png",
        dataBase64: "AQID",
      },
    })).resolves.toMatchObject({ assetId: "asset-output" });
    expect(writeAsset).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: "user-1",
      projectId: "project-1",
      pluginId: "acme.media",
      pluginVersion: "1.2.3",
      bytes: new Uint8Array([1, 2, 3]),
    }));
  });
});
