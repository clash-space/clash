import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "providers.ts"), "utf8");

/**
 * Removing an account deletes it, rather than describing a list that omits it.
 *
 * The first version sent the remaining accounts back through PATCH, assuming that endpoint replaces
 * the set. It merges. So the command reported success, printed the account it had removed, and left
 * it in the database — the worst shape a destructive operation can have, because the caller has been
 * told the secret is gone.
 *
 * There is a DELETE route for exactly this, and it was there the whole time.
 */
describe("removing an account", () => {
  it("uses the delete route", () => {
    expect(source).toMatch(/method:\s*"DELETE"/);
  });

  it("addresses the account in the path", () => {
    expect(source).toMatch(/model-providers\/\$\{encodeURIComponent/);
  });

  it("does not rewrite the whole list to express a deletion", () => {
    // PATCH merges, so an account left out of the body simply stays.
    expect(source).not.toMatch(/remaining[\s\S]{0,400}writeAccounts/);
  });
});
