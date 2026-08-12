import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MINIMAX_DEFAULT_TIMEOUT_MS,
  plugin,
  startMiniMaxPlugin,
} from "./stdio.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MiniMax stdio timeout budget", () => {
  it("starts with a broker budget long enough for synchronous Music generation", async () => {
    const start = vi.spyOn(plugin, "start").mockResolvedValue(undefined);

    await startMiniMaxPlugin();

    expect(MINIMAX_DEFAULT_TIMEOUT_MS).toBe(30 * 60_000);
    expect(start).toHaveBeenCalledWith({ hostRequestTimeoutMs: 30 * 60_000 });
  });

  it("uses the explicit MiniMax timeout override for the stdio broker", async () => {
    const start = vi.spyOn(plugin, "start").mockResolvedValue(undefined);

    await startMiniMaxPlugin({}, { CLASH_MINIMAX_TIMEOUT_MS: "42000" });

    expect(start).toHaveBeenCalledWith({ hostRequestTimeoutMs: 42_000 });
  });

  it("rejects an invalid timeout before starting the plugin transport", async () => {
    const start = vi.spyOn(plugin, "start").mockResolvedValue(undefined);

    expect(() => startMiniMaxPlugin({}, { CLASH_MINIMAX_TIMEOUT_MS: "never" }))
      .toThrow("CLASH_MINIMAX_TIMEOUT_MS must be a positive integer");
    expect(start).not.toHaveBeenCalled();
  });

  it("keeps provider traffic outside the stdio broker timeout", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const results: Record<string, unknown>[] = [];

    vi.stubGlobal("fetch", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        text: async () => JSON.stringify({
          base_resp: { status_code: 0 },
          choices: [{ message: { content: "slow provider answer" } }],
        }),
      };
    });

    stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.protocol === "clash.plugin.broker-request/v1") {
          const operation = frame.operation as { kind?: string; key?: string };
          const stored: Record<string, string> = {
            apiKey: "test-key",
            service: "international",
          };
          stdin.write(`${JSON.stringify({
            protocol: "clash.plugin.broker-response/v1",
            requestId: frame.requestId,
            status: "ok",
            result: operation.kind === "store.get" && operation.key
              ? { value: stored[operation.key] }
              : {},
          })}\n`);
          continue;
        }
        results.push(frame);
      }
    });

    // The provider request takes 50ms while the broker budget is only 1ms. It still completes,
    // because vendor network traffic belongs to the plugin's ordinary fetch, not Clash's broker.
    const done = startMiniMaxPlugin({ stdin, stdout, hostRequestTimeoutMs: 1 });
    stdin.write(`${JSON.stringify({
      protocol: "clash.plugin.invoke/v1",
      invocationId: "slow-minimax-text",
      taskId: "task-1",
      projectId: "project-1",
      target: {
        pluginId: "clash.minimax",
        version: "0.1.0",
        schemaHash: `sha256:${"0".repeat(64)}`,
        exportId: "minimax-execute",
        kind: "provider-executor",
      },
      operation: "submit",
      input: {
        values: {
          kind: "text",
          modelId: "minimax-m3",
          upstreamModel: "MiniMax-M3",
          prompt: "wait for this",
        },
        references: [],
      },
      actor: { kind: "system", id: "test" },
    })}\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    stdin.end();
    await done;

    expect(results).toEqual([
      expect.objectContaining({
        protocol: "clash.plugin.result/v1",
        invocationId: "slow-minimax-text",
        status: "completed",
      }),
    ]);
  });
});
