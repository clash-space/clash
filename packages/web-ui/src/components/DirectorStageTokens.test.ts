import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Director Stage semantic tokens", () => {
  const css = readFileSync(join(process.cwd(), "apps/web/app/globals.css"), "utf8");
  const required = [
    "--clash-director-viewport",
    "--clash-director-panel",
    "--clash-director-panel-text",
    "--clash-director-panel-secondary",
    "--clash-director-panel-muted",
    "--clash-director-panel-divider",
    "--clash-director-panel-hover",
    "--clash-director-panel-active",
    "--clash-director-field",
    "--clash-director-field-border",
    "--clash-director-control",
    "--clash-director-control-hover",
    "--clash-director-control-active",
    "--clash-director-control-border",
    "--clash-director-selection",
    "--clash-director-selection-foreground",
    "--clash-director-mannequin",
    "--clash-director-mannequin-neutral",
    "--clash-director-mannequin-masculine",
    "--clash-director-mannequin-feminine",
    "--clash-director-mannequin-broad",
    "--clash-director-mannequin-athletic",
    "--clash-director-mannequin-slender",
    "--clash-director-mannequin-youth",
    "--clash-director-mannequin-child",
    "--clash-director-mannequin-chibi",
    "--clash-director-skeleton",
    "--clash-director-grid-major",
    "--clash-director-grid-minor",
    "--clash-director-camera",
    "--clash-director-axis-x",
    "--clash-director-axis-y",
    "--clash-director-axis-z",
    "--clash-director-axis-label",
    "--clash-director-timeline-surface",
    "--clash-director-timeline-divider",
    "--clash-director-timeline-muted",
    "--clash-director-timeline-label",
    "--clash-director-timeline-keyframe",
  ];

  it("defines every Director chrome, viewport, grid, and timing token centrally", () => {
    for (const token of required) expect(css).toContain(`${token}:`);
  });

  it("provides a dark-theme override rather than coupling the editor to one palette", () => {
    const dark = css.match(/\.dark\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(dark).toContain("--clash-director-panel:");
    expect(dark).toContain("--clash-director-viewport:");
    expect(dark).toContain("--clash-director-panel-text:");
  });

  it("keeps only the 3D viewport dark while chrome inherits the Clash theme", () => {
    const root = css.match(/:root\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(root).toContain("--clash-director-viewport: #08090c;");
    expect(root).toContain("--clash-director-mannequin: #e8ebef;");
    expect(root).toContain("--clash-director-grid-major: #3d7697;");
    expect(root).toContain("--clash-director-grid-minor: #254c67;");
    expect(root).toContain(
      "--clash-director-panel: var(--clash-floating-panel-background);",
    );
    expect(root).toContain("--clash-director-panel-text: var(--foreground);");
    expect(root).toContain("--clash-director-field: var(--canvas-bg);");
    expect(root).toContain(
      "--clash-director-control: var(--clash-floating-toolbar-background);",
    );
    expect(root).toContain(
      "--clash-director-timeline-surface: var(--clash-floating-panel-background);",
    );
    expect(root).not.toContain("--clash-director-panel: #1c1d20;");
  });
});
