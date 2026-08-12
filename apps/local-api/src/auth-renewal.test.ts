import { describe, expect, it } from "vitest";

import { dueForRenewal, nextRenewalAt, parseDuration } from "./auth-renewal.js";

/**
 * When the host should wake a plugin to renew.
 *
 * Only two schedules, because only two need the host: it is the one awake when nobody is using the
 * app. A credential rejected *during* a call is not in this category -- the plugin is already
 * running, already holds the response, and can refresh and retry in the same function.
 *
 * The renewal itself is the plugin's code. A refresh-token exchange, a re-signed JWT and a re-run
 * CLI are all just code, and none of them is a protocol the host could know.
 */
describe("durations", () => {
  it("reads the four units the declaration allows", () => {
    expect(parseDuration("60s")).toBe(60_000);
    expect(parseDuration("15m")).toBe(900_000);
    expect(parseDuration("12h")).toBe(43_200_000);
    expect(parseDuration("7d")).toBe(604_800_000);
  });

  it("refuses anything else rather than guessing a unit", () => {
    // "60" could be seconds or minutes, and a wrong guess means a token refreshed an hour late.
    for (const value of ["60", "1 hour", "12H", "-5m", ""]) {
      expect(() => parseDuration(value)).toThrow();
    }
  });
});

describe("before an expiry", () => {
  it("wakes the plugin the declared distance ahead of expiry", () => {
    const expiresAt = 1_000_000;
    expect(nextRenewalAt({ before: "60s" }, { expiresAt })).toBe(expiresAt - 60_000);
  });

  it("is due once the window has been entered", () => {
    const now = 1_000_000;
    expect(dueForRenewal({ before: "60s" }, { expiresAt: now + 30_000 }, now)).toBe(true);
    expect(dueForRenewal({ before: "60s" }, { expiresAt: now + 90_000 }, now)).toBe(false);
  });

  it("is due for a credential that already expired", () => {
    // Being past the deadline is not a reason to stop trying: the refresh token usually outlives
    // the access token, and the alternative is an account that never recovers on its own.
    const now = 1_000_000;
    expect(dueForRenewal({ before: "60s" }, { expiresAt: now - 5_000 }, now)).toBe(true);
  });

  it("is due at the exact moment the window opens, not a millisecond later", () => {
    // Written after a mutation test: `<=` and `<` were indistinguishable, because every other case
    // was comfortably past the boundary. A strict comparison would defer each renewal to whenever
    // the scheduler next happened to run.
    const now = 1_000_000;
    expect(dueForRenewal({ before: "60s" }, { expiresAt: now + 60_000 }, now)).toBe(true);
  });

  it("is never due for a credential with no expiry", () => {
    // An api key does not expire. Waking a plugin to renew one would call a `renew` export that
    // has nothing to do, on a schedule nobody asked for.
    expect(dueForRenewal({ before: "60s" }, {}, 1_000_000)).toBe(false);
  });
});

describe("on a fixed schedule", () => {
  it("counts from the last renewal, not from the expiry", () => {
    const renewedAt = 1_000_000;
    expect(nextRenewalAt({ every: "12h" }, { renewedAt })).toBe(renewedAt + 43_200_000);
  });

  it("is due immediately for a credential that has never been renewed", () => {
    // A first run has no `renewedAt`. Treating that as "not due" means a scheduled renewal that
    // never happens until something else writes the field.
    expect(dueForRenewal({ every: "12h" }, {}, 1_000_000)).toBe(true);
  });

  it("is not due again until the interval has passed", () => {
    const now = 1_000_000;
    expect(dueForRenewal({ every: "12h" }, { renewedAt: now - 43_100_000 }, now)).toBe(false);
    expect(dueForRenewal({ every: "12h" }, { renewedAt: now - 43_300_000 }, now)).toBe(true);
  });
});
