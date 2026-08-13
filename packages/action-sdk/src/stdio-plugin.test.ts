import { describe, expect, it, vi } from "vitest";
import { PassThrough } from "node:stream";

import { defineStdioExecutablePlugin } from "./stdio-plugin";
import { ProviderExecutionError } from "./executable-failure";

/**
 * The transport belongs to the SDK. A stdio author previously hand-wrote the loop — `createInterface`,
 * `JSON.parse(line)`, `process.stdout.write(JSON.stringify(result) + "\n")` — once per plugin.
 * first-party-media and codex-imagegen each carry their own copy, and they already differ: one
 * answers malformed input by writing a failure frame, the other by constructing a sentinel object
 * and letting the handler deal with it.
 *
 * Every such copy is a place the framing can drift, and framing is exactly what a plugin author
 * should never have to think about.
 */
function run(handlers: Parameters<typeof defineStdioExecutablePlugin>[0], lines: string[]) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const written: string[] = [];
  stdout.on("data", (chunk: Buffer) => written.push(chunk.toString("utf8")));
  const plugin = defineStdioExecutablePlugin(handlers, { stdin, stdout });
  for (const line of lines) stdin.write(`${line}\n`);
  stdin.end();
  return { written, plugin };
}

const invocation = (exportId: string, invocationId = "i-1") => JSON.stringify({
  protocol: "clash.plugin.invoke/v1",
  invocationId,
  taskId: "t-1",
  projectId: "p-1",
  nodeId: "n-1",
  target: {
    pluginId: "test.plugin",
    version: "1.0.0",
    schemaHash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    exportId,
    kind: "provider-executor",
  },
  operation: "submit",
  input: { values: {}, references: [] },
  actor: { kind: "agent" },
});

const pollInvocation = (exportId: string, invocationId = "i-poll") => {
  const submitted = JSON.parse(invocation(exportId, invocationId));
  return JSON.stringify({
    ...submitted,
    operation: "poll",
    pollState: { taskId: "accepted-task" },
  });
};

const callbackInvocation = (exportId: string, invocationId = "i-callback") => {
  const submitted = JSON.parse(invocation(exportId, invocationId));
  return JSON.stringify({
    ...submitted,
    operation: "callback",
    callbackPayload: { taskId: "accepted-task", status: "done" },
  });
};

describe("defineStdioExecutablePlugin", () => {
  it("routes a line to the handler named by the invocation", async () => {
    const handler = vi.fn(async () => ({ status: "completed" as const, outputs: [] })) as never;
    const { written, plugin } = run({ "x-execute": handler }, [invocation("x-execute")]);
    await plugin.done;
    expect(handler).toHaveBeenCalledOnce();
    expect(written.join("")).toContain("completed");
  });

  it("answers one frame per line, terminated by a newline", async () => {
    const handler = vi.fn(async () => ({ status: "completed" as const, outputs: [] })) as never;
    const { written, plugin } = run(
      { "x-execute": handler },
      [invocation("x-execute", "i-1"), invocation("x-execute", "i-2")],
    );
    await plugin.done;
    const frames = written.join("").split("\n").filter(Boolean);
    expect(frames).toHaveLength(2);
  });

  it("reports malformed input as a failure rather than crashing the process", async () => {
    // A plugin that dies on one bad line takes every queued generation with it.
    const { written, plugin } = run({ "x-execute": vi.fn() }, ["{not json"]);
    await plugin.done;
    expect(written.join("")).toContain("failed");
  });

  it("reports an unknown export instead of answering silently", async () => {
    const { written, plugin } = run({ "x-execute": vi.fn() }, [invocation("nope")]);
    await plugin.done;
    expect(written.join("")).toMatch(/nope/);
  });

  it("does not forget known acceptance when a callback names no handler", async () => {
    const { written, plugin } = run(
      { "x-execute": vi.fn() },
      [callbackInvocation("missing-execute")],
    );
    await plugin.done;

    expect(JSON.parse(written.join(""))).toMatchObject({
      status: "failed",
      error: {
        code: "contract_violation",
        retryable: false,
        requestState: "accepted",
      },
    });
  });

  it("keeps answering after a handler throws", async () => {
    const handlers = {
      "x-execute": vi.fn(async (inv: { invocationId: string }) => {
        if (inv.invocationId === "i-1") throw new Error("upstream refused");
        return { status: "completed" as const, outputs: [] };
      }),
    };
    const { written, plugin } = run(
      handlers as never,
      [invocation("x-execute", "i-1"), invocation("x-execute", "i-2")],
    );
    await plugin.done;
    const frames = written.join("").split("\n").filter(Boolean);
    // Two answers, matched by id rather than by order: invocations finish when they finish, and
    // asserting arrival order would make this pass or fail on timing rather than on behaviour.
    expect(frames).toHaveLength(2);
    const byId = Object.fromEntries(frames.map((f) => {
      const parsed = JSON.parse(f) as { invocationId: string };
      return [parsed.invocationId, f];
    }));
    expect(JSON.parse(byId["i-1"]!)).toMatchObject({
      status: "failed",
      error: {
        code: "execution_failed",
        message: "upstream refused",
        retryable: false,
        requestState: "unknown",
      },
    });
    expect(byId["i-2"]).toContain("completed");
  });

  it("does not forget known acceptance when polling throws", async () => {
    const handler = vi.fn(async () => { throw new Error("poll failed"); });
    const { written, plugin } = run({ "x-execute": handler as never }, [pollInvocation("x-execute")]);
    await plugin.done;

    expect(JSON.parse(written.join(""))).toMatchObject({
      status: "failed",
      error: { requestState: "accepted" },
    });
  });

  it("keeps a submit transport failure retryable without claiming rejection", async () => {
    const transportFailure = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNRESET" },
    });
    const handler = vi.fn(async () => { throw transportFailure; });
    const { written, plugin } = run({ "x-execute": handler as never }, [invocation("x-execute")]);
    await plugin.done;

    expect(JSON.parse(written.join(""))).toMatchObject({
      status: "failed",
      error: {
        code: "transport_error",
        retryable: true,
        requestState: "unknown",
      },
    });
  });

  it("preserves an explicit preflight rejection from the executor", async () => {
    const handler = vi.fn(async () => {
      throw new ProviderExecutionError({
        code: "invalid_request",
        message: "unsupported model",
        retryable: false,
        requestState: "rejected",
      });
    });
    const { written, plugin } = run({ "x-execute": handler as never }, [invocation("x-execute")]);
    await plugin.done;

    expect(JSON.parse(written.join(""))).toMatchObject({
      status: "failed",
      error: {
        code: "invalid_request",
        retryable: false,
        requestState: "rejected",
      },
    });
  });

  it("does not retry an ambiguous handler abort as a transport timeout", async () => {
    const aborted = Object.assign(new Error("cancelled by handler"), { name: "AbortError" });
    const handler = vi.fn(async () => { throw aborted; });
    const { written, plugin } = run({ "x-execute": handler as never }, [invocation("x-execute")]);
    await plugin.done;

    expect(JSON.parse(written.join(""))).toMatchObject({
      status: "failed",
      error: {
        code: "execution_failed",
        retryable: false,
        requestState: "unknown",
      },
    });
  });
});
