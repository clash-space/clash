import { describe, expect, it, vi } from "vitest";

import { handleInvocation } from "./stdio";

/**
 * Executors reach the network, so the entry point has to be able to wait for one.
 *
 * The dispatcher was synchronous because projection is pure arithmetic on a Card's parameters --
 * nothing to await. An executor submits a job and reads a status, so a synchronous entry point
 * cannot serve one at all.
 *
 * Kept as one entry rather than two. The invocation already names its target's kind, and a second
 * process would double the activation surface for a difference the protocol has no opinion about.
 */
describe("executor dispatch", () => {
  const invocation = (exportId: string, extra: Record<string, unknown> = {}) => ({
    protocol: "clash.plugin.invoke/v1",
    invocationId: "inv-1",
    taskId: "task-1",
    projectId: "proj-1",
    target: {
      pluginId: "clash-first-party-media",
      version: "0.4.1",
      exportId,
      schemaHash: `sha256:${"a".repeat(64)}`,
      kind: "provider-executor",
    },
    input: { values: {}, references: [] },
    actor: { kind: "system" as const },
    ...extra,
  });

  it("awaits an executor rather than returning before it answers", async () => {
    const result = await handleInvocation(invocation("fal-execute"), {
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ request_id: "req-9" }),
      })) as never,
      apiKey: "k",
      endpoint: "fal-ai/test",
    });
    expect(result.status).toBe("accepted");
    if (result.status !== "accepted") throw new Error("expected accepted");
    expect(result.pollState).toMatchObject({ requestId: "req-9" });
  });

  it("still answers a projection without touching the network", async () => {
    // Projectors must not regress into needing a fetch they never used.
    const result = await handleInvocation({
      ...invocation("fal-h3"),
      target: { ...invocation("fal-h3").target, kind: "provider-projector" },
      input: { values: { prompt: "hi", modelId: "minimax-h3" }, references: [] },
    });
    expect(result.status).toBe("completed");
  });

  it("reports an unknown export as a failure, not a crash", async () => {
    const result = await handleInvocation(invocation("nope"));
    expect(result.status).toBe("failed");
  });
});
