import { describe, expect, it } from "vitest";

import { createProviderPluginExecutor } from "./provider-plugin-executor.js";
import type { ExecutablePluginInvocation } from "@clash/shared-types/executable-plugin";

/**
 * A plugin receives its credentials, and receives them bound to the account the host chose.
 *
 * The plugin used to read `process.env.CLASH_PROVIDER_API_KEY`. Nothing in this repository ever set
 * it -- one read site, zero writes -- so the executor path could not authenticate at all, and every
 * Google generation that appeared to work had gone through the host's own code instead.
 *
 * What replaced it is the account's own store, handed in already scoped to this plugin and this
 * account. The plugin cannot ask for another's, because the identity is not an argument it passes.
 *
 * This file used to assert that by reading `provider-plugin-executor.ts` and
 * `plugins/first-party-media/src/stdio.ts` as text and matching regexes against them. That broke
 * outright when first-party-media was deleted -- ENOENT on a source file, from a test whose subject
 * was the host, not the plugin. It also proved less than it appeared to: matching `/accountId/`
 * against a source file passes if the identifier occurs anywhere at all, including in a comment
 * saying it is not used. These drive the executor instead and read the frame it produced.
 */
interface CapturedCall {
  invocation: ExecutablePluginInvocation;
  options?: { timeoutMs?: number; accountId?: string };
}

function stubClient(captured: CapturedCall[]) {
  return {
    resolveBinding: async (pluginId: string, exportId: string) => ({
      pluginId,
      exportId,
      version: "0.1.0",
      schemaHash: `sha256:${"a".repeat(64)}` as const,
    }),
    invoke: async (
      _pluginId: string,
      invocation: ExecutablePluginInvocation,
      options?: { timeoutMs?: number; accountId?: string },
    ) => {
      captured.push({ invocation, options });
      return {
        protocol: "clash.plugin.result/v1" as const,
        invocationId: invocation.invocationId,
        status: "completed" as const,
        // A real media output, because the executor refuses a completed result that carries none.
        // The assertions below are about the frame the executor sent, so the reply only has to be
        // one the executor accepts.
        outputs: [
          {
            slot: "media" as const,
            kind: "asset" as const,
            asset: {
              assetId: "a-1",
              uri: "clash-asset://a-1",
              kind: "image" as const,
              mediaType: "image/png",
            },
          },
        ],
      };
    },
  };
}

const request = (over: Record<string, unknown> = {}) => ({
  pluginId: "clash.google",
  exportId: "google-execute",
  kind: "image",
  taskId: "t-1",
  projectId: "p-1",
  input: { values: { prompt: "a leaf" }, references: [] },
  ...over,
});

describe("executor store binding", () => {
  it("binds the chosen account in host invoke options, not plugin-visible values", async () => {
    const captured: CapturedCall[] = [];
    const execute = createProviderPluginExecutor({
      client: stubClient(captured),
    });

    await execute(request({ accountId: "acct-google-1" }) as never);

    expect(captured[0]?.options).toEqual({
      accountId: "acct-google-1",
    });
    expect(captured[0]?.invocation.input.values).not.toHaveProperty(
      "accountId",
    );
  });

  it("never serializes resolved credentials into the plugin invocation", async () => {
    const captured: CapturedCall[] = [];
    const execute = createProviderPluginExecutor({
      client: stubClient(captured),
    });

    await execute(
      request({
        accountId: "acct-google-1",
        credentials: { apiKey: "google-key" },
      }) as never,
    );

    expect(captured[0]?.invocation.input.values).not.toHaveProperty(
      "credentials",
    );
    expect(JSON.stringify(captured[0]?.invocation)).not.toContain("google-key");
  });

  it("drops account and credential fields forged inside caller values", async () => {
    const captured: CapturedCall[] = [];
    const execute = createProviderPluginExecutor({
      client: stubClient(captured),
    });

    await execute(
      request({
        accountId: "host-account",
        input: {
          values: {
            prompt: "a leaf",
            accountId: "forged-account",
            credentials: { apiKey: "forged-key" },
          },
          references: [],
        },
      }) as never,
    );

    expect(captured[0]?.options?.accountId).toBe("host-account");
    expect(captured[0]?.invocation.input.values).toEqual({
      prompt: "a leaf",
      kind: "image",
    });
  });

  it("binds submit and poll to the same host-selected account", async () => {
    const captured: CapturedCall[] = [];
    const execute = createProviderPluginExecutor({
      client: stubClient(captured),
    });

    await execute(
      request({
        taskId: "task-submit",
        accountId: "acct-google-1",
      }) as never,
    );
    await execute(
      request({
        taskId: "task-poll",
        accountId: "acct-google-1",
        pollState: { taskId: "upstream-task-1" },
      }) as never,
    );

    expect(captured.map(({ options }) => options?.accountId)).toEqual([
      "acct-google-1",
      "acct-google-1",
    ]);
    expect(captured[1]?.invocation).toMatchObject({
      operation: "poll",
      pollState: { taskId: "upstream-task-1" },
    });
  });
});
