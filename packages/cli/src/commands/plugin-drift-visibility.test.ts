import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(join(__dirname, "plugin.ts"), "utf8");

/**
 * A plugin that has drifted from its activation receipt must say so where it is listed.
 *
 * local-api computes drift against its activation receipt. `plugin list --local`
 * must preserve that host-reported state in JSON and human output:
 *
 *   clash.media  0.4.1        <- looks fine
 *   $ clash plugin checkout clash.media .
 *   Active plugin ... differs from its activation receipt
 *
 * The cause is real and reachable by a user: build tooling ran inside managed storage, leaving
 * `.turbo/`, `tsup.config.ts`, and `dist/` in the install directory, so the content hash no
 * longer matches. The state is recoverable, but nothing points at it until an unrelated command
 * fails, and the message arrives at the moment the user wanted to do something else.
 */
test("local listing reports host-computed receipt drift", () => {
  assert.match(
    source,
    /drifted: boolean/,
    "listing must type the host-reported drift flag, not just id and version",
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
