import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(__dirname, "actions.ts"), "utf8");

/**
 * A plugin that has drifted from its activation receipt must say so where it is listed.
 *
 * Drift is only detected on checkout today, so `action list --local` shows a healthy-looking
 * entry for a package that cannot be edited:
 *
 *   clash-first-party-media  0.4.1        <- looks fine
 *   $ clash action checkout clash-first-party-media .
 *   Active plugin ... differs from its activation receipt
 *
 * The cause is real and reachable by a user: build tooling ran inside managed storage, leaving
 * `.turbo/`, `tsup.config.ts`, and `dist/` in the install directory, so the content hash no
 * longer matches. The state is recoverable, but nothing points at it until an unrelated command
 * fails, and the message arrives at the moment the user wanted to do something else.
 */
test("local listing reports receipt drift", () => {
  assert.match(
    source,
    /localInstallDrift|receiptMatchesInstall|driftedFromReceipt/,
    "listing must compute drift, not just id and version",
  );
});

test("drifted entries are visible in both output modes", () => {
  // The JSON caller is the one that cannot see a hint printed for humans.
  assert.match(source, /drift/i);
  const jsonBranch = source.slice(source.indexOf("if (options.local)"));
  assert.match(
    jsonBranch.slice(0, 1200),
    /drift/i,
    "the JSON payload must carry the drift flag",
  );
});
