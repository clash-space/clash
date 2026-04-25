import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../..");
const projectEditorSource = readFileSync(
  resolve(root, "packages/web-ui/src/components/ProjectEditor.tsx"),
  "utf8",
);
const globalCss = readFileSync(resolve(root, "apps/web/app/globals.css"), "utf8");

describe("ProjectEditor toolbar surface", () => {
  it("uses canvas-specific chrome instead of the shared floating surface", () => {
    expect(projectEditorSource).toContain("clash-canvas-toolbar-surface");
    expect(projectEditorSource).toContain("clash-canvas-menu-surface");
    expect(projectEditorSource).not.toContain(
      "clash-control-surface pointer-events-auto flex flex-col",
    );
  });

  it("keeps the vertical toolbar constrained to icon rail dimensions", () => {
    expect(globalCss).toMatch(/\.clash-canvas-toolbar-surface\s*\{[\s\S]*width:\s*4rem;/);
    expect(globalCss).toMatch(/\.clash-canvas-toolbar-surface\s*\{[\s\S]*overflow:\s*visible;/);
  });

  it("renders submenu flyouts outside the toolbar rail", () => {
    expect(projectEditorSource).toContain("createPortal");
    expect(projectEditorSource).toContain("clash-canvas-toolbar-flyout-layer");
    expect(projectEditorSource).toContain("pointer-events-auto fixed flex flex-col");
    expect(projectEditorSource).not.toContain("absolute left-full top-0 ml-4");
  });

  it("does not let the menu surface override fixed flyout positioning", () => {
    const menuSurfaceRule = globalCss.match(/\.clash-canvas-menu-surface\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(menuSurfaceRule).not.toContain("position:");
  });
});
