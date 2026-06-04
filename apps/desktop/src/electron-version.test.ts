import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface DesktopPackage {
  scripts?: Record<string, string>;
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

  it("has a macOS DMG packaging target for first desktop ship", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as DesktopPackage;
    const builderConfig = readFileSync(
      new URL("../electron-builder.yml", import.meta.url),
      "utf8",
    );

    const dmgScript = manifest.scripts?.["pack:dmg"] ?? "";
    expect(dmgScript).toContain("electron-builder");
    expect(dmgScript).toContain("--publish never");
    expect(builderConfig).toMatch(/^publish:\s+null$/m);
    expect(builderConfig).toMatch(/target:\n(?:\s+-\s+\w+\n)*\s+-\s+dmg/m);
  });
});
