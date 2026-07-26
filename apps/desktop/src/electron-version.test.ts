import { existsSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface DesktopPackage {
  scripts?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

interface RootPackage {
  pnpm?: {
    overrides?: Record<string, string>;
  };
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
    expect(
      dependencyMajor(manifest.devDependencies?.electron ?? ""),
    ).toBeGreaterThanOrEqual(42);
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

  it("defines deterministic installers for macOS, Windows, and Linux", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as DesktopPackage;
    const rootManifest = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as RootPackage;
    const builderConfig = readFileSync(
      new URL("../electron-builder.yml", import.meta.url),
      "utf8",
    );
    const workspaceConfig = readFileSync(
      new URL("../../../pnpm-workspace.yaml", import.meta.url),
      "utf8",
    );

    expect(manifest.scripts ?? {}).toHaveProperty("pack:mac");
    expect(manifest.scripts ?? {}).toHaveProperty("pack:win");
    expect(manifest.scripts ?? {}).toHaveProperty("pack:linux");
    expect(manifest.scripts?.["pack:mac"] ?? "").toContain(
      "--mac dmg --universal",
    );
    expect(manifest.scripts?.["pack:win"] ?? "").toContain("--win nsis --x64");
    expect(manifest.scripts?.["pack:linux"] ?? "").toContain(
      "--linux AppImage --x64",
    );
    expect(manifest.scripts?.["prepare:pack"] ?? "").toContain(
      "pnpm --filter @master-clash/web... build",
    );
    expect(manifest.scripts?.["prepare:pack"] ?? "").toContain(
      "pnpm --filter @master-clash/local-api... build",
    );
    expect(manifest.devDependencies?.["electron-builder"]).toBe("26.15.3");
    expect(rootManifest.pnpm?.overrides?.["@electron/get"]).toBe("5.0.0");
    expect(builderConfig).toContain(
      "artifactName: Clash-Desktop-macOS-${arch}.${ext}",
    );
    expect(builderConfig).toContain(
      "artifactName: Clash-Desktop-Windows-${arch}.${ext}",
    );
    expect(builderConfig).toContain(
      "artifactName: Clash-Desktop-Linux-x64.${ext}",
    );
    expect(builderConfig).toMatch(
      /^win:\n(?:(?!^[A-Za-z]).*\n)*? {2}executableName: clash$/m,
    );
    expect(builderConfig).toMatch(
      /^linux:\n(?:(?!^[A-Za-z]).*\n)*? {2}executableName: clash$/m,
    );
    expect(builderConfig).toContain(
      'x64ArchFiles: "**/node_modules/{@anthropic-ai/claude-agent-sdk-*,@esbuild/*,@remotion/compositor-*}/**"',
    );
    expect(workspaceConfig).toMatch(
      /supportedArchitectures:\n\s+cpu:\s+\[arm64, x64\]/,
    );
    expect(builderConfig).toContain(
      '"!node_modules/@anthropic-ai/claude-agent-sdk-{linux,win32}-*/**"',
    );
    expect(builderConfig).toContain(
      '"!node_modules/@remotion/compositor-{linux,win32}-*/**"',
    );
    expect(builderConfig).toContain(
      '"!node_modules/@anthropic-ai/claude-agent-sdk-{darwin,linux}-*/**"',
    );
    expect(builderConfig).toContain(
      '"!node_modules/@remotion/compositor-{darwin,linux}-*/**"',
    );
    expect(builderConfig).toContain(
      '"!node_modules/@anthropic-ai/claude-agent-sdk-{darwin-*,win32-*,linux-arm64,linux-arm64-musl}/**"',
    );
    expect(builderConfig).toContain(
      '"!node_modules/@remotion/compositor-{darwin-*,win32-*,linux-arm64-*}/**"',
    );
  });

  it("packages all desktop targets in CI and promotes the same assets to a rolling release", () => {
    const ci = readFileSync(
      new URL("../../../.github/workflows/ci.yml", import.meta.url),
      "utf8",
    );
    const release = readFileSync(
      new URL("../../../.github/workflows/release.yml", import.meta.url),
      "utf8",
    );

    for (const workflow of [ci, release]) {
      expect(workflow).toContain("package-desktop:");
      expect(workflow).toContain("macos-latest");
      expect(workflow).toContain("windows-latest");
      expect(workflow).toContain("ubuntu-latest");
      expect(workflow).toContain("actions/upload-artifact@v4");
      expect(workflow).toContain("Clash-Desktop-${{ matrix.platform }}");
    }
    expect(ci).toContain(
      "pnpm --filter @master-clash/desktop run ${{ matrix.script }}",
    );
    expect(release).toContain("publish-desktop-preview:");
    expect(release).toContain("actions/download-artifact@v4");
    expect(release).toContain("gh release upload desktop-preview");
  });

  it("packages built-in ACP harness wrappers as desktop resources", () => {
    const builderConfig = readFileSync(
      new URL("../electron-builder.yml", import.meta.url),
      "utf8",
    );

    expect(builderConfig).toMatch(
      /-\s+from:\s+build\/acp-bin\n\s+to:\s+acp-bin/m,
    );
  });

  it("packages the local-model Python SDK as an unpacked desktop resource", () => {
    const builderConfig = readFileSync(
      new URL("../electron-builder.yml", import.meta.url),
      "utf8",
    );

    expect(builderConfig).toMatch(
      /-\s+from:\s+\.\.\/\.\.\/packages\/clash-sdk\/python\n\s+to:\s+clash-sdk\/python/m,
    );
    expect(builderConfig).toMatch(/-\s+"clash_sdk\/\*\*\/\*"/m);
    expect(builderConfig).toContain('- "!**/__pycache__/**"');
    expect(builderConfig).toContain('- "!**/*.py[cod]"');
  });

  it("ships a Clash desktop app icon instead of the Electron default", () => {
    const iconUrl = new URL("../build/icon.icns", import.meta.url);
    expect(existsSync(iconUrl)).toBe(true);
    expect(statSync(iconUrl).size).toBeGreaterThan(10_000);
    expect(readFileSync(iconUrl).subarray(0, 4).toString("ascii")).toBe("icns");
  });

  it("uses a full-size centered Clash C desktop icon source", () => {
    const iconSvg = readFileSync(
      new URL("../build/icon.svg", import.meta.url),
      "utf8",
    );

    expect(iconSvg).toContain('viewBox="0 0 1024 1024"');
    expect(iconSvg).toContain('rx="216"');
    expect(iconSvg).toContain('aria-label="Clash C app icon"');
    expect(iconSvg).toContain('stroke="#FF6B50"');
    expect(iconSvg).not.toMatch(/<ellipse|agent|face/i);
  });

  it("injects the desktop runtime mode into the renderer", () => {
    const preload = readFileSync(
      new URL("./preload.ts", import.meta.url),
      "utf8",
    );

    expect(preload).toMatch(/mode:\s*runtimeConfig\.mode/);
    expect(preload).toMatch(/capabilities:\s*runtimeConfig\.capabilities/);
  });
});
