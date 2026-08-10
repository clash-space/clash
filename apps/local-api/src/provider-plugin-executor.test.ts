import { describe, expect, it, vi } from "vitest";

import { createBridgeProviderPluginExecutor } from "./provider-plugin-executor";

describe("Bridge provider plugin executor", () => {
  it("invokes a pinned provider executor and validates its media result", async () => {
    const binding = {
      pluginId: "hilo-hub-media",
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
    const executor = createBridgeProviderPluginExecutor({ client: { resolveBinding, invoke } });

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
      binding,
      media: {
        url: "https://hub-cdn.test/h3.mp4",
        contentType: "video/mp4",
        requestId: "hub-task-1",
      },
    });
    expect(resolveBinding).not.toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith(
      "hilo-hub-media",
      expect.objectContaining({
        target: { ...binding, kind: "provider-executor" },
        input: { values: { modelId: "minimax-h3" }, references: [] },
      }),
      { timeoutMs: 30 * 60_000 },
    );
  });
});
