import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  normalizeSource,
  sourceContains,
  sourceMatches,
} from "@clash/gui/test-support/source-match";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("design token hierarchy", () => {
  it("maps foundation colors through semantic and component tokens", () => {
    const css = readSource("apps/web/app/globals.css");

    expect(sourceContains(css, "--destructive: var(--clash-coral)")).toBe(true);
    expect(sourceContains(css, "--info: var(--clash-blue)")).toBe(true);
    expect(sourceContains(css, "--ring: var(--clash-blue)")).toBe(true);
    expect(sourceMatches(css, /--ring:\s*var\(--clash-coral\)/)).toBe(false);
    expect(css).toContain("--select-surface");
    expect(css).toContain("--select-item-focus");
    expect(sourceContains(css, "--select-item-gap: 0.25rem")).toBe(true);
    expect(css).toContain("--control-height-default");
    expect(css).toContain("--input-placeholder");
    expect(css).toContain("--surface-card-bg");
    expect(css).toContain("--surface-card-border");
    expect(css).toContain("--surface-card-hover-bg");
    expect(css).toContain("--surface-card-hover-border");
    expect(css).toContain("--surface-card-radius");
    for (const tone of ["error", "warning", "info", "success"]) {
      expect(css).toContain(`--feedback-${tone}-ink`);
      expect(css).toContain(`--feedback-${tone}-surface`);
      expect(css).toContain(`--feedback-${tone}-border`);
    }
    expect(css).toContain("--feedback-toast-shadow");
    expect(css).toContain("--z-toast");
    expect(css).toContain("--artwork-slot-md");
    expect(css).toContain("--motion-feedback-duration");
    expect(css).toContain("--motion-feedback-ease");
    expect(css).toContain(".app-control");
    expect(css).toContain(".app-control[data-size]");
    expect(css).toContain('.app-control[data-slot="input"]');
    expect(css).toContain("min-height: var(--control-height-default)");
    expect(css).toContain(".app-select-content");
    expect(css).toContain(".app-select-focus");

    const input = readSource("packages/gui/src/components/ui/input.tsx");
    expect(input).toContain("placeholder:text-[var(--input-placeholder)]");
  });

  it("scans the shared GUI package and gives settings a compact Clash density layer", () => {
    const css = readSource("apps/web/app/globals.css");

    expect(css).toContain('@source "../../../packages/gui/src"');
    expect(css).toContain("--settings-type-size");
    expect(css).toContain("--settings-type-line");
    expect(css).toContain("--settings-control-height");
    expect(css).toContain("--settings-row-height");
    expect(css).toContain("--settings-row-gap");
    expect(css).toContain("--settings-row-radius");
    expect(css).toContain('.app-control[data-slot="textarea"]');
  });

  it("keeps settings, director, timeline and composer component mappings distinct", () => {
    const css = readSource("apps/web/app/globals.css");

    expect(css).toContain('[data-context="settings"]');
    expect(css).toContain('[data-context="director"]');
    expect(css).toContain('[data-context="timeline"]');
    expect(css).toContain('[data-context="composer"]');
    expect(css).toContain(".clash-director-stage-shell");
    expect(css).toContain(".clash-timeline-editor");
  });

  it("gives project chat and canvas one workspace control contract", () => {
    const css = readSource("apps/web/app/globals.css");

    for (const token of [
      "--clash-workspace-control-size",
      "--clash-workspace-control-radius",
      "--clash-workspace-control-gap",
      "--clash-workspace-surface-radius",
    ]) {
      expect(css).toContain(token);
    }
    expect(
      sourceMatches(
        css,
        /:where\(\.clash-chat-input-surface,\s*\[data-context="composer"\]\)[\s\S]*?--control-height-sm:\s*var\(--clash-workspace-control-size\)/,
      ),
    ).toBe(true);
    expect(
      sourceMatches(
        css,
        /\.clash-canvas-toolbar-surface\s*\{[\s\S]*?width:\s*calc\(\s*var\(--clash-workspace-control-size\)[\s\S]*?var\(--clash-workspace-control-gap\)[\s\S]*?\)/,
      ),
    ).toBe(true);
    expect(
      sourceMatches(
        css,
        /\.clash-toolbar-button,\s*\.clash-input-icon-button\s*\{[\s\S]*?box-shadow:\s*none/,
      ),
    ).toBe(true);
  });

  it("defines every semantic tone as an OKLCH light and dark four-step contract", () => {
    const css = readSource("apps/web/app/globals.css");
    const normalized = normalizeSource(css);
    const darkStart = normalized.indexOf(".dark {");
    const darkEnd = normalized.indexOf("}", darkStart);
    const dark = normalized.slice(darkStart, darkEnd);
    const tones = ["coral", "blue", "sage", "lilac", "amber", "teal"];
    const roles = ["ink", "soft", "surface", "border"];

    expect(darkStart).toBeGreaterThan(-1);
    for (const tone of tones) {
      for (const role of roles) {
        const token = `--tone-${tone}-${role}`;
        expect(sourceMatches(css, new RegExp(`${token}:\\s*oklch\\(`))).toBe(
          true,
        );
        expect(dark).toContain(`${token}: oklch(`);
      }
    }
  });

  it("keeps palette values in tokens instead of scattering hex colors across tone consumers", () => {
    const consumers = [
      "packages/gui/src/components/ui/badge.tsx",
      "packages/web-ui/src/components/HomeOperations.tsx",
      "packages/web-ui/src/components/MarketplaceItemCard.tsx",
    ]
      .map(readSource)
      .join("\n");

    expect(sourceMatches(consumers, /#[0-9a-f]{3,8}\b/i)).toBe(false);
  });
});
