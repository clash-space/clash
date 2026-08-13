import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
} from "@clash/shared-types";

import { PluginStdioSession } from "./plugin-stdio-runner.js";

const manifest = ExecutablePluginManifestSchema.parse({
  apiVersion: "clash.plugin/v1",
  id: "test.account-session",
  version: "1.0.0",
  name: "Account session",
  runtime: {
    kind: "local",
    transport: "stdio",
    entrypoint: "dist/stdio.mjs",
  },
  contributes: {
    functions: [{
      id: "execute",
      kind: "provider-executor",
      operations: ["submit", "poll"],
    }],
  },
});

const invocation = ExecutablePluginInvocationSchema.parse({
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
  input: {
    values: { accountId: "forged-account" },
    references: [],
  },
  actor: { kind: "system", id: "test" },
});

describe("stdio plugin Host account scope", () => {
  it("binds broker requests to the account saved with the pending invocation", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const broker = vi.fn(async (_request: unknown, _context: unknown) => ({
      value: "host-key",
    }));
    const session = new PluginStdioSession({
      manifest,
      stdin,
      stdout,
      broker,
    });

    const completed = session.invoke(invocation, {
      timeoutMs: 1_000,
      accountId: "host-account",
    });
    stdout.write(`${JSON.stringify({
      protocol: "clash.plugin.broker-request/v1",
      requestId: "broker-1",
      invocationId: invocation.invocationId,
      operation: { kind: "store.get", key: "apiKey" },
    })}\n`);

    await vi.waitFor(() => expect(broker).toHaveBeenCalledOnce());
    expect(broker.mock.calls[0]?.[1]).toMatchObject({
      accountId: "host-account",
      invocation: {
        input: { values: { accountId: "forged-account" } },
      },
    });

    stdout.write(`${JSON.stringify({
      protocol: "clash.plugin.result/v1",
      invocationId: invocation.invocationId,
      status: "completed",
      outputs: [{ slot: "text", kind: "value", value: "done" }],
    })}\n`);
    await expect(completed).resolves.toMatchObject({ status: "completed" });
    session.close();
  });

  it("ignores an invalid result for an invocation that is no longer pending", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const session = new PluginStdioSession({
      manifest,
      stdin,
      stdout,
      broker: vi.fn(),
    });

    const completed = session.invoke(invocation, { timeoutMs: 1_000 });
    stdout.write(`${JSON.stringify({
      protocol: "clash.plugin.result/v1",
      invocationId: "already-finished",
      status: "failed",
      error: { code: "execution_failed", message: "late failure", retryable: false },
    })}\n`);
    stdout.write(`${JSON.stringify({
      protocol: "clash.plugin.result/v1",
      invocationId: invocation.invocationId,
      status: "completed",
      outputs: [{ slot: "text", kind: "value", value: "done" }],
    })}\n`);

    await expect(completed).resolves.toMatchObject({ status: "completed" });
    session.close();
  });

  it("rejects the pending invocation when its result violates the plugin protocol", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const session = new PluginStdioSession({
      manifest,
      stdin,
      stdout,
      broker: vi.fn(),
    });

    const completed = session.invoke(invocation, { timeoutMs: 1_000 });
    stdout.write(`${JSON.stringify({
      protocol: "clash.plugin.result/v1",
      invocationId: invocation.invocationId,
      status: "failed",
      error: { code: "execution_failed", message: "invalid failure", retryable: false },
    })}\n`);

    await expect(completed).rejects.toThrow(/invalid result.*invocation-1/i);
    session.close();
  });
});
