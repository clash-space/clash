import { describe, expect, it, vi } from "vitest";

import { createBridgeProviderPluginProjector } from "./provider-plugin-projector";

describe("Bridge provider plugin projector", () => {
  it("resolves the active contract once and invokes the unified plugin ABI", async () => {
    const binding = {
      pluginId: "clash-first-party-media",
      version: "0.1.0",
      exportId: "fal-h3",
      schemaHash: `sha256:${"e".repeat(64)}`,
    } as const;
    const resolveBinding = vi.fn(async () => binding);
    const invoke = vi.fn(async (_pluginId: string, invocation: any) => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: invocation.invocationId,
      status: "completed" as const,
      outputs: [{
        slot: "projection",
        kind: "value" as const,
        value: { endpoint: "minimax/h3/text-to-video", input: { prompt: "hello" } },
      }],
    }));
    const projector = createBridgeProviderPluginProjector({ client: { resolveBinding, invoke } });

    await expect(projector({
      pluginId: binding.pluginId,
      exportId: binding.exportId,
      kind: "video",
      taskId: "task-1",
      projectId: "project-1",
      nodeId: "node-1",
      input: { values: { prompt: "hello" }, references: [] },
    })).resolves.toEqual({
      binding,
      projection: { endpoint: "minimax/h3/text-to-video", input: { prompt: "hello" } },
    });
    expect(resolveBinding).toHaveBeenCalledWith(
      "clash-first-party-media",
      "fal-h3",
      "provider-projector",
    );
    expect(invoke).toHaveBeenCalledWith(
      "clash-first-party-media",
      expect.objectContaining({
        protocol: "clash.plugin.invoke/v1",
        taskId: "task-1",
        projectId: "project-1",
        nodeId: "node-1",
        target: { ...binding, kind: "provider-projector" },
        actor: { kind: "system", id: "local-aigc" },
      }),
    );
  });

  it("uses an authored binding without silently resolving latest", async () => {
    const binding = {
      pluginId: "clash-first-party-media",
      version: "0.1.0",
      exportId: "fal-h3",
      schemaHash: `sha256:${"f".repeat(64)}`,
    } as const;
    const resolveBinding = vi.fn();
    const invoke = vi.fn(async (_pluginId: string, invocation: any) => ({
      protocol: "clash.plugin.result/v1" as const,
      invocationId: invocation.invocationId,
      status: "completed" as const,
      outputs: [{
        slot: "projection",
        kind: "value" as const,
        value: { endpoint: "minimax/h3/text-to-video", input: {} },
      }],
    }));
    const projector = createBridgeProviderPluginProjector({ client: { resolveBinding, invoke } });

    await projector({
      pluginId: binding.pluginId,
      exportId: binding.exportId,
      kind: "video",
      taskId: "task-2",
      projectId: "project-2",
      binding,
      input: { values: {}, references: [] },
    });

    expect(resolveBinding).not.toHaveBeenCalled();
    expect(invoke.mock.calls[0]?.[1]).toMatchObject({ target: { ...binding, kind: "provider-projector" } });
  });
});
