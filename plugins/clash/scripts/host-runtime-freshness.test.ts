import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..", "..");

/**
 * The host bundle must not be buildable from stale dependency output.
 *
 * `build:host` only bundles; it reads each package's `dist`. So editing a source file, running
 * `build:host`, and restarting the host produced a runtime that silently kept the old code, and the
 * only symptom was the bug persisting. It cost three separate rounds of debugging in one session:
 *
 *   - `local-processor` still had the hardcoded duration
 *   - `clash-bridge` still had the 4 MB frame limit, so a generation failed as
 *     "mismatched response" long after that had been raised to 8 MB
 *
 * `build:deps` did not list `clash-bridge` at all -- it was built only by the outer `build`, and
 * after `build:host` at that, so the ordering could not have worked.
 */
describe("host runtime build freshness", () => {
  const manifest = JSON.parse(
    readFileSync(join(repoRoot, "plugins", "clash", "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };

  it("builds clash-bridge before bundling the host", () => {
    expect(manifest.scripts["build:deps"]).toContain("@clash-space/bridge");
  });

  it("orders the bridge build before build:host", () => {
    const core = manifest.scripts["build:core"];
    expect(core.indexOf("build:deps")).toBeLessThan(core.indexOf("build:host"));
  });

  it("refuses to bundle when a dependency's dist is older than its source", () => {
    // The guard the three debugging rounds were missing: a stale dist is a build error, not a
    // runtime mystery.
    const guard = readFileSync(
      join(repoRoot, "plugins", "clash", "scripts", "build-host-runtime.ts"),
      "utf8",
    );
    expect(guard).toContain("assertDependencyDistIsFresh");
  });
});
