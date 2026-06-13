import { existsSync, readFileSync, statSync } from "node:fs";
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
    expect(builderConfig).toMatch(/^\s+icon:\s+build\/icon\.icns$/m);
    expect(builderConfig).toMatch(/target:\n(?:\s+-\s+\w+\n)*\s+-\s+dmg/m);
  });

  it("ships a Clash desktop app icon instead of the Electron default", () => {
    const iconUrl = new URL("../build/icon.icns", import.meta.url);
    expect(existsSync(iconUrl)).toBe(true);
    expect(statSync(iconUrl).size).toBeGreaterThan(10_000);
    expect(readFileSync(iconUrl).subarray(0, 4).toString("ascii")).toBe("icns");
  });

  it("uses a full-size centered desktop icon source", () => {
    const iconSvg = readFileSync(
      new URL("../build/icon.svg", import.meta.url),
      "utf8",
    );

    expect(iconSvg).toContain('viewBox="0 0 1024 1024"');
    expect(iconSvg).toContain('rx="216"');
    expect(iconSvg).toContain('translate(512 512) scale(0.86) translate(-636 -601)');
  });

  it("injects the desktop runtime mode into the renderer", () => {
    const preload = readFileSync(new URL("./preload.ts", import.meta.url), "utf8");

    expect(preload).toMatch(/mode:\s*runtimeConfig\.mode/);
    expect(preload).toMatch(/capabilities:\s*runtimeConfig\.capabilities/);
  });
});
