import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sync = readFileSync(join(__dirname, "sync.ts"), "utf8");

/**
 * Something has to come back and ask again.
 *
 * Pending work runs when the document changes or a room loads. That was sufficient while a
 * generation was one long await: the call that started the work also finished it, and no later
 * visit was needed.
 *
 * Splitting submit from poll removed the only thing that would return. A node can now sit at
 * `generating` with poll state recorded and a due time long past, and nothing will look at it,
 * because nothing edited the document. Measured on a real generation: the due time was ten minutes
 * stale and the status had not moved.
 *
 * The consequence is worse than a stall. The work finishes upstream, is paid for, and is never
 * collected.
 */
describe("polling is driven by a clock, not only by edits", () => {
  it("schedules a later pass", () => {
    expect(sync).toMatch(/setTimeout|setInterval/);
  });

  it("wakes for the node that is due soonest", () => {
    // A fixed tick either wastes requests on providers that asked for a long interval, or ignores
    // the one that asked for a short one.
    expect(sync).toMatch(/providerPollAt/);
  });
});
