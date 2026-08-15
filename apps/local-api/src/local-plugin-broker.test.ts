import { describe, expect, it, vi } from "vitest";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
  type ExecutablePluginReference,
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
  references: ExecutablePluginReference[] = [],
  assetInputs: Array<{
    match: {
      kinds?: Array<"image" | "video" | "audio" | "model">;
      slots?: string[];
    };
    representations: Array<"provider-url" | "executor-url" | "bytes">;
    mediaTypes?: string[];
  }> = [
    {
      match: { kinds: ["image"], slots: ["image"] },
      representations: ["bytes"],
    },
  ],
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
      assetInputs,
      actor: { kind: "agent", id: "agent-1" },
    }),
    accountId: "provider-account-1",
  };
}

describe("local executable plugin host dependencies", () => {
  it("opens an execution-realm URL for an authorized frozen Asset without reading its bytes", async () => {
    const released: string[] = [];
    const readAsset = vi.fn(async () => {
      throw new Error("executor-url delivery must not materialize bytes");
    });
    const openExecutorAsset = vi.fn(async () => ({
      executorUrl: "http://127.0.0.1:41991/assets/capability-token",
      expiresAt: "2026-08-15T08:05:00.000Z",
      kind: "image" as const,
      mediaType: "image/png",
      release: () => {
        released.push("capability-token");
      },
    }));
    const frozen = {
      slot: "source",
      index: 0,
      asset: {
        assetId: "asset-1",
        uri: "clash-asset://asset-1",
        kind: "image" as const,
        mediaType: "image/png",
      },
    };
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readAsset,
      openExecutorAsset,
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "executor-url-1",
          invocationId: "invocation-1",
          operation: { kind: "asset.resolve", reference: frozen },
        },
        context(
          [frozen],
          [
            {
              match: { kinds: ["image"], slots: ["source"] },
              representations: ["executor-url"],
              mediaTypes: ["image/png"],
            },
          ],
        ),
      ),
    ).resolves.toEqual({
      form: "executor-url",
      executorUrl: "http://127.0.0.1:41991/assets/capability-token",
      expiresAt: "2026-08-15T08:05:00.000Z",
      kind: "image",
      mediaType: "image/png",
    });
    expect(readAsset).not.toHaveBeenCalled();
    expect(openExecutorAsset).toHaveBeenCalledWith({
      pluginId: manifest.id,
      pluginVersion: manifest.version,
      projectId: "project-1",
      invocationId: "invocation-1",
      assetId: "asset-1",
      kind: "image",
      mediaType: "image/png",
    });
    expect(released).toEqual([]);

    await broker.releaseInvocation?.("invocation-1");
    await broker.releaseInvocation?.("invocation-1");
    expect(released).toEqual(["capability-token"]);
  });

  it("authorizes the exact frozen index before opening an executor capability", async () => {
    const openExecutorAsset = vi.fn(async () => ({
      executorUrl: "http://127.0.0.1:41991/assets/must-not-open",
      expiresAt: "2026-08-15T08:05:00.000Z",
      kind: "image" as const,
      release: () => undefined,
    }));
    const frozen = {
      slot: "source",
      index: 0,
      asset: {
        assetId: "asset-1",
        uri: "clash-asset://asset-1",
        kind: "image" as const,
      },
    };
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      openExecutorAsset,
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "executor-url-guessed-index",
          invocationId: "invocation-1",
          operation: {
            kind: "asset.resolve",
            reference: { ...frozen, index: 1 },
          },
        },
        context(
          [frozen],
          [
            {
              match: { kinds: ["image"], slots: ["source"] },
              representations: ["executor-url"],
            },
          ],
        ),
      ),
    ).rejects.toMatchObject({ code: "PLUGIN_REFERENCE_NOT_AUTHORIZED" });
    expect(openExecutorAsset).not.toHaveBeenCalled();
  });

  it("rejects and releases an executor capability whose media type differs from the frozen Asset", async () => {
    const release = vi.fn();
    const frozen = {
      slot: "source",
      index: 0,
      asset: {
        assetId: "asset-1",
        uri: "clash-asset://asset-1",
        kind: "image" as const,
        mediaType: "image/png",
      },
    };
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      openExecutorAsset: async () => ({
        executorUrl: "http://127.0.0.1:41991/assets/wrong-media-type",
        expiresAt: "2026-08-15T08:05:00.000Z",
        kind: "image",
        mediaType: "image/jpeg",
        release,
      }),
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "executor-url-media-type-mismatch",
          invocationId: "invocation-1",
          operation: { kind: "asset.resolve", reference: frozen },
        },
        context(
          [frozen],
          [
            {
              match: { kinds: ["image"], slots: ["source"] },
              representations: ["executor-url"],
            },
          ],
        ),
      ),
    ).rejects.toThrow(/media type.*image\/jpeg.*image\/png/i);
    expect(release).toHaveBeenCalledTimes(1);

    await broker.releaseInvocation?.("invocation-1");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases an executor capability that finishes opening after its outer invocation ended", async () => {
    let finishOpen!: (value: {
      executorUrl: string;
      expiresAt: string;
      kind: "image";
      release(): void;
    }) => void;
    const opening = new Promise<{
      executorUrl: string;
      expiresAt: string;
      kind: "image";
      release(): void;
    }>((resolve) => {
      finishOpen = resolve;
    });
    const released: string[] = [];
    const frozen = {
      slot: "source",
      index: 0,
      asset: {
        assetId: "asset-1",
        uri: "clash-asset://asset-1",
        kind: "image" as const,
      },
    };
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      openExecutorAsset: async () => await opening,
    });
    const resolution = broker(
      {
        protocol: "clash.plugin.broker-request/v1",
        requestId: "executor-url-late-open",
        invocationId: "invocation-1",
        operation: { kind: "asset.resolve", reference: frozen },
      },
      context(
        [frozen],
        [
          {
            match: { kinds: ["image"], slots: ["source"] },
            representations: ["executor-url"],
          },
        ],
      ),
    );

    await broker.releaseInvocation?.("invocation-1");
    finishOpen({
      executorUrl: "http://127.0.0.1:41991/assets/late-token",
      expiresAt: "2026-08-15T08:05:00.000Z",
      kind: "image",
      release: () => {
        released.push("late-token");
      },
    });

    await expect(resolution).resolves.toMatchObject({
      form: "executor-url",
    });
    expect(released).toEqual(["late-token"]);
  });

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

  it("authorizes and resolves only the frozen Document revision", async () => {
    const frozen = {
      slot: "transcript",
      index: 0,
      document: {
        documentAssetId: "document-1",
        revisionId: "revision-2",
        documentKind: "media.transcript",
        schemaVersion: 1,
      },
    } as const;
    const readDocument = vi.fn(async () => ({
      documentKind: "media.transcript",
      schemaVersion: 1,
      body: { text: "frozen words" },
    }));
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      readDocument,
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "document-1",
          invocationId: "invocation-1",
          operation: { kind: "asset.resolve", reference: frozen },
        },
        context([frozen]),
      ),
    ).resolves.toEqual({
      form: "document",
      documentKind: "media.transcript",
      schemaVersion: 1,
      body: { text: "frozen words" },
    });
    expect(readDocument).toHaveBeenCalledWith({
      projectId: "project-1",
      documentAssetId: "document-1",
      revisionId: "revision-2",
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "document-guessed-revision",
          invocationId: "invocation-1",
          operation: {
            kind: "asset.resolve",
            reference: {
              ...frozen,
              document: { ...frozen.document, revisionId: "revision-3" },
            },
          },
        },
        context([frozen]),
      ),
    ).rejects.toMatchObject({ code: "PLUGIN_REFERENCE_NOT_AUTHORIZED" });
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

