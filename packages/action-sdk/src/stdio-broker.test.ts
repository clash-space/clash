import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";

import { defineStdioExecutablePlugin } from "./stdio-plugin.js";

/**
 * The stdio layer is where a typed Host dependency becomes a frame and a frame becomes an answer.
 *
 * Plugin handlers never receive this raw operation transport. They receive store/reference/
 * asset/upload/hostTools methods, while this test verifies the private framing underneath.
 *
 * hrhrng.hub is the case: it reported "This MiniMax Hub account has no accessToken stored. Sign in,
 * or paste a token." The account was configured and the host was ready to answer; the frame was
 * never sent. Both messages describe the user's setup for a fault entirely inside ours.
 */
function conversation(
  handler: (
    frame: Record<string, unknown>,
  ) => Record<string, unknown> | undefined,
) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const results: Record<string, unknown>[] = [];

  stdout.on("data", (chunk: Buffer) => {
    for (const line of chunk.toString().split("\n")) {
      if (!line.trim()) continue;
      const frame = JSON.parse(line) as Record<string, unknown>;
      const reply = handler(frame);
      if (reply) stdin.write(`${JSON.stringify(reply)}\n`);
      else results.push(frame);
    }
  });

  return { stdin, stdout, results };
}

const invocation = JSON.stringify({
  protocol: "clash.plugin.invoke/v1",
  invocationId: "i-1",
  taskId: "t-1",
  projectId: "p-1",
  target: {
    pluginId: "test.broker",
    version: "0.1.0",
    schemaHash: `sha256:${"0".repeat(64)}`,
    exportId: "reads-a-key",
    kind: "provider-executor",
  },
  input: { values: {}, references: [] },
  actor: { kind: "system", id: "test" },
});

function invocationFor(invocationId: string): string {
  return JSON.stringify({
    ...(JSON.parse(invocation) as Record<string, unknown>),
    invocationId,
    taskId: `task-${invocationId}`,
  });
}

describe("stdio Host dependency transport", () => {
  it("keeps concurrent requests bound to the invocation that issued them", async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const brokerRequests: Array<{
      invocationId: string;
      operation: { key?: string };
      requestId: string;
    }> = [];
    const results: Record<string, unknown>[] = [];
    let buffered = "";

    stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line) as Record<string, unknown>;
        if (frame.protocol === "clash.plugin.broker-request/v1") {
          const request = frame as {
            invocationId: string;
            operation: { key?: string };
            requestId: string;
          };
          brokerRequests.push(request);
          stdin.write(
            `${JSON.stringify({
              protocol: "clash.plugin.broker-response/v1",
              requestId: request.requestId,
              status: "ok",
              result: { value: `value-for-${request.invocationId}` },
            })}\n`,
          );
        } else {
          results.push(frame);
        }
      }
    });

    let markSecondStarted!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const plugin = defineStdioExecutablePlugin(
      {
        "reads-a-key": async (current, context) => {
          if (current.invocationId === "invocation-first") {
            // Force the first Host request to start only after the second invocation is active.
            // A process-global currentInvocationId therefore misattributes this request deterministically.
            await secondStarted;
          } else {
            markSecondStarted();
          }
          await context.store.get(`key-for-${current.invocationId}`);
          return {
            invocationId: current.invocationId,
            status: "completed",
            outputs: [],
          } as never;
        },
      },
      { stdin, stdout },
    );

    stdin.write(`${invocationFor("invocation-first")}\n`);
    stdin.write(`${invocationFor("invocation-second")}\n`);
    await vi.waitFor(() => expect(results).toHaveLength(2));
    stdin.end();
    await plugin.done;

    expect(
      Object.fromEntries(
        brokerRequests.map((request) => [
          request.operation.key,
          request.invocationId,
        ]),
      ),
    ).toEqual({
      "key-for-invocation-first": "invocation-first",
      "key-for-invocation-second": "invocation-second",
    });
  });

  it("turns a typed store read into a frame and returns the host's answer", async () => {
    let seen: unknown;
    const { stdin, stdout, results } = conversation((frame) => {
      if (frame.protocol !== "clash.plugin.broker-request/v1") return undefined;
      const operation = frame.operation as { kind: string; key?: string };
      return {
        protocol: "clash.plugin.broker-response/v1",
        requestId: frame.requestId,
        status: "ok",
        result:
          operation.kind === "store.get" && operation.key === "apiKey"
            ? { value: "key-from-the-host" }
            : {},
      };
    });

    const plugin = defineStdioExecutablePlugin(
      {
        "reads-a-key": async (_invocation, context) => {
          seen = await context.store.get("apiKey");
          return {
            invocationId: "i-1",
            status: "completed",
            outputs: [],
          } as never;
        },
      },
      { stdin, stdout },
    );

    stdin.write(`${invocation}\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    stdin.end();
    await plugin.done;

    expect(seen).toBe("key-from-the-host");
    expect(results.at(-1)).toMatchObject({ status: "completed" });
  });

  it("reports an error answer rather than hanging", async () => {
    // A host that refuses is an answer. Leaving the promise pending would stall the invocation
    // until the host's own timeout, which names the plugin rather than the refusal.
    let message: string | undefined;
    const { stdin, stdout } = conversation((frame) => {
      if (frame.protocol !== "clash.plugin.broker-request/v1") return undefined;
      return {
        protocol: "clash.plugin.broker-response/v1",
        requestId: frame.requestId,
        status: "error",
        error: {
          code: "dependency_unavailable",
          message: "asset storage is unavailable",
        },
      };
    });

    const plugin = defineStdioExecutablePlugin(
      {
        "reads-a-key": async (_invocation, context) => {
          try {
            await context.store.get("apiKey");
          } catch (error) {
            message = (error as Error).message;
          }
          return {
            invocationId: "i-1",
            status: "completed",
            outputs: [],
          } as never;
        },
      },
      { stdin, stdout },
    );

    stdin.write(`${invocation}\n`);
    await new Promise((resolve) => setTimeout(resolve, 80));
    stdin.end();
    await plugin.done;

    expect(message).toContain("asset storage");
  });
});
