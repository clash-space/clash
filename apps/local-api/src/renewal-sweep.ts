import { dueForRenewal, type CredentialTiming, type RenewSchedule } from "./auth-renewal.js";

/**
 * The host's half of renewal: deciding who is due, and calling them.
 *
 * `dueForRenewal` computed the right answer and nothing asked it. A declaration the host reads but
 * never acts on is the same as no declaration -- the credential expires, the next generation fails,
 * and the error names a vendor rejection rather than a renewal that never ran.
 *
 * The renewal itself is the plugin's `renew` export. A refresh-token exchange, a re-signed JWT and a
 * re-run CLI are all just code, and none is a protocol the host could know. What the host owns is
 * the schedule and the failure.
 */

export interface RenewableAccount {
  accountId: string;
  pluginId: string;
  /** Absent when the Provider declared no renewal. */
  renew?: RenewSchedule;
  timing: CredentialTiming;
}

export interface RenewalSweepResult {
  renewed: string[];
  failed: { accountId: string; error: string }[];
}

export interface RenewalSweepInput {
  accounts: readonly RenewableAccount[];
  now: number;
  renew: (account: RenewableAccount) => Promise<void>;
}

export async function sweepRenewals(input: RenewalSweepInput): Promise<RenewalSweepResult> {
  const renewed: string[] = [];
  const failed: { accountId: string; error: string }[] = [];

  for (const account of input.accounts) {
    // No declaration means nothing to schedule. An api key does not expire, and calling `renew`
    // would invoke an export with nothing to do.
    if (!account.renew) continue;
    if (!dueForRenewal(account.renew, account.timing, input.now)) continue;

    try {
      await input.renew(account);
      renewed.push(account.accountId);
    } catch (error) {
      // One dead refresh token must not stop every other account from renewing, which is the whole
      // reason this is a sweep rather than a loop at the call site. The failure is reported rather
      // than swallowed: it has to reach the account form, not surface as a generation error three
      // screens away.
      failed.push({
        accountId: account.accountId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { renewed, failed };
}
