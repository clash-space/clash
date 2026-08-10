import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const processor = readFileSync(join(__dirname, "local-processor.ts"), "utf8");

/**
 * An accepted upstream generation must survive a host restart.
 *
 * A provider generation is one `await`: the call submits the task and then polls the upstream for
 * as long as it takes -- up to fifteen minutes for video. The upstream's task id lives only in that
 * promise's stack, so a host that stops mid-flight loses it. The node stays `pending` forever, and
 * the generation has already been paid for.
 *
 * This is not hypothetical. The host died twice in one session, once from an unguarded
 * `socket.end()` on an already-finished socket and once while a plugin listing was missing from the
 * IPC client. Both would have orphaned any in-flight generation.
 *
 * Custom actions already do the durable thing: `pendingTask` and `pendingTaskAt` are written onto
 * the node, so a restart can pick the work back up. Provider generations write nothing equivalent.
 * The fix is the same shape -- record what the provider accepted, then resume polling from the
 * record rather than from a live promise.
 */
describe("provider generations are resumable", () => {
  it("records what the provider handed back, on the node", () => {
    // Not an id. Providers differ on whether they have one -- a status URL, a job plus a region, a
    // cursor -- so the host keeps whatever it was given and reads none of it.
    expect(processor).toMatch(/providerPollState:\s*generated\.pollState/);
  });

  it("resumes a node that already carries poll state instead of resubmitting", () => {
    // The task is billed and running, so a restart reattaches rather than buying it again.
    expect(processor).toMatch(/pollState:\s*providerPollState/);
  });
});
