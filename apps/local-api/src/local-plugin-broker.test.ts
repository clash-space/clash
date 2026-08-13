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
    functions: [
      {
        id: "run",
        kind: "provider-executor",
        operations: ["submit", "poll"],
      },
    ],
    hostTools: ["codex.imagegen"],
  },
});

function context(
  references: Array<{
    slot: string;
    index: number;
    asset: {
      assetId: string;
      uri: string;
      kind: "image" | "video";
      mediaType?: string;
    };
  }> = [],
) {
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
      input: { values: {}, references },
      assetInputs: [
        {
          match: { kinds: ["image"], slots: ["image"] },
          representations: ["bytes"],
        },
      ],
      actor: { kind: "agent", id: "agent-1" },
    }),
    accountId: "provider-account-1",
  };
}

describe("local executable plugin host dependencies", () => {
  it("ingests an asset.write URL without trusting a reach assertion", async () => {
    const openUploadSlot = vi.fn(async () => ({
      assetId: "asset-output-url",
      uri: "clash-asset://asset-output-url",
      kind: "image" as const,
      mediaType: "image/png",
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      openUploadSlot,
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "asset-write-url",
          invocationId: "invocation-1",
          operation: {
            kind: "asset.write",
            slot: "image",
            assetKind: "image",
            mediaType: "image/png",
            url: "https://cdn.example.test/output.png",
          },
        },
        context(),
      ),
    ).resolves.toEqual({
      assetId: "asset-output-url",
      uri: "clash-asset://asset-output-url",
      kind: "image",
      mediaType: "image/png",
    });
    expect(openUploadSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        invocationId: "invocation-1",
        slot: "image",
        url: "https://cdn.example.test/output.png",
      }),
    );
  });

  it("rejects an existing Project Asset that is not frozen into this invocation", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "guessed-asset-1",
          invocationId: "invocation-1",
          operation: {
            kind: "asset.resolve",
            reference: {
              slot: "image",
              index: 0,
              asset: {
                assetId: "asset-1",
                uri: "clash-asset://asset-1",
                kind: "image",
              },
            },
          },
        },
        context(),
      ),
    ).rejects.toMatchObject({
      code: "PLUGIN_REFERENCE_NOT_AUTHORIZED",
      message:
        "Asset reference image:0 is not authorized for the active invocation.",
    });
  });

  it.each([
    {
      name: "slot",
      requested: {
        slot: "otherImage",
        index: 0,
        asset: {
          assetId: "asset-1",
          uri: "clash-asset://asset-1",
          kind: "image" as const,
        },
      },
    },
    {
      name: "kind",
      requested: {
        slot: "image",
        index: 0,
        asset: {
          assetId: "asset-1",
          uri: "clash-asset://asset-1",
          kind: "video" as const,
        },
      },
    },
  ])(
    "does not authorize a guessed Asset id with a different frozen $name",
    async ({ requested }) => {
      const broker = createLocalExecutablePluginBroker({
        loadProviderAccounts: async () => [],
        readAsset: async () => ({
          kind: "image",
          mediaType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        }),
      });

      await expect(
        broker(
          {
            protocol: "clash.plugin.broker-request/v1",
            requestId: `guessed-${requested.slot}-${requested.asset.kind}`,
            invocationId: "invocation-1",
            operation: { kind: "asset.resolve", reference: requested },
          },
          context([
            {
              slot: "image",
              index: 0,
              asset: {
                assetId: "asset-1",
                uri: "clash-asset://asset-1",
                kind: "image",
              },
            },
          ]),
        ),
      ).rejects.toMatchObject({ code: "PLUGIN_REFERENCE_NOT_AUTHORIZED" });
    },
  );

  it("resolves a frozen Project Asset through its matching slot and kind", async () => {
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
            kind: "asset.resolve",
            reference: {
              slot: "image",
              index: 0,
              asset: {
                assetId: "asset-1",
                uri: "clash-asset://asset-1",
                kind: "image",
              },
            },
          },
        },
        context([
          {
            slot: "image",
            index: 0,
            asset: {
              assetId: "asset-1",
              uri: "clash-asset://asset-1",
              kind: "image",
            },
          },
        ]),
      ),
    ).resolves.toMatchObject({
      form: "bytes",
      kind: "image",
      mediaType: "image/png",
      bytesBase64: "AQID",
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

  it("rejects a Codex ImageGen reference that is not frozen into this invocation", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
      generateCodexImage: async () => ({
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      }),
      writeAsset: async () => ({
        assetId: "generated-1",
        uri: "clash-asset://generated-1",
        kind: "image",
        mediaType: "image/png",
      }),
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "codex-imagegen-guessed-reference",
          invocationId: "invocation-1",
          operation: {
            kind: "codex.image.generate",
            prompt: "A paper-cut moon",
            aspectRatio: "16:9",
            slot: "image",
            references: [
              {
                assetId: "reference-1",
                uri: "clash-asset://reference-1",
                kind: "image",
                mediaType: "image/png",
              },
            ],
          },
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: "PLUGIN_REFERENCE_NOT_AUTHORIZED" });
  });

  it("does not authorize a Codex ImageGen reference by Asset id when its frozen kind differs", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset: async () => ({
        kind: "image",
        mediaType: "image/png",
        bytes: new Uint8Array([1, 2, 3]),
      }),
      generateCodexImage: async () => ({
        mediaType: "image/png",
        bytes: new Uint8Array([137, 80, 78, 71]),
      }),
      writeAsset: async () => ({
        assetId: "generated-1",
        uri: "clash-asset://generated-1",
        kind: "image",
        mediaType: "image/png",
      }),
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "codex-imagegen-wrong-kind",
          invocationId: "invocation-1",
          operation: {
            kind: "codex.image.generate",
            prompt: "A paper-cut moon",
            aspectRatio: "16:9",
            slot: "image",
            references: [
              {
                assetId: "reference-1",
                uri: "clash-asset://reference-1",
                kind: "image",
                mediaType: "image/png",
              },
            ],
          },
        },
        context([
          {
            slot: "video",
            index: 0,
            asset: {
              assetId: "reference-1",
              uri: "clash-asset://reference-1",
              kind: "video",
              mediaType: "video/mp4",
            },
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: "PLUGIN_REFERENCE_NOT_AUTHORIZED" });
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
            references: [
              {
                assetId: "reference-1",
                uri: "clash-asset://reference-1",
                kind: "image",
                mediaType: "image/png",
              },
            ],
          },
        },
        context([
          {
            slot: "sourceImage",
            index: 0,
            asset: {
              assetId: "reference-1",
              uri: "clash-asset://reference-1",
              kind: "image",
              mediaType: "image/png",
            },
          },
        ]),
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
      references: [
        {
          asset: {
            assetId: "reference-1",
            uri: "clash-asset://reference-1",
            kind: "image",
            mediaType: "image/png",
          },
          mediaType: "image/png",
          bytes: new Uint8Array([1, 2, 3]),
        },
      ],
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
