import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  PluginHostClient,
  pluginHostSocketPath,
  startPluginHostIpcServer,
} from "./plugin-host-ipc";

describe("local plugin host IPC", () => {
  it("maps a long config directory to a reachable short Unix socket", async () => {
    if (process.platform === "win32") return;

    const root = await mkdtemp(join(tmpdir(), "clash-plugin-ipc-long-"));
    const configDir = join(root, "deep-workspace-segment".repeat(6));
    const socketPath = pluginHostSocketPath({}, configDir);

    expect(Buffer.byteLength(socketPath)).toBeLessThanOrEqual(96);
    expect(socketPath.startsWith(configDir)).toBe(false);

    const server = await startPluginHostIpcServer({
      socketPath,
      host: {
        listCards: () => [],
        resolveBinding: () => {
          throw new Error("not used");
        },
        invoke: async () => {
          throw new Error("not used");
        },
      },
    });
    try {
      await expect(new PluginHostClient({ socketPath }).listCards()).resolves.toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("serializes concurrent startup for one socket without unlinking the live owner", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-plugin-ipc-concurrent-"));
    const socketPath = join(root, "host.sock");
    const host = {
      listCards: () => [],
      resolveBinding: () => {
        throw new Error("not used");
      },
      invoke: async () => {
        throw new Error("not used");
      },
    };

    const attempts = await Promise.allSettled(
      Array.from({ length: 8 }, () => startPluginHostIpcServer({ host, socketPath })),
    );
    const owners = attempts.filter(
      (attempt): attempt is PromiseFulfilledResult<Awaited<ReturnType<typeof startPluginHostIpcServer>>> =>
        attempt.status === "fulfilled",
    );
    const rejected = attempts.filter(
      (attempt): attempt is PromiseRejectedResult => attempt.status === "rejected",
    );

    try {
      expect(
        owners,
        rejected.map((attempt) => String(attempt.reason)).join("\n"),
      ).toHaveLength(1);
      expect(rejected).toHaveLength(7);
      for (const attempt of rejected) {
        expect(attempt.reason).toMatchObject({ code: "EADDRINUSE" });
      }
      await expect(new PluginHostClient({ socketPath }).listCards()).resolves.toEqual([]);
      if (process.platform !== "win32") {
        expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await Promise.all(owners.map(({ value }) => value.close()));
    }
  });

  it("resolves and invokes an exact executable-plugin binding over a local socket", async () => {
    const root = await mkdtemp(join(tmpdir(), "clash-plugin-ipc-"));
    const socketPath = join(root, "plugin-host.sock");
    const binding = {
      pluginId: "clash.media",
      version: "1.2.3",
      exportId: "fal-h3",
      schemaHash: `sha256:${"d".repeat(64)}`,
    } as const;
    const cards = [{
      pluginId: "clash.media",
      version: "1.2.3",
      schemaHash: binding.schemaHash,
      runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "handler.mjs", args: [] },
      document: {
        apiVersion: "clash.card/v1" as const,
        kind: "action-card" as const,
        spec: {
          id: "caption-helper",
          name: "Caption Helper",
          outputType: "text" as const,
          parameters: [],
          presentation: { type: "form" as const },
          input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text" as const] },
          functionExportId: "caption-helper",
        },
      },
    }];
    const providers = [{
      pluginId: "clash.media",
      version: "1.2.3",
      schemaHash: binding.schemaHash,
      runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "handler.mjs", args: [] },
      document: {
        apiVersion: "clash.provider/v1" as const,
        kind: "provider" as const,
        spec: {
          id: "hilo-hub",
          name: "MiniMax Hilo Hub",
          upstreamId: "hilo-hub",
          apiShape: "hilo-hub",
          executorExportId: "hilo-hub-execute",
          auth: {
            methods: [{
              id: "api-key",
              label: "API key",
              form: [{ kind: "field" as const, key: "apiKey", label: "API key", secret: true }],
            }],
          },
        },
      },
    }];
    const modelBindings = [{
      pluginId: "clash.media",
      version: "1.2.3",
      schemaHash: binding.schemaHash,
      runtime: { kind: "local" as const, transport: "stdio" as const, entrypoint: "handler.mjs", args: [] },
      document: {
        apiVersion: "clash.binding/v1" as const,
        kind: "model-provider-binding" as const,
        spec: {
          id: "hilo-hub-minimax-h3",
          modelId: "minimax-h3",
          providerId: "hilo-hub",
          upstreamId: "hilo-hub",
          upstreamModel: "MiniMax-H3",
          apiShape: "hilo-hub",
          executorExportId: "hilo-hub-execute",
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
        listProviders: () => providers,
        listModelBindings: () => modelBindings,
        resolveBinding: () => binding,
        invoke,
      },
    });
    const client = new PluginHostClient({ socketPath });

    try {
      await expect(client.listCards()).resolves.toMatchObject(cards);
      await expect((client as any).listProviders()).resolves.toMatchObject(providers);
      await expect((client as any).listModelBindings()).resolves.toMatchObject(modelBindings);
      await expect(client.resolveBinding(
        "clash.media",
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
        operation: "submit" as const,
      };
      await expect(client.invoke("clash.media", invocation, {
        accountId: "provider-account-7",
      })).resolves.toMatchObject({
        invocationId: "invocation-ipc-1",
        status: "completed",
      });
      // The host sees the parsed invocation, so schema defaults are present by the time it arrives.
      // `operation` defaults to submit: an entry that declares nothing gets the simplest contract.
      expect(invoke).toHaveBeenCalledWith(
        "clash.media",
        { ...invocation, operation: "submit" },
        { accountId: "provider-account-7" },
      );
      if (process.platform !== "win32") {
        expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
      }
    } finally {
      await server.close();
    }
  });

  it("returns structured errors instead of crashing the local host", async () => {
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
      pluginId: "test.slow-imagegen",
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
      await expect(client.invoke("test.slow-imagegen", {
        protocol: "clash.plugin.invoke/v1",
        invocationId: "slow-invocation",
        taskId: "slow-task",
        projectId: "slow-project",
        target: { ...binding, kind: "action" },
        input: { values: {}, references: [] },
        actor: { kind: "user" },
        operation: "submit" as const,
      }, { timeoutMs: 100 })).resolves.toMatchObject({ status: "completed" });
    } finally {
      await server.close();
    }
  });
});
