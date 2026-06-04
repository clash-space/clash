import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface DesktopPackage {
  devDependencies?: Record<string, string>;
}

function dependencyMajor(versionRange: string): number {
  const match = versionRange.match(/\d+/);
  return match ? Number(match[0]) : Number.NaN;
}

describe("desktop Electron runtime", () => {
  it("tracks a current Electron major for macOS desktop shell fixes", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as DesktopPackage;

    expect(dependencyMajor(manifest.devDependencies?.electron ?? "")).toBeGreaterThanOrEqual(42);
  });
});