const asrManifest = ExecutablePluginManifestSchema.parse({
  apiVersion: "clash.plugin/v1",
  id: "clash.asr",
  version: "1.0.0",
  name: "Clash ASR",
  runtime: {
    kind: "local",
    transport: "stdio",
    entrypoint: "dist/stdio.mjs",
  },
  contributes: {
    functions: [
      {
        id: "transcribe",
        kind: "action",
        operations: ["submit", "poll"],
      },
    ],
    hostTools: ["speech.transcribe"],
  },
});

const audioReference = {
  slot: "source",
  index: 0,
  asset: {
    assetId: "audio-1",
    uri: "clash-asset://audio-1",
    kind: "audio" as const,
    mediaType: "audio/wav",
  },
};

function asrContext(
  references: ExecutablePluginReference[] = [audioReference],
  manifest = asrManifest,
) {
  return {
    manifest,
    invocation: ExecutablePluginInvocationSchema.parse({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "asr-invocation-1",
      taskId: "asr-task-1",
      projectId: "project-1",
      target: {
        pluginId: manifest.id,
        version: manifest.version,
        exportId: "transcribe",
        schemaHash: `sha256:${"b".repeat(64)}`,
        kind: "action",
      },
      input: { values: {}, references },
      actor: { kind: "agent", id: "agent-1" },
    }),
  };
}

const timedTranscript = {
  schemaVersion: 1 as const,
  kind: "clash.asr.timed-transcript" as const,
  timebase: "milliseconds" as const,
  alignment: "word" as const,
  text: "hello",
  backendId: "funasr",
  modelId: "iic/SenseVoiceSmall",
  language: "en",
  durationMs: 480,
  words: [{ id: "word-1", text: "hello", startMs: 40, endMs: 480 }],
  segments: [
    {
      id: "segment-1",
      text: "hello",
      startMs: 40,
      endMs: 480,
      wordIds: ["word-1"],
    },
  ],
};

