import type { PluginAuthDeclaration } from "@clash/shared-types";

/**
 * When the host should wake a plugin to renew a credential.
 *
 * Only two schedules, because only two need the host: it is the one awake when nobody is using the
 * app. A credential rejected *during* a call is not in this category -- the plugin is already
 * running, already holds the response, and can refresh and retry in the same function. Declaring
 * that case would mean reporting a failure outward and waiting to be called again, to do something
 * the plugin could have done immediately.
 *
 * The renewal itself is plugin code. A refresh-token exchange, a re-signed JWT and a re-run CLI are
 * all just code, and none is a protocol the host could know. What the host owns is the schedule and
 * the failure: when renewal fails, the account is marked as needing attention and the form says so,
 * because a dead refresh token must not surface as a generation error three screens away.
 */

/**
 * Read off a method, because that is where renewal is declared.
 *
 * A Provider does not have one renewal rule: an account that pasted a long-lived API key needs no
 * renewal at all, while one that signed in holds a token measured in hours. Both are methods on the
 * same Provider, and the schedule belongs to whichever the account chose.
 */
export type RenewSchedule = NonNullable<
  NonNullable<PluginAuthDeclaration["methods"]>[number]["renew"]
>;

/** What the store already knows about this credential's lifetime. */
export interface CredentialTiming {
  expiresAt?: number;
  renewedAt?: number;
}

const DURATION = /^(\d+)(s|m|h|d)$/;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(value: string): number {
  const match = DURATION.exec(value.trim());
  // "60" could be seconds or minutes, and a wrong guess means a token refreshed an hour late --
  // which looks like an intermittent authentication failure rather than a scheduling bug.
  if (!match) throw new Error(`Write a duration like 60s, 15m, 12h or 7d; got ${JSON.stringify(value)}.`);
  return Number(match[1]) * UNIT_MS[match[2]!]!;
}

/**
 * When this credential should next be renewed, or undefined if there is nothing to schedule.
 *
 * `before` counts back from the expiry the vendor gave. `every` counts forward from the last
 * renewal, because a fixed schedule is about how stale the credential is, not when it dies.
 */
export function nextRenewalAt(
  schedule: RenewSchedule,
  timing: CredentialTiming,
): number | undefined {
  if ("before" in schedule) {
    // An api key does not expire. Waking a plugin to renew one would call a `renew` export that has
    // nothing to do, on a schedule nobody asked for.
    if (timing.expiresAt === undefined) return undefined;
    return timing.expiresAt - parseDuration(schedule.before);
  }
  // A first run has no `renewedAt`. Treating that as "not due" means a scheduled renewal that never
  // happens until something else writes the field.
  if (timing.renewedAt === undefined) return 0;
  return timing.renewedAt + parseDuration(schedule.every);
}

export function dueForRenewal(
  schedule: RenewSchedule,
  timing: CredentialTiming,
  now: number,
): boolean {
  const at = nextRenewalAt(schedule, timing);
  if (at === undefined) return false;
  // `<=` rather than `<`: being past the deadline is not a reason to stop trying. The refresh token
  // usually outlives the access token, and the alternative is an account that never recovers on
  // its own.
  return at <= now;
}
