import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = join(import.meta.dirname, "..", "..", "..");

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
    expect(manifest.devDependencies["@clash/cli"]).toBe("workspace:*");
    expect(manifest.dependencies).not.toHaveProperty("@clash/cli");
  });

  it("does not recursively rebuild workspace dependencies", () => {
    expect(manifest.scripts).not.toHaveProperty("build:deps");
    expect(manifest.scripts.build).not.toContain("--filter");
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

  it("copies every official Provider into the shipped host runtime", () => {
    const builder = readFileSync(
      join(repoRoot, "plugins", "clash", "scripts", "build-host-runtime.ts"),
      "utf8",
    );
    expect(builder).toContain("BUNDLED_PLUGINS");
    expect(builder).toContain("bundled-plugins");
    expect(builder).toContain("manifest.runtime?.entrypoint");
    expect(builder).toContain("manifest.contributes?.providers");
  });
});