describe("first-party ASR Host tool", () => {
  it("routes a completed transcription through a narrow invocation-scoped service", async () => {
    let serviceInput: unknown;
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      transcribeSpeech: async (input) => {
        serviceInput = input;
        return { status: "completed", transcript: timedTranscript };
      },
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "speech-completed",
          invocationId: "asr-invocation-1",
          operation: {
            kind: "speech.transcribe",
            reference: audioReference,
            modelId: "iic/SenseVoiceSmall",
            language: "en",
          },
        },
        asrContext(),
      ),
    ).resolves.toEqual({ status: "completed", transcript: timedTranscript });
    expect(serviceInput).toEqual({
      projectId: "project-1",
      invocationId: "asr-invocation-1",
      taskId: "asr-task-1",
      reference: audioReference,
      modelId: "iic/SenseVoiceSmall",
      language: "en",
    });
    expect(Object.keys(serviceInput as object).sort()).toEqual([
      "invocationId",
      "language",
      "modelId",
      "projectId",
      "reference",
      "taskId",
    ]);
  });

  it("passes accepted poll state through the durable Host loop", async () => {
    let serviceInput: unknown;
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      transcribeSpeech: async (input) => {
        serviceInput = input;
        return {
          status: "accepted",
          poll: { upstreamTaskId: "asr-1", cursor: "next" },
          retryAfterMs: 2_000,
        };
      },
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "speech-poll",
          invocationId: "asr-invocation-1",
          operation: {
            kind: "speech.transcribe",
            reference: audioReference,
            modelId: "iic/SenseVoiceSmall",
            poll: { upstreamTaskId: "asr-1", cursor: "current" },
          },
        },
        asrContext(),
      ),
    ).resolves.toEqual({
      status: "accepted",
      poll: { upstreamTaskId: "asr-1", cursor: "next" },
      retryAfterMs: 2_000,
    });
    expect(serviceInput).toEqual({
      projectId: "project-1",
      invocationId: "asr-invocation-1",
      taskId: "asr-task-1",
      reference: audioReference,
      modelId: "iic/SenseVoiceSmall",
      poll: { upstreamTaskId: "asr-1", cursor: "current" },
    });
  });

  it("rejects an invalid timed transcript returned by the Host service", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      transcribeSpeech: async () =>
        ({
          status: "completed",
          transcript: {
            ...timedTranscript,
            durationMs: 1,
            words: [{ id: "word-1", text: "hello", startMs: 0, endMs: 0 }],
            segments: [],
          },
        }) as never,
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "speech-invalid-result",
          invocationId: "asr-invocation-1",
          operation: {
            kind: "speech.transcribe",
            reference: audioReference,
            modelId: "iic/SenseVoiceSmall",
          },
        },
        asrContext(),
      ),
    ).rejects.toThrow(/ASR word endMs must be greater than startMs/i);
  });

  it("rejects a third-party plugin even when its manifest declares the Host tool", async () => {
    const thirdPartyManifest = ExecutablePluginManifestSchema.parse({
      ...asrManifest,
      id: "acme.asr",
      name: "Acme ASR",
    });
    let serviceCalled = false;
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      transcribeSpeech: async () => {
        serviceCalled = true;
        return { status: "completed", transcript: timedTranscript };
      },
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "speech-third-party",
          invocationId: "asr-invocation-1",
          operation: {
            kind: "speech.transcribe",
            reference: audioReference,
            modelId: "iic/SenseVoiceSmall",
          },
        },
        asrContext([audioReference], thirdPartyManifest),
      ),
    ).rejects.toThrow(/reserved for clash\.asr/i);
    expect(serviceCalled).toBe(false);
  });

  it("does not authorize a guessed reference by Asset id alone", async () => {
    let serviceCalled = false;
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      transcribeSpeech: async () => {
        serviceCalled = true;
        return { status: "completed", transcript: timedTranscript };
      },
    });

    await expect(
      broker(
        {
          protocol: "clash.plugin.broker-request/v1",
          requestId: "speech-guessed-reference",
          invocationId: "asr-invocation-1",
          operation: {
            kind: "speech.transcribe",
            reference: { ...audioReference, index: 1 },
            modelId: "iic/SenseVoiceSmall",
          },
        },
        asrContext(),
      ),
    ).rejects.toMatchObject({ code: "PLUGIN_REFERENCE_NOT_AUTHORIZED" });
    expect(serviceCalled).toBe(false);
  });
});
