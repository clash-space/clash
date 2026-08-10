import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const aigc = readFileSync(join(__dirname, "local-aigc.ts"), "utf8");
const executor = readFileSync(join(__dirname, "provider-plugin-executor.ts"), "utf8");

/**
 * Poll state has to survive every hop, and a break anywhere looks like success.
 *
 * It is written onto the node, read back on the next tick, put into a generation input, forwarded
 * into an executor request, and finally placed on the invocation the plugin receives. Miss one hop
 * and nothing reports an error: the plugin sees a submission, the provider starts the work over,
 * and the node is updated with a new task id as though everything worked.
 *
 * That is not hypothetical. This exact hop -- generation input into executor request -- was missing,
 * and a real restart during a real generation resubmitted to MiniMax and was billed twice. The node
 * showed `generating` throughout, with a task id that had quietly changed.
 */
describe("poll state survives every hop", () => {
  it("reaches the executor request from the generation input", () => {
    expect(aigc).toMatch(/pollState:\s*input\.pollState/);
  });

  it("reaches the invocation from the executor request", () => {
    expect(executor).toMatch(/pollState:\s*request\.pollState/);
  });

  it("switches the invocation to poll when it is present", () => {
    // Sending poll state on a submit is refused by the schema, so a hop that forwards the state
    // without the operation fails loudly rather than silently resubmitting.
    expect(executor).toMatch(/operation:\s*"poll"/);
  });
});
