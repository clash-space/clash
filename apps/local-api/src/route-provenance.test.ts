import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "local-processor.ts"), "utf8");

/**
 * A generated asset records which provider made it.
 *
 * A node carried modelId and nothing about the route, so an image could be produced by a provider
 * nobody selected and there was no way to find out afterwards. That is not hypothetical: a Google
 * account was configured, nano-banana-2 was requested, and hilo-hub answered — the asset looked
 * exactly like a successful Google generation, and only a print statement added to the router
 * revealed otherwise.
 *
 * The cost is not just confusion. Cards differ per route in resolution, aspect ratio and duration,
 * so an asset whose provider is unknown is an asset whose constraints are unknown. Billing lands on
 * one account while the operator believes another was used.
 */
describe("a generated node records its route", () => {
  it("carries the chosen account into the request", () => {
    // `providerAccountId` is written onto the pending node when a caller names an account, so the
    // choice survives a restart and the processor folds it back into the generation parameters.
    expect(source).toMatch(/providerAccountId/);
    expect(source).toMatch(/provider_id/);
  });

  it("does not yet record the upstream or the wire format", () => {
    // Reversed against what the code does, not against what it should do. Three axes are three
    // facts -- whose credential paid, which vendor answered, what format was spoken -- and only the
    // first is recorded. This test previously passed by matching `upstreamId` in a configuration
    // literal elsewhere in the file, which is why the gap went unnoticed.
    expect(source).not.toMatch(/upstreamId/);
    expect(source).not.toMatch(/apiShape/);
  });
});
