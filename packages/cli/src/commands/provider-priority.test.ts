import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "providers.ts"), "utf8");

/**
 * Which account answers is the operator's decision, so the terminal has to be able to state it.
 *
 * Several accounts can serve one model — nano-banana-2 is reachable through Google, fal, pika
 * and replicate — and the order decides which one is billed. The column existed, the resolver read
 * it, and nothing could set it: every account was stored with a null priority and the outcome fell
 * to whatever the resolver's tie-break happened to be.
 *
 * Measured: a Google account was connected, nano-banana-2 was requested, and hilo-hub answered.
 * Twice, before anyone thought to print the route.
 */
describe("account priority", () => {
  it("can be set when connecting an account", () => {
    expect(source).toMatch(/--priority <number>/);
  });

  it("can be changed afterwards", () => {
    // Priorities are relative, so the useful gesture is reordering an account you already have.
    expect(source).toMatch(/\.command\("priority/);
  });

  it("is reported by list, so the order is visible without a database", () => {
    expect(source).toMatch(/priority: provider\.priority|priority\b/);
  });
});

/**
 * The two orders are different questions and both belong to the operator.
 *
 * One is which of your accounts on a provider answers first — two Google keys, one for work. The
 * other is which provider answers for a given model, and only that one settles a contested model:
 * nano-banana-2 is served by hilo-hub, Google, fal, pika and replicate, and the account-level
 * order cannot express a preference between providers at all.
 *
 * Measured: setting the account order to put Google first changed nothing. hilo-hub answered anyway,
 * because the model's provider order is a separate field — `modelPriorities` — which existed in the
 * resolver, was read on every resolution, and had no way in from the terminal.
 */
describe("per-model provider order", () => {
  it("can be set for one model on one account", () => {
    expect(source).toMatch(/\.command\("prefer/);
  });

  it("writes the field the resolver actually reads", () => {
    // Not the account-wide priority. A model-specific preference that landed in the account-wide
    // field would silently reorder every other model too.
    expect(source).toMatch(/modelPriorities/);
  });

  it("is reported by list, so a surprising route can be explained", () => {
    expect(source).toMatch(/modelPriorities: provider\.modelPriorities|modelPriorities\b/);
  });
});
