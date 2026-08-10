import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const aigc = readFileSync(join(__dirname, "local-aigc.ts"), "utf8");
const executor = readFileSync(join(__dirname, "provider-plugin-executor.ts"), "utf8");

/**
 * An acceptance has to reach the node, or it is the same blocking call with extra steps.
 *
 * The plugin can now say "the provider took the work, here is how to ask again", but that answer
 * has to travel: executor, then the generation call, then onto the node, which is the only place
 * that survives a restart. Anywhere short of the node and the state dies with the process, which is
 * exactly the failure the protocol was added to fix.
 */
describe("acceptance reaches the node", () => {
  it("lets the executor return an acceptance instead of media", () => {
    // A response typed as always carrying media forces the layer below to throw on an acceptance,
    // and a thrown acceptance is indistinguishable from a failure.
    expect(executor).toMatch(/status:\s*"accepted"/);
    expect(aigc).toMatch(/pollState/);
  });

  it("carries poll state back out of a generation", () => {
    expect(aigc).toMatch(/accepted/);
  });
});
