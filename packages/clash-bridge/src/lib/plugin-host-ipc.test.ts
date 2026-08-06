import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PluginHostClient,
  startPluginHostIpcServer,
} from "./plugin-host-ipc";

describe("Bridge plugin host IPC", () => {
  it("resolves and invokes an exact executable-plugin binding over a local socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-plugin-ipc-"));
    const socketPath = join(root, "plugin-host.sock");
    const binding = {
      pluginId: "first-party-media",
      version: "1.2.3",
      exportId: "fal-h3",
      schemaHash: `sha256:${"d".repeat(64)}`,
    } as const;
    const cards = [{
      pluginId: "first-party-media",
      version: "1.2.3",
      schemaHash: binding.schemaHash,
      runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "handler.mjs", args: [] },
      permissions: { network: { domains: [] }, secrets: [], assets: [], hostTools: [], filesystem: { read: [], write: [] }, externalWrites: false },
      document: {
        apiVersion: "clash.card/v1" as const,
        kind: "action-card" as const,
        spec: {
          id: "caption-helper",
          name: "Caption Helper",
          outputType: "text" as const,
          parameters: [],
          input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text" as const] },
          functionExportId: "caption-helper",
        },
      },
    }];
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
    const server = await startPluginHostIpcServer({
      socketPath,
      host: {
        listCards: () => cards,
        resolveBinding: () => binding,
        invoke,
      },
    });
    const client = new PluginHostClient({ socketPath });

    try {
      await expect(client.listCards()).resolves.toMatchObject(cards);
      await expect(client.resolveBinding(
        "first-party-media",
        "fal-h3",
        "provider-projector",
      )).resolves.toEqual(binding);
      const invocation = {
        protocol: "clash.plugin.invoke/v1" as const,
        invocationId: "invocation-ipc-1",
        taskId: "task-ipc-1",
        projectId: "project-ipc-1",
        target: { ...binding, kind: "provider-projector" as const },
        input: { values: { prompt: "hello" }, references: [] },
        actor: { kind: "agent" as const, id: "agent-1" },
      };
      await expect(client.invoke("first-party-media", invocation)).resolves.toMatchObject({
        invocationId: "invocation-ipc-1",
        status: "completed",
      });
      expect(invoke).toHaveBeenCalledWith("first-party-media", invocation, {});
      if (process.platform !== "win32") {
        expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await server.close();
    }
  });

  it("returns structured errors instead of crashing the Bridge server", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-plugin-ipc-errors-"));
    const socketPath = join(root, "plugin-host.sock");
    const server = await startPluginHostIpcServer({
      socketPath,
      host: {
        listCards: () => [],
        resolveBinding: () => {
          throw new Error("plugin is not installed");
        },
        invoke: async () => {
          throw new Error("must not invoke");
        },
      },
    });
    const client = new PluginHostClient({ socketPath });
    try {
      await expect(client.resolveBinding("missing", "project", "provider-projector"))
        .rejects.toThrow("plugin is not installed");
    } finally {
      await server.close();
    }
  });

  it("keeps the IPC socket alive for the invocation-specific runtime timeout", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-plugin-ipc-timeout-"));
    const socketPath = join(root, "plugin-host.sock");
    const binding = {
      pluginId: "slow-imagegen",
      version: "1.0.0",
      exportId: "generate",
      schemaHash: `sha256:${"e".repeat(64)}`,
    } as const;
    const server = await startPluginHostIpcServer({
      socketPath,
      host: {
        listCards: () => [],
        resolveBinding: () => binding,
        invoke: async (_pluginId, invocation: any) => {
          await new Promise((resolve) => setTimeout(resolve, 30));
          return {
            protocol: "clash.plugin.result/v1" as const,
            invocationId: invocation.invocationId,
            status: "completed" as const,
            outputs: [],
          };
        },
      },
    });
    const client = new PluginHostClient({ socketPath, timeoutMs: 10 });
    try {
      await expect(client.invoke("slow-imagegen", {
        protocol: "clash.plugin.invoke/v1",
        invocationId: "slow-invocation",
        taskId: "slow-task",
        projectId: "slow-project",
        target: { ...binding, kind: "action" },
        input: { values: {}, references: [] },
        actor: { kind: "user" },
      }, { timeoutMs: 100 })).resolves.toMatchObject({ status: "completed" });
    } finally {
      await server.close();
    }
  });
});
