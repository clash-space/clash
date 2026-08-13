import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { assertDependencyDistIsFresh } from "./host-runtime-freshness.js";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

function writeFixtureFile(
  packageDir: string,
  relativePath: string,
  mtimeMs: number,
): void {
  const path = join(packageDir, relativePath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, relativePath, "utf8");
  const stamp = new Date(mtimeMs);
  utimesSync(path, stamp, stamp);
}

/**
 * The host bundle must not be buildable from stale dependency output.
 *
 * `build:host` only bundles; it reads each package's `dist`. So editing a source file, running
 * `build:host`, and restarting the host produced a runtime that silently kept the old code, and the
 * only symptom was the bug persisting. It cost three separate rounds of debugging in one session:
 *
 *   - `local-processor` still had the hardcoded duration
 *   - the CLI-owned plugin host still had the 4 MB frame limit, so a generation failed as
 *     "mismatched response" long after that had been raised to 8 MB
 *
 * The package now declares every artifact producer it consumes. Turbo builds those dependencies
 * before this package, once, rather than package scripts recursively rebuilding one another.
 */
describe("host runtime build freshness", () => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "plugins", "clash", "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("declares the Clash CLI runtime as a private build input", () => {
    assert.equal(manifest.devDependencies["@clash/cli"], "workspace:*");
    assert.ok(!Object.hasOwn(manifest.dependencies, "@clash/cli"));
  });

  it("does not recursively rebuild workspace dependencies", () => {
    assert.ok(!Object.hasOwn(manifest.scripts, "build:deps"));
    assert.ok(!manifest.scripts.build.includes("--filter"));
  });

  it("ignores colocated test and spec sources that package builds do not emit", () => {
    const packageDir = mkdtempSync(join(tmpdir(), "clash-freshness-"));
    try {
      writeFixtureFile(packageDir, "src/index.ts", 100_000);
      writeFixtureFile(packageDir, "dist/index.js", 200_000);
      writeFixtureFile(packageDir, "src/nested/index.test.ts", 300_000);
      writeFixtureFile(packageDir, "src/view.spec.tsx", 400_000);

      assert.doesNotThrow(() => assertDependencyDistIsFresh([packageDir]));
    } finally {
      rmSync(packageDir, { recursive: true, force: true });
    }
  });

  it("refuses to bundle when emitted production source is newer than dist", () => {
    const packageDir = mkdtempSync(join(tmpdir(), "clash-freshness-"));
    try {
      writeFixtureFile(packageDir, "dist/index.js", 200_000);
      writeFixtureFile(packageDir, "src/index.ts", 300_000);

      assert.throws(
        () => assertDependencyDistIsFresh([packageDir]),
        /dist is older than src/,
      );
    } finally {
      rmSync(packageDir, { recursive: true, force: true });
    }
  });
});
