import { describe, expect, it } from "vitest";

import { ExecutablePluginFunctionExportSchema } from "./executable-plugin";

const poller = {
  id: "hub-execute",
  kind: "provider-executor" as const,
  handler: "execute",
  operations: ["submit", "poll"] as ["submit", "poll"],
};

/**
 * An entry that can be polled declares what its provider's answers mean.
 *
 * The states are ours; the words are the provider's. Without the declaration each plugin ends up
 * enumerating privately what it recognises and treating everything else as still-running, which is
 * an unbounded wait for work that may already have died. Requiring it here means the gap is caught
 * at activation, on the machine of the author who can fix it, rather than in the middle of somebody
 * else's paid generation.
 */
describe("a pollable entry declares its status vocabulary", () => {
  it("accepts an entry that maps every state", () => {
    const parsed = ExecutablePluginFunctionExportSchema.parse({
      ...poller,
      statusMapping: {
        running: ["PROCESSING", "IN_QUEUE"],
        completed: ["SUCCESS"],
        failed: ["FAILED", "CANCELED"],
      },
    });
    expect(parsed.statusMapping?.completed).toEqual(["SUCCESS"]);
  });

  it("refuses a pollable entry with no mapping at all", () => {
    // The defect this exists to prevent: polling with nothing to read the answer against.
    expect(ExecutablePluginFunctionExportSchema.safeParse(poller).success).toBe(false);
  });

  it("leaves submit-only entries alone", () => {
    // Nothing is ever asked again, so there is no status to interpret. Demanding a vocabulary here
    // would be ceremony -- and ceremony is what gets filled in with a guess.
    const parsed = ExecutablePluginFunctionExportSchema.parse({
      id: "one-shot",
      kind: "provider-executor",
      handler: "run",
      operations: ["submit"],
    });
    expect(parsed.statusMapping).toBeUndefined();
  });

  it("refuses a mapping on an entry that cannot poll", () => {
    // A vocabulary that nothing reads is worse than none: it looks like the question was considered.
    expect(ExecutablePluginFunctionExportSchema.safeParse({
      id: "one-shot",
      kind: "provider-executor",
      handler: "run",
      operations: ["submit"],
      statusMapping: { running: ["X"], completed: ["Y"], failed: ["Z"] },
    }).success).toBe(false);
  });
});
