import { describe, expect, it, vi } from "vitest";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
} from "@clash/shared-types";

import { createLocalExecutablePluginBroker } from "./local-plugin-broker.js";

const manifest = ExecutablePluginManifestSchema.parse({
  apiVersion: "clash.plugin/v1",
  id: "test.broker-plugin",
  version: "1.0.0",
  name: "Broker Plugin",
  runtime: {
    kind: "local",
    transport: "stdio",
    entrypoint: "handler.mjs",
  },
  contributes: {
    functions: [{
      id: "run",
      kind: "provider-executor",
      operations: ["submit", "poll"],
    }],
    hostTools: ["codex.imagegen"],
  },
});

function context() {
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
        exportId: "run",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-executor",
      },
      input: { values: {}, references: [] },
      actor: { kind: "agent", id: "agent-1" },
    }),
    accountId: "provider-account-1",
  };
}

describe("local executable plugin host dependencies", () => {
  it("reads only project-scoped assets through the host context", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async ({ assetId, projectId }) => {
        expect({ assetId, projectId }).toEqual({
          assetId: "asset-1",
          projectId: "project-1",
        });
        return {
          kind: "image",
          mediaType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        };
      },
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "asset-1",
          invocationId: "invocation-1",
          operation: {
            kind: "asset.read",
            asset: {
              assetId: "asset-1",
              uri: "clash-asset://asset-1",
              kind: "image",
            },
          },
        },
        context(),
      ),
    ).resolves.toMatchObject({
      handle: expect.stringMatching(/^clash-plugin-asset:\/\//),
      kind: "image",
      mediaType: "image/png",
      byteLength: 3,
      dataBase64: "AQID",
    });
  });

  it("writes plugin-produced bytes through the project asset context", async () => {
    const writeAsset = vi.fn(async () => ({
      assetId: "asset-output-1",
      uri: "clash-asset://asset-output-1",
      kind: "image" as const,
      mediaType: "image/png",
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      writeAsset,
    });

    await expect(
      broker(
        {
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
        },
        context(),
      ),
    ).resolves.toEqual({
      assetId: "asset-output-1",
      uri: "clash-asset://asset-output-1",
      kind: "image",
      mediaType: "image/png",
    });
    expect(writeAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        invocationId: "invocation-1",
        slot: "image",
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    );
  });

  it("runs Codex ImageGen and persists the result as a project asset", async () => {
    const generateCodexImage = vi.fn(async () => ({
      mediaType: "image/png",
      bytes: new Uint8Array([137, 80, 78, 71]),
    }));
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

    await expect(
      broker(
        {
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
        },
        context(),
      ),
    ).resolves.toEqual({
      assetId: "generated-1",
      uri: "clash-asset://generated-1",
      kind: "image",
      mediaType: "image/png",
    });
    expect(generateCodexImage).toHaveBeenCalledWith({
      prompt: "A paper-cut moon",
      aspectRatio: "16:9",
      references: [{
        asset: {
          assetId: "reference-1",
          uri: "clash-asset://reference-1",
          kind: "image",
          mediaType: "image/png",
        },
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }],
    });
    expect(writeAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: manifest.id,
        projectId: "project-1",
        slot: "image",
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      }),
    );
  });
});
