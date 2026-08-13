import { describe, expect, it } from "vitest";

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
  it("chooses a Provider URL before bytes when the binding accepts both", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        resourceDigest: "a".repeat(64),
        bytes: new Uint8Array([1, 2, 3]),
      }),
      publishAsset: async () => ({
        url: "https://objects.example.test/reference.png?sig=1",
        expiresAt: "2026-08-13T12:00:00.000Z",
      }),
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
  });

  it("falls back to bytes when no public projection is available", async () => {
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
      broker(request(), context(["provider-url", "bytes"])),
    ).resolves.toEqual({
      form: "bytes",
      bytesBase64: "AQID",
      kind: "image",
      mediaType: "image/png",
    });
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
