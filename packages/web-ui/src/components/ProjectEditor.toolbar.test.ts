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

  it("keeps canvas dots out of the toolbar surface texture", () => {
    const toolbarTextureRule = globalCss.match(/\.clash-canvas-toolbar-surface::before,[\s\S]*?\.clash-canvas-menu-surface::before\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(toolbarTextureRule).not.toContain("var(--canvas-dot)");
    expect(toolbarTextureRule).not.toMatch(/radial-gradient/);
    expect(toolbarTextureRule).toContain("content: none");
  });

  it("uses Radix dropdown primitives for toolbar submenus", () => {
    expect(projectEditorSource).toContain("DropdownMenu");
    expect(projectEditorSource).toContain("DropdownMenuTrigger");
    expect(projectEditorSource).toContain("DropdownMenuContent");
    expect(projectEditorSource).toContain("DropdownMenuItem");
    expect(projectEditorSource).not.toContain("createPortal");
    expect(projectEditorSource).not.toContain("clash-canvas-toolbar-flyout-layer");
    expect(projectEditorSource).not.toContain("activeMenuPosition");
    expect(projectEditorSource).not.toContain("toolbarFlyoutRef");
    expect(projectEditorSource).not.toContain("shouldDismissToolbarMenu");
  });

  it("does not let the menu surface override fixed flyout positioning", () => {
    const menuSurfaceRule = globalCss.match(/\.clash-canvas-menu-surface\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(menuSurfaceRule).not.toContain("position:");
  });
});
