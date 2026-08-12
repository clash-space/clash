import { describe, expect, it, vi } from "vitest";

import {
  ExecutablePluginInvocationSchema,
  ExecutablePluginManifestSchema,
} from "@clash/shared-types";

import { createLocalExecutablePluginBroker } from "./local-plugin-broker.js";

const manifest = ExecutablePluginManifestSchema.parse({
  apiVersion: "clash.plugin/v1",
  id: "test.account-provider",
  version: "1.0.0",
  name: "Account provider",
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

function context(accountId?: string) {
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
        exportId: "execute",
        schemaHash: `sha256:${"a".repeat(64)}`,
        kind: "provider-executor",
      },
      input: {
        values: {
          accountId: "forged-account",
          credentials: { apiKey: "forged-key" },
        },
        references: [],
      },
      actor: { kind: "system", id: "test" },
    }),
    ...(accountId ? { accountId } : {}),
  };
}

function request(
  operation:
    | { kind: "store.get"; key: string }
    | { kind: "store.put"; key: string; value: string; secret?: boolean },
) {
  return {
    protocol: "clash.plugin.broker-request/v1" as const,
    requestId: "request-1",
    invocationId: "invocation-1",
    operation,
  };
}

describe("local plugin Host account scope", () => {
  it("refuses store access when the Host did not bind an account", async () => {
    const storeGet = vi.fn(async () => "must-not-be-read");
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      storeGet,
    });

    await expect(
      broker(request({ kind: "store.get", key: "apiKey" }), context()),
    ).rejects.toThrow(/host-selected provider account/i);
    expect(storeGet).not.toHaveBeenCalled();
  });

  it("uses the Host account and ignores forged invocation values", async () => {
    const storeGet = vi.fn(async () => "host-key");
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      storeGet,
    });

    await expect(
      broker(
        request({ kind: "store.get", key: "apiKey" }),
        context("host-account"),
      ),
    ).resolves.toEqual({ value: "host-key" });
    expect(storeGet).toHaveBeenCalledWith({
      pluginId: manifest.id,
      accountId: "host-account",
      key: "apiKey",
    });
  });

  it("reads initial credentials only from the Host-selected provider account", async () => {
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [
        {
          id: "host-account",
          providerId: "minimax",
          upstreamId: "minimax",
          enabled: true,
          credentials: { apiKey: "host-key" },
        },
        {
          id: "forged-account",
          providerId: "minimax",
          upstreamId: "minimax",
          enabled: true,
          credentials: { apiKey: "forged-key" },
        },
      ],
      storeGet: async () => undefined,
    });

    await expect(
      broker(
        request({ kind: "store.get", key: "apiKey" }),
        context("host-account"),
      ),
    ).resolves.toEqual({ value: "host-key" });
  });

  it("writes refreshed state only to the Host-selected account scope", async () => {
    const storePut = vi.fn(async () => undefined);
    const broker = createLocalExecutablePluginBroker({
      loadProviderAccounts: async () => [],
      storePut,
    });

    await expect(
      broker(
        request({
          kind: "store.put",
          key: "accessToken",
          value: "refreshed-token",
          secret: true,
        }),
        context("host-account"),
      ),
    ).resolves.toEqual({ ok: true });
    expect(storePut).toHaveBeenCalledWith({
      pluginId: manifest.id,
      accountId: "host-account",
      key: "accessToken",
      value: "refreshed-token",
      secret: true,
    });
  });
});
