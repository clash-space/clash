import { describe, expect, it, vi } from "vitest";

import { createProviderPluginExecutor } from "./provider-plugin-executor";

const textBinding = {
  pluginId: "clash.minimax",
  version: "1.0.0",
  exportId: "minimax-execute",
  schemaHash: `sha256:${"b".repeat(64)}`,
} as const;

function executorReturning(outputs: unknown[]) {
  return createProviderPluginExecutor({
    client: {
      resolveBinding: async () => textBinding,
      invoke: async (_pluginId, invocation) =>
        ({
          protocol: "clash.plugin.result/v1" as const,
          invocationId: invocation.invocationId,
          status: "completed" as const,
          outputs,
        }) as never,
    },
  });
}

const textRequest = (kind: "text" | "video" = "text") => ({
  pluginId: textBinding.pluginId,
  exportId: textBinding.exportId,
  kind,
  taskId: "task-text",
  projectId: "project-1",
  input: { values: { modelId: "minimax-m3" }, references: [] },
});

describe("provider plugin executor", () => {
  it("invokes a pinned provider executor and validates its typed Asset result", async () => {
    const binding = {
      pluginId: "hilo.hub-media",
      version: "1.0.0",
      exportId: "hilo-hub-execute",
      schemaHash: `sha256:${"a".repeat(64)}`,
    } as const;
    const resolveBinding = vi.fn();
    const invoke = vi.fn(async (_pluginId: string, invocation: any) => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: invocation.invocationId,
      status: "completed" as const,
      outputs: [
        {
          slot: "media",
          kind: "asset" as const,
          asset: {
            assetId: "plugin-output:hub-task-1",
            uri: "clash-asset://plugin-output:hub-task-1",
            kind: "video" as const,
            mediaType: "video/mp4",
          },
        },
      ],
    }));
    const executor = createProviderPluginExecutor({
      now: () => 100,
      client: { resolveBinding, invoke },
    });

    await expect(
      executor({
        pluginId: binding.pluginId,
        exportId: binding.exportId,
        kind: "video",
        taskId: "task-1",
        projectId: "project-1",
        nodeId: "node-1",
        binding,
        timeoutMs: 12_345,
        assetInputs: [{
          match: { kinds: ["image"], slots: ["startFrame"] },
          representations: ["provider-url", "bytes"],
          mediaTypes: ["image/png"],
        }],
        input: { values: { modelId: "minimax-h3" }, references: [] },
      } as never),
    ).resolves.toEqual({
      // A completed response now says so: the same call may instead come back accepted, and a
      // caller that cannot tell them apart would read media that is not there.
      status: "completed",
      binding,
      media: {
        assetId: "plugin-output:hub-task-1",
        uri: "clash-asset://plugin-output:hub-task-1",
        kind: "video",
        mediaType: "video/mp4",
      },
    });
    expect(resolveBinding).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "hilo.hub-media",
      expect.objectContaining({
        target: { ...binding, kind: "provider-executor" },
        input: {
          values: { modelId: "minimax-h3", kind: "video" },
          references: [],
        },
        assetInputs: [{
          match: { kinds: ["image"], slots: ["startFrame"] },
          representations: ["provider-url", "bytes"],
          mediaTypes: ["image/png"],
        }],
      }),
      { timeoutMs: 12_345 },
    );
  });

  it("accepts a Host-staged model output for Director generation", async () => {
    const executor = executorReturning([
      {
        slot: "media",
        kind: "asset",
        asset: {
          assetId: "plugin-output:model-1",
          uri: "clash-asset://plugin-output:model-1",
          kind: "model",
          mediaType: "model/gltf-binary",
        },
      },
    ]);

    await expect(
      executor({
        ...textRequest(),
        kind: "model",
      } as never),
    ).resolves.toEqual({
      status: "completed",
      binding: textBinding,
      media: {
        assetId: "plugin-output:model-1",
        uri: "clash-asset://plugin-output:model-1",
        kind: "model",
        mediaType: "model/gltf-binary",
      },
    });
  });

  it("does not cross the Provider submit boundary when poll capability cannot be preflighted", async () => {
    const invoke = vi.fn(async (_pluginId: string, invocation: any) => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: invocation.invocationId,
      status: "accepted" as const,
      pollState: { taskId: "already-billed-task" },
    }));
    const executor = createProviderPluginExecutor({
      client: {
        resolveBinding: async () => textBinding,
        listFunctionExports: async () => {
          throw new Error("plugin host restarted before reading the manifest");
        },
        invoke,
      },
    });

    await expect(executor(textRequest())).rejects.toThrow(
      /plugin host restarted before reading the manifest/i,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not grant submit a fresh timeout after poll-capability preflight consumes its budget", async () => {
    let now = 100;
    const invoke = vi.fn(async (_pluginId: string, invocation: any) => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: invocation.invocationId,
      status: "accepted" as const,
      pollState: { taskId: "must-not-submit" },
    }));
    const executor = createProviderPluginExecutor({
      now: () => now,
      client: {
        resolveBinding: async () => textBinding,
        listFunctionExports: async () => {
          now = 106;
          return [
            {
              id: textBinding.exportId,
              kind: "provider-executor" as const,
              operations: ["submit" as const, "poll" as const],
              requires: [],
            },
          ];
        },
        invoke,
      },
    });

    await expect(executor({ ...textRequest(), timeoutMs: 5 })).rejects.toThrow(
      /plugin invocation.*timed out.*before provider submit/i,
    );
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns a text value without treating it as a media URL", async () => {
    const executor = executorReturning([
      {
        slot: "text",
        kind: "value",
        value: "M3 says hello.",
      },
    ]);

    await expect(executor(textRequest())).resolves.toEqual({
      status: "completed",
      binding: textBinding,
      output: { slot: "text", kind: "value", value: "M3 says hello." },
    });
  });

  it("returns a structured provider failure without flattening it into Error", async () => {
    const error = {
      code: "execution_failed",
      message: "provider rejected the request",
      retryable: true,
      requestState: "rejected" as const,
      providerCode: "quota_exceeded",
      details: { limit: 10 },
    };
    const executor = createProviderPluginExecutor({
      client: {
        resolveBinding: async () => textBinding,
        invoke: async (_pluginId, invocation) =>
          ({
            protocol: "clash.plugin.result/v1" as const,
            invocationId: invocation.invocationId,
            status: "failed" as const,
            error,
          }) as never,
      },
    });

    await expect(executor(textRequest())).resolves.toEqual({
      status: "failed",
      binding: textBinding,
      error,
    });
  });

  it("rejects an empty or non-text value in the text slot", async () => {
    await expect(
      executorReturning([
        {
          slot: "text",
          kind: "value",
          value: "   ",
        },
      ])(textRequest()),
    ).rejects.toThrow(/clash\.minimax.*text.*non-empty/i);

    await expect(
      executorReturning([
        {
          slot: "text",
          kind: "value",
          value: { url: "https://example.test/not-text" },
        },
      ])(textRequest()),
    ).rejects.toThrow(/clash\.minimax.*text/i);
  });

  it("rejects multiple conflicting text outputs", async () => {
    await expect(
      executorReturning([
        { slot: "text", kind: "value", value: "first" },
        { slot: "text", kind: "value", value: "second" },
      ])(textRequest()),
    ).rejects.toThrow(/clash\.minimax.*2.*text/i);
  });

  it("rejects a text slot for a media route", async () => {
    await expect(
      executorReturning([
        {
          slot: "text",
          kind: "value",
          value: "wrong kind",
        },
      ])(textRequest("video")),
    ).rejects.toThrow(/clash\.minimax.*text.*video/i);
  });

  it("rejects media output for a text route", async () => {
    await expect(
      executorReturning([
        {
          slot: "media",
          kind: "value",
          value: {
            url: "https://example.test/not-text.mp4",
            contentType: "video/mp4",
          },
        },
      ])(textRequest()),
    ).rejects.toThrow(/clash\.minimax.*no canonical.*text/i);
  });

  it("rejects an asset whose kind does not match the media route", async () => {
    await expect(
      executorReturning([
        {
          slot: "media",
          kind: "asset",
          asset: {
            assetId: "wrong-kind",
            uri: "clash-asset://wrong-kind",
            kind: "image",
            mediaType: "image/png",
          },
        },
      ])(textRequest("video")),
    ).rejects.toThrow(/clash\.minimax.*media.*image.*video/i);
  });

  it("rejects a media type whose family does not match the media route", async () => {
    await expect(
      executorReturning([
        {
          slot: "media",
          kind: "asset",
          asset: {
            assetId: "wrong-mime",
            uri: "clash-asset://wrong-mime",
            kind: "video",
            mediaType: "image/png",
          },
        },
      ])(textRequest("video")),
    ).rejects.toThrow(/clash\.minimax.*image\/png.*video/i);
  });
});
