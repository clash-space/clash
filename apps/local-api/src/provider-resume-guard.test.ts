import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "local-processor.ts"), "utf8");

/**
 * Work already accepted must be polled, never submitted again.
 *
 * The node stays `generating` while the provider holds it, and `generating` is also what a node
 * looks like on the pass that started it. If the loop cannot tell those apart it resubmits on every
 * tick: the same prompt bought over and over, each copy racing the last, and the failure arrives as
 * a bill rather than an error.
 *
 * The custom-action path already guards this way -- `if (data.pendingTask) return null` -- so a task
 * that has been handed out is not handed out twice. Provider generations need the same guard for
 * the same reason.
 */
describe("an accepted generation is resumed, not resubmitted", () => {
  it("stores the poll state on the node when the provider accepts", () => {
    // Reading it back is worthless if nothing ever wrote it: the loop would resubmit forever and
    // every assertion about resuming would still pass. This is the write half.
    expect(source).toMatch(/providerPollState:\s*generated\.pollState/);
  });

  it("reads stored poll state back out and hands it to the provider", () => {
    // Storing it is half the job. Asserting only that the word appears would pass on the write
    // alone, which is exactly the state this file was in when the assertion was first written.
    expect(source).toMatch(/pollState:\s*(data\.)?providerPollState/);
  });

  it("sends poll state only when resuming, and the plain input otherwise", () => {
    // A submit that carries poll state is rejected by the invocation schema, and a resume that
    // omits it silently starts a second billed generation. The branch has to exist.
    expect(source).toMatch(
      /\?[\s\S]{0,80}pollState[\s\S]{0,80}:[\s\S]{0,40}commonInput/,
    );
  });
});
