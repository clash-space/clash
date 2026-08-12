import { describe, expect, it } from "vitest";

import { sweepRenewals } from "./renewal-sweep.js";

/**
 * Something has to actually call the scheduler.
 *
 * `dueForRenewal` computed the right answer and nothing asked it. A declaration the host reads but
 * never acts on is the same as no declaration: the credential expires, the next generation fails,
 * and the error names a vendor rejection rather than a renewal that never ran.
 *
 * The sweep is the host's half. The renewal itself is the plugin's `renew` export -- a refresh-token
 * exchange, a re-signed JWT and a re-run CLI are all just code, and none is a protocol the host
 * could know.
 */
function account(id: string, expiresAt?: number) {
  return {
    accountId: id,
    pluginId: "hrhrng.hub",
    renew: { before: "60s" as const },
    timing: expiresAt === undefined ? {} : { expiresAt },
  };
}

describe("sweepRenewals", () => {
  it("wakes the plugin for an account inside its window", async () => {
    const woken: string[] = [];
    const now = 1_000_000;
    await sweepRenewals({
      accounts: [account("a", now + 30_000)],
      now,
      renew: async (entry) => { woken.push(entry.accountId); },
    });
    expect(woken).toEqual(["a"]);
  });

  it("leaves an account that is not due yet alone", async () => {
    const woken: string[] = [];
    const now = 1_000_000;
    await sweepRenewals({
      accounts: [account("a", now + 600_000)],
      now,
      renew: async (entry) => { woken.push(entry.accountId); },
    });
    expect(woken).toEqual([]);
  });

  it("keeps going after one account's renewal throws", async () => {
    // One dead refresh token must not stop every other account from renewing. This is the whole
    // reason the sweep exists rather than a loop at the call site.
    const woken: string[] = [];
    const now = 1_000_000;
    const result = await sweepRenewals({
      accounts: [account("bad", now), account("good", now)],
      now,
      renew: async (entry) => {
        if (entry.accountId === "bad") throw new Error("invalid_grant");
        woken.push(entry.accountId);
      },
    });
    expect(woken).toEqual(["good"]);
    expect(result.failed).toEqual([{ accountId: "bad", error: "invalid_grant" }]);
  });

  it("reports a failure rather than swallowing it", async () => {
    // The host owns the failure: a dead refresh token has to reach the account form, not surface as
    // a generation error three screens away.
    const now = 1_000_000;
    const result = await sweepRenewals({
      accounts: [account("a", now)],
      now,
      renew: async () => { throw new Error("Token request failed (invalid_grant)"); },
    });
    expect(result.failed[0]!.error).toMatch(/invalid_grant/);
    expect(result.renewed).toEqual([]);
  });

  it("does not wake a plugin for an account with no expiry to renew against", async () => {
    // An api key does not expire. Calling `renew` would invoke an export with nothing to do.
    const woken: string[] = [];
    await sweepRenewals({
      accounts: [account("a")],
      now: 1_000_000,
      renew: async (entry) => { woken.push(entry.accountId); },
    });
    expect(woken).toEqual([]);
  });

  it("skips an account whose Provider declared no renewal at all", async () => {
    const woken: string[] = [];
    await sweepRenewals({
      accounts: [{ accountId: "a", pluginId: "hrhrng.hub", timing: { expiresAt: 0 } }],
      now: 1_000_000,
      renew: async (entry) => { woken.push(entry.accountId); },
    });
    expect(woken).toEqual([]);
  });
});
