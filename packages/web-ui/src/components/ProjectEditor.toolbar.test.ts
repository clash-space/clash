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

  it("lets Radix own toolbar submenu open state", () => {
    expect(projectEditorSource).not.toContain("const [activeMenu, setActiveMenu]");
    expect(projectEditorSource).not.toContain("open={isActive}");
    expect(projectEditorSource).not.toContain("onOpenChange={(open) => setActiveMenu");
    expect(projectEditorSource).not.toContain("setActiveMenu(null)");
    expect(projectEditorSource).toContain("data-[state=open]:bg-brand");
    expect(projectEditorSource).toContain("data-[state=open]:text-white");
  });

  it("does not let the menu surface override fixed flyout positioning", () => {
    const menuSurfaceRule = globalCss.match(/\.clash-canvas-menu-surface\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(menuSurfaceRule).not.toContain("position:");
  });

  it("uses native form submission for the inline project title editor", () => {
    expect(projectEditorSource).toContain("onSubmit={handleProjectNameSubmit}");
    expect(projectEditorSource).not.toContain("onKeyDown={(e) => {\n                                        if (e.key === 'Enter')");
    expect(projectEditorSource).not.toContain("querySelector<HTMLInputElement>('input')");
  });

  it("gates project sharing through project status action gates", () => {
    expect(projectEditorSource).toContain("useProjectStatus(project.id)");
    expect(projectEditorSource).toContain("projectStatus.actions?.shareProject");
    expect(projectEditorSource).not.toContain("getRuntimeCapabilities().loro.persistence !== 'local'");
  });

  it("surfaces the project status open-in-web gate without inventing a web URL", () => {
    expect(projectEditorSource).toContain("projectStatus.actions?.openInWeb");
    expect(projectEditorSource).toContain("resolveProjectWebAdmission");
    expect(projectEditorSource).toContain("projectWebAdmission.visible");
    expect(projectEditorSource).toContain("disabled={!projectWebAdmission.allowed}");
    expect(projectEditorSource).not.toContain("window.open(window.location.href");
    expect(projectEditorSource).not.toContain("window.location.href = window.location.href");
  });
});
