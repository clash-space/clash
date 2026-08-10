import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const executor = readFileSync(join(__dirname, "provider-plugin-executor.ts"), "utf8");

/**
 * The declared vocabulary has to be what decides, or it is decoration.
 *
 * A schema that records a mapping nobody reads is the same defect as a method that exists only in
 * a type: it looks like the problem was handled. The host reads the word the plugin reported
 * against the entry's mapping, and an acceptance carrying a status that means `failed` is a
 * failure -- reported now, with the provider's own word in the message, rather than polled until a
 * deadline expires.
 */
describe("the host decides lifecycle from the declared mapping", () => {
  it("reads the mapping off the entry it just invoked", () => {
    expect(executor).toMatch(/statusMapping/);
  });

  it("classifies the reported word rather than pattern-matching it locally", () => {
    // Local matching is how the vocabulary drifts back into private enumerations.
    expect(executor).toMatch(/classifyProviderStatus\(/);
  });

  it("turns a terminal verdict into a failure instead of another poll", () => {
    expect(executor).toMatch(/classifyProviderStatus[\s\S]{0,700}?(throw|status: "failed")/);
  });
});
