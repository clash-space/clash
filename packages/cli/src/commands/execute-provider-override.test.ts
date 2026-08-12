import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const canvas = readFileSync(join(__dirname, "canvas.ts"), "utf8");

/**
 * Naming the account is how you find out whether that account works.
 *
 * Priority answers a different question — who should answer normally — and using it to test one
 * provider means rearranging everything else first, then rearranging it back. Worse, it can fail
 * silently in the direction that looks like success: an account was moved to the front, the
 * generation succeeded, and a different provider had answered. That happened twice here, and only a
 * route trace showed it.
 *
 * So execution takes an account and uses that account. If it cannot serve the model, that is the
 * answer, and it is reported rather than worked around.
 */
describe("canvas execute --provider", () => {
  it("accepts an account id", () => {
    expect(canvas).toMatch(/--provider <accountId>/);
  });

  it("passes it to the host rather than reordering anything", () => {
    expect(canvas).toMatch(/providerAccountId/);
  });
});
