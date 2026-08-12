import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "local-aigc.ts"), "utf8");

/**
 * A generation that reached no provider is a failure, not a picture.
 *
 * The fallback returned a 1278-byte SVG placeholder and the node reported `completed` with an asset
 * attached — indistinguishable, at every level a caller can see, from a real generation. Measured
 * three times in this session: once when a Google account was skipped for want of a credential the
 * vendor no longer requires, once when priority sent the work elsewhere, and once when
 * `--provider official-primary` matched no route at all.
 *
 * Each time the response looked like success, and the only way to tell was to open the file.
 *
 * The mock stays reachable — it is a real provider you can select, and the mock tests select it.
 * What is gone is arriving there by accident.
 */
describe("no silent fallback", () => {
  it("does not return a placeholder when no route resolved", () => {
    expect(source).not.toMatch(/const fallbackOrThrow = [\s\S]{0,400}?return fallback\(\);/);
  });

  it("says which model and which provider failed", () => {
    expect(source).toMatch(/requires a configured real provider|no configured provider/i);
  });

  it("still lets an explicitly selected mock answer", () => {
    // Choosing the mock is a legitimate answer to "which provider"; the tests depend on it.
    expect(source).toMatch(/explicitMockProvider/);
  });
});

/**
 * Having a mock account is not choosing it.
 *
 * The condition asked whether any enabled mock account existed anywhere in the configuration, which
 * is true on every machine that has ever run the mock tests. So on those machines every route that
 * failed to resolve — for any reason, including a typo in `--provider` — quietly produced a
 * placeholder and reported success.
 *
 * Measured: `canvas execute --provider official-primary` on an account holding a real Google key
 * returned a 1278-byte SVG and a `completed` node. The requested account was never consulted, and
 * nothing in the response said so.
 */
describe("selecting the mock", () => {
  it("requires the mock to be the requested provider, not merely present", () => {
    expect(source).not.toMatch(
      /explicitMockProvider = providerAccounts\?\.some\(\s*\(account\) => account\.providerId === "mock" && account\.enabled !== false,?\s*\) === true;/,
    );
  });

  it("never substitutes the mock for a named provider", () => {
    expect(source).toMatch(/preferredProviderId[\s\S]{0,200}?mock/);
  });
});
