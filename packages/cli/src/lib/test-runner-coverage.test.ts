import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import test from "node:test";

const cliRoot = join(__dirname, "..", "..");

/**
 * Both test runners must be reachable from `npm test`.
 *
 * This package runs two: `node:test` files via `scripts/run-tests.mjs`, and vitest files. Running
 * `npx vitest run` here reports 21 tests and exits zero, which looks like a full pass while hiding
 * 348 -- so a change that broke only the node:test suites would appear green.
 *
 * The guard is on the script, not the counts: a count would have to be edited with every new test and
 * would fail for the wrong reason.
 */
test("npm test invokes both runners", () => {
  const manifest = JSON.parse(
    readFileSync(join(cliRoot, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  const script = manifest.scripts.test;
  assert.match(script, /run-tests\.mjs/, "the node:test suites must run");
  assert.match(script, /vitest/, "the vitest suites must run");
});

test("every test file belongs to a runner", () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(join(cliRoot, "src"));
  assert.ok(files.length > 40, `expected the suite to be large, found ${files.length}`);

  // A node:test file imports `node:test`; a vitest file imports `vitest`. Anything importing neither
  // is collected by no runner and silently never executes.
  const orphans = files.filter((file) => {
    const source = readFileSync(file, "utf8");
    return !/from "node:test"/.test(source) && !/from "vitest"/.test(source);
  });
  assert.deepEqual(orphans, [], "these test files are collected by neither runner");
});
