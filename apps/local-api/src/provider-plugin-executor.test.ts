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
      invoke: async (_pluginId, invocation) => ({
        protocol: "clash.plugin.result/v1" as const,
        invocationId: invocation.invocationId,
        status: "completed" as const,
        outputs,
      } as never),
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
  it("invokes a pinned provider executor and validates its media result", async () => {
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
      outputs: [{
        slot: "media",
        kind: "value" as const,
        value: {
          url: "https://hub-cdn.test/h3.mp4",
          contentType: "video/mp4",
          requestId: "hub-task-1",
        },
      }],
    }));
    const executor = createProviderPluginExecutor({ client: { resolveBinding, invoke } });

    await expect(executor({
      pluginId: binding.pluginId,
      exportId: binding.exportId,
      kind: "video",
      taskId: "task-1",
      projectId: "project-1",
      nodeId: "node-1",
      binding,
      input: { values: { modelId: "minimax-h3" }, references: [] },
    })).resolves.toEqual({
      // A completed response now says so: the same call may instead come back accepted, and a
      // caller that cannot tell them apart would read media that is not there.
      status: "completed",
      binding,
      media: {
        url: "https://hub-cdn.test/h3.mp4",
        contentType: "video/mp4",
        requestId: "hub-task-1",
      },
    });
    expect(resolveBinding).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "hilo.hub-media",
      expect.objectContaining({
        target: { ...binding, kind: "provider-executor" },
        input: { values: { modelId: "minimax-h3", kind: "video" }, references: [] },
      }),
      { timeoutMs: 30 * 60_000 },
    );
  });

  it("returns a text value without treating it as a media URL", async () => {
    const executor = executorReturning([{
      slot: "text",
      kind: "value",
      value: "M3 says hello.",
    }]);

    await expect(executor(textRequest())).resolves.toEqual({
      status: "completed",
      binding: textBinding,
      output: { slot: "text", kind: "value", value: "M3 says hello." },
    });
  });

  it("rejects an empty or non-text value in the text slot", async () => {
    await expect(executorReturning([{
      slot: "text",
      kind: "value",
      value: "   ",
    }])(textRequest())).rejects.toThrow(/clash\.minimax.*text.*non-empty/i);

    await expect(executorReturning([{
      slot: "text",
      kind: "value",
      value: { url: "https://example.test/not-text" },
    }])(textRequest())).rejects.toThrow(/clash\.minimax.*text/i);
  });

  it("rejects multiple conflicting text outputs", async () => {
    await expect(executorReturning([
      { slot: "text", kind: "value", value: "first" },
      { slot: "text", kind: "value", value: "second" },
    ])(textRequest())).rejects.toThrow(/clash\.minimax.*2.*text/i);
  });

  it("rejects a text slot for a media route", async () => {
    await expect(executorReturning([{
      slot: "text",
      kind: "value",
      value: "wrong kind",
    }])(textRequest("video"))).rejects.toThrow(/clash\.minimax.*text.*video/i);
  });

  it("rejects media output for a text route", async () => {
    await expect(executorReturning([{
      slot: "media",
      kind: "value",
      value: { url: "https://example.test/not-text.mp4", contentType: "video/mp4" },
    }])(textRequest())).rejects.toThrow(/clash\.minimax.*no canonical.*text/i);
  });

  it("rejects an asset whose kind does not match the media route", async () => {
    await expect(executorReturning([{
      slot: "media",
      kind: "asset",
      asset: {
        assetId: "wrong-kind",
        uri: "clash-asset://wrong-kind",
        kind: "image",
        mediaType: "image/png",
        url: "https://example.test/wrong.png",
        reach: "public",
      },
    }])(textRequest("video"))).rejects.toThrow(/clash\.minimax.*media.*image.*video/i);
  });

  it("rejects a media type whose family does not match the media route", async () => {
    await expect(executorReturning([{
      slot: "media",
      kind: "asset",
      asset: {
        assetId: "wrong-mime",
        uri: "clash-asset://wrong-mime",
        kind: "video",
        mediaType: "image/png",
        url: "https://example.test/wrong.mp4",
        reach: "public",
      },
    }])(textRequest("video"))).rejects.toThrow(/clash\.minimax.*image\/png.*video/i);
  });
});
