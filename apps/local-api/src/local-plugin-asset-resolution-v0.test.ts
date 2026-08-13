import { describe, expect, it, vi } from "vitest";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
} from "@clash/shared-types";

import { createLocalExecutablePluginBroker } from "./local-plugin-broker.js";

const manifest = ExecutablePluginManifestSchema.parse({
  apiVersion: "clash.plugin/v1",
  id: "test.provider",
  version: "0.1.0",
  name: "Test Provider",
  runtime: { kind: "local", transport: "stdio", entrypoint: "index.mjs" },
  contributes: {
    functions: [{ id: "execute", kind: "provider-executor" }],
  },
});

const reference = {
  slot: "startFrame",
  index: 0,
  asset: {
    assetId: "asset-1",
    uri: "clash-asset://asset-1",
    kind: "image" as const,
    mediaType: "image/png",
  },
};

function context(representations: Array<"provider-url" | "bytes">) {
  return {
    manifest,
    invocation: ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "invocation-1",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: manifest.id,
        version: manifest.version,
        exportId: "execute",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-executor",
      },
      input: { values: {}, references: [reference] },
      assetInputs: [
        {
          match: { kinds: ["image"], slots: ["startFrame"] },
          representations,
          mediaTypes: ["image/png"],
        },
      ],
      actor: { kind: "system" },
    }),
  };
}

function request() {
  return {
    protocol: "clash.plugin.broker-request/v1" as const,
    requestId: "request-1",
    invocationId: "invocation-1",
    operation: { kind: "asset.resolve" as const, reference },
  };
}

describe("local Host Provider Asset resolution", () => {
  it("reuses an existing Provider URL when the binding accepts URL or bytes", async () => {
    const publishAsset = vi.fn(async () => ({
      url: "https://objects.example.test/unexpected.png?sig=2",
      expiresAt: "2026-08-13T13:00:00.000Z",
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        resourceDigest: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
        providerUrl: {
          providerUrl: "https://objects.example.test/reference.png?sig=1",
          expiresAt: "2026-08-13T12:00:00.000Z",
        },
      }),
      publishAsset,
    });

    await expect(
      broker(request(), context(["provider-url", "bytes"])),
    ).resolves.toEqual({
      form: "provider-url",
      providerUrl: "https://objects.example.test/reference.png?sig=1",
      expiresAt: "2026-08-13T12:00:00.000Z",
      kind: "image",
      mediaType: "image/png",
    });
    expect(publishAsset).not.toHaveBeenCalled();
  });

  it("uses bytes without publishing when an URL-or-bytes binding has no existing URL", async () => {
    const publishAsset = vi.fn(async () => ({
      url: "https://objects.example.test/reference.png?sig=1",
      expiresAt: "2026-08-13T12:00:00.000Z",
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        resourceDigest: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      }),
      publishAsset,
    });

    await expect(
      broker(request(), context(["provider-url", "bytes"])),
    ).resolves.toEqual({
      form: "bytes",
      bytesBase64: "AQID",
      kind: "image",
      mediaType: "image/png",
    });
    expect(publishAsset).not.toHaveBeenCalled();
  });

  it("publishes bytes when the binding requires a Provider URL", async () => {
    const publishAsset = vi.fn(async () => ({
      url: "https://objects.example.test/reference.png?sig=1",
      expiresAt: "2026-08-13T12:00:00.000Z",
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        resourceDigest: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      }),
      publishAsset,
    });

    await expect(
      broker(request(), context(["provider-url"])),
    ).resolves.toEqual({
      form: "provider-url",
      providerUrl: "https://objects.example.test/reference.png?sig=1",
      expiresAt: "2026-08-13T12:00:00.000Z",
      kind: "image",
      mediaType: "image/png",
    });
    expect(publishAsset).toHaveBeenCalledOnce();
  });

  it("rejects an URL-only binding when public storage is not configured", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        resourceDigest: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      }),
    });

    await expect(
      broker(request(), context(["provider-url"])),
    ).rejects.toThrow(/requires a public URL.*cannot provide one/i);
  });

  it("fails the invocation with the configured storage upload error", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        resourceDigest: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      }),
      publishAsset: async () => {
        throw new Error("TOS upload failed");
      },
    });

    await expect(
      broker(request(), context(["provider-url"])),
    ).rejects.toThrow("TOS upload failed");
  });

  it("rejects an Asset whose slot has no delivery declaration", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        resourceDigest: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      }),
    });
    const mismatched = context(["bytes"]);
    mismatched.invocation.assetInputs = [
      { match: { kinds: ["image"], slots: ["image"] }, representations: ["bytes"] },
    ];

    await expect(broker(request(), mismatched)).rejects.toThrow(/no delivery for startFrame/i);
  });
});
