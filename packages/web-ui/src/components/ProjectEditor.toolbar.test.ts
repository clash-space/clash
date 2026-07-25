import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../../../..");
const projectEditorSource = readFileSync(
  resolve(root, "packages/web-ui/src/components/ProjectEditor.tsx"),
  "utf8",
);
const projectWorkspaceNavigatorSource = readFileSync(
  resolve(root, "packages/web-ui/src/components/ProjectWorkspaceNavigator.tsx"),
  "utf8",
);
const globalCss = readFileSync(
  resolve(root, "apps/web/app/globals.css"),
  "utf8",
);

describe("ProjectEditor toolbar surface", () => {
  it("exposes Director Stage as a first-class canvas tool", () => {
    expect(projectEditorSource).toContain('{ id: "director-stage", label: "Director Stage", icon: Cube }');
  });

  it("uses canvas-specific chrome instead of the shared floating surface", () => {
    expect(projectEditorSource).toContain("clash-canvas-toolbar-surface");
    expect(projectEditorSource).toContain("clash-canvas-menu-surface");
    expect(projectEditorSource).not.toContain(
      "clash-control-surface pointer-events-auto flex flex-col",
    );
  });

  it("uses one fixed 48px vertical rail for every canvas mode and tool", () => {
    expect(projectEditorSource).toContain('id="project-workspace-shell"');
    expect(projectEditorSource).toContain("grid-cols-[12rem_minmax(0,1fr)]");
    expect(projectEditorSource).toContain(
      "data-[project-navigator-collapsed=true]:grid-cols-[0_minmax(0,1fr)]",
    );
    expect(projectEditorSource).not.toContain(
      "data-[project-navigator-collapsed=true]:grid-cols-[3rem_minmax(0,1fr)]",
    );
    expect(projectEditorSource).not.toContain(
      "clash-project-sidebar-toggle-button",
    );
    expect(projectEditorSource).toContain('className="absolute inset-0');
    expect(projectEditorSource).toContain("<Toolbar.Root");
    expect(projectEditorSource).toContain(
      "clash-canvas-toolbar-surface pointer-events-auto flex w-12",
    );
    expect(projectEditorSource).toMatch(
      /orientation=["']vertical["'][\s\S]*?aria-label=["']Canvas mode["']/,
    );
    expect(projectEditorSource).toContain(
      'className="flex w-full flex-col items-center gap-0"',
    );
    expect(projectEditorSource.match(/<Toolbar\.Separator/g)).toHaveLength(2);
    expect(projectEditorSource).not.toContain("clash-canvas-mode-surface");
    expect(projectEditorSource).not.toContain("clash-canvas-utility-surface");
    expect(projectEditorSource).not.toContain("left-52 right-0");
    expect(projectEditorSource).not.toContain("left-[220px]");
    expect(projectEditorSource).not.toContain("top-1/2");
    expect(projectEditorSource).not.toContain("-translate-y-1/2");
    expect(projectEditorSource).not.toContain("rounded-2xl py-6");
    expect(globalCss).toMatch(
      /\.clash-canvas-toolbar-surface\s*\{[\s\S]*width:\s*3rem;/,
    );
    expect(globalCss).toMatch(
      /\.clash-canvas-toolbar-surface\s*\{[\s\S]*overflow:\s*visible;/,
    );
  });

  it("aligns sidebar and canvas controls to the same chrome grid", () => {
    expect(projectEditorSource).toContain(
      "[--clash-project-chrome-gutter:0.5rem] [--clash-project-control-height:2rem] [--clash-project-control-rhythm:var(--clash-project-control-height)] [--clash-project-action-phase:var(--clash-project-chrome-gutter)] [--clash-project-search-row-height:calc(var(--clash-project-control-rhythm)+var(--clash-project-action-phase))] [--clash-project-sidebar-header-height:2.5rem] [--clash-project-frame-top:calc(var(--clash-project-sidebar-header-height)+var(--clash-project-chrome-gutter))]",
    );
    expect(projectEditorSource).toContain(
      "[--clash-project-header-content-offset-y:var(--clash-control-gap)]",
    );
    expect(projectEditorSource).toContain(
      "data-canvas-folders-open={canvasFoldersOpen}",
    );
    expect(projectEditorSource).toContain(
      "[--clash-project-control-rail-left:var(--clash-project-chrome-gutter)] data-[canvas-folders-open=true]:[--clash-project-control-rail-left:13rem]",
    );
    expect(projectEditorSource).not.toContain("--clash-project-canvas-left");
    expect(projectEditorSource).toContain(
      "left-[var(--clash-project-control-rail-left)]",
    );
    expect(projectEditorSource).toContain(
      "top-[var(--clash-project-frame-top)]",
    );
    expect(projectEditorSource).not.toContain(
      'isProjectNavigatorCollapsed ? "top-12"',
    );
    expect(projectEditorSource).not.toContain(
      'className="absolute left-3 top-4',
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      'className="clash-project-sidebar-header flex h-10 shrink-0 items-center px-2"',
    );
    expect(projectWorkspaceNavigatorSource).not.toContain(
      "clash-project-sidebar-header flex h-12",
    );
    expect(projectWorkspaceNavigatorSource).not.toMatch(
      /clash-project-sidebar-header[^\n]*border-b/,
    );
    expect(projectEditorSource).toContain(
      'clash-project-sidebar-header-content clash-project-chrome-header-content flex min-w-0 flex-1 items-center',
    );
    expect(projectEditorSource).not.toContain(
      "translate-y-[var(--clash-control-gap,0.25rem)]",
    );
    const headerContentRule =
      globalCss.match(/\.clash-project-chrome-header-content\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(headerContentRule).toContain("transform: translateY(");
    expect(headerContentRule).toContain("--clash-project-header-content-offset-y");
    expect(headerContentRule).toContain("var(--clash-control-gap, 0.25rem)");
    expect(projectEditorSource).toMatch(
      /isProjectNavigatorCollapsed\s*\?\s*["']{2}\s*:\s*["']-ml-px["']/,
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      'className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-[var(--clash-project-action-phase,0.5rem)]"',
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      'className="clash-project-sidebar-search flex h-[var(--clash-project-search-row-height,2.5rem)] shrink-0 items-start px-2 pt-[var(--clash-project-action-phase,0.5rem)]"',
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      'aria-label="Search project"',
    );
    expect(projectEditorSource).toContain(
      "clash-canvas-toolbar-surface pointer-events-auto flex w-12 flex-col items-center gap-0 rounded-lg py-[var(--clash-project-action-phase)] transition-colors [--clash-toolbar-section-gap:var(--clash-project-action-phase)]",
    );
    expect(projectEditorSource).toContain(
      'className="flex w-full flex-col items-center gap-0"',
    );
    expect(
      projectEditorSource.match(/h-\[var\(--clash-toolbar-section-gap\)\]/g),
    ).toHaveLength(2);
    expect(projectEditorSource).toMatch(
      /const sectionSpacing\s*=\s*item\.id\s*===\s*["']actions["']\s*\?\s*["']mt-\[var\(--clash-toolbar-section-gap\)\]["']\s*:\s*["']{2};/,
    );
    expect(projectEditorSource).not.toContain(
      'size="md"\n                                                shape="rounded"',
    );
  });

  it("uses a shared rhythm with an offset action phase instead of pairwise row anchors", () => {
    expect(projectEditorSource).toContain(
      "[--clash-project-control-rhythm:var(--clash-project-control-height)]",
    );
    expect(projectEditorSource).toContain(
      "[--clash-project-action-phase:var(--clash-project-chrome-gutter)]",
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      "h-[var(--clash-project-control-rhythm,2rem)]",
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      "pt-[var(--clash-project-action-phase,0.5rem)]",
    );
    expect(projectEditorSource).toContain(
      "py-[var(--clash-project-action-phase)]",
    );
    expect(projectEditorSource).not.toContain(
      "--clash-project-toolbar-shell-top",
    );
  });

  it("uses one measured folder header and action column for every project collection", () => {
    expect(projectWorkspaceNavigatorSource).toContain(
      'const sectionHeaderClass =\n  "flex h-[var(--clash-project-control-rhythm,2rem)] items-center justify-between px-1";',
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      'const sidebarActionSlotClass =\n  "clash-project-sidebar-action-slot h-6 min-h-6 w-6 min-w-6";',
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      "data-project-folder-header",
    );
    expect(projectWorkspaceNavigatorSource).toContain('label="Add Asset"');
    expect(projectWorkspaceNavigatorSource).toContain("Add from Global Assets");
    expect(projectWorkspaceNavigatorSource).not.toContain(
      'data-sidebar-action-slot="asset-count"',
    );
    expect(projectWorkspaceNavigatorSource).not.toContain(
      "absolute right-2 text-[11px] tabular-nums",
    );
    expect(projectWorkspaceNavigatorSource).toContain(
      '"group/menu-button relative flex h-[var(--clash-project-control-rhythm,2rem)]',
    );
    expect(projectWorkspaceNavigatorSource).not.toContain('className="mt-3"');
    expect(projectWorkspaceNavigatorSource).toContain(
      'className="mt-[var(--clash-project-action-phase,0.5rem)] first:mt-0"',
    );
  });

  it("keeps canvas dots out of the toolbar surface texture", () => {
    const toolbarTextureRule =
      globalCss.match(
        /\.clash-canvas-toolbar-surface::before,[\s\S]*?\.clash-canvas-menu-surface::before\s*\{[\s\S]*?\}/,
      )?.[0] ?? "";
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
    expect(projectEditorSource).not.toContain(
      "clash-canvas-toolbar-flyout-layer",
    );
    expect(projectEditorSource).not.toContain("activeMenuPosition");
    expect(projectEditorSource).not.toContain("toolbarFlyoutRef");
    expect(projectEditorSource).not.toContain("shouldDismissToolbarMenu");
  });

  it("lets Radix own toolbar submenu open state", () => {
    expect(projectEditorSource).not.toContain(
      "const [activeMenu, setActiveMenu]",
    );
    expect(projectEditorSource).not.toContain("open={isActive}");
    expect(projectEditorSource).not.toContain(
      "onOpenChange={(open) => setActiveMenu",
    );
    expect(projectEditorSource).not.toContain("setActiveMenu(null)");
    expect(projectEditorSource).toContain("data-[state=open]:bg-brand/10");
    expect(projectEditorSource).toContain("data-[state=open]:text-brand");
  });

  it("does not let the menu surface override fixed flyout positioning", () => {
    const menuSurfaceRule =
      globalCss.match(/\.clash-canvas-menu-surface\s*\{[\s\S]*?\}/)?.[0] ?? "";
    expect(menuSurfaceRule).not.toContain("position:");
  });

  it("uses native form submission for the inline project title editor", () => {
    expect(projectEditorSource).toContain("onSubmit={handleProjectNameSubmit}");
    expect(projectEditorSource).toMatch(
      /<ProjectWorkspaceNavigator[\s\S]*header=\{[\s\S]*id="editor-header"/,
    );
    expect(projectEditorSource).not.toContain(
      'id="editor-header" className="absolute',
    );
    expect(projectEditorSource).not.toContain(
      "onKeyDown={(e) => {\n                                        if (e.key === 'Enter')",
    );
    expect(projectEditorSource).not.toContain(
      "querySelector<HTMLInputElement>('input')",
    );
  });

  it("keeps collaboration and cloud admission controls out of local project chrome", () => {
    expect(projectEditorSource).not.toContain("useProjectStatus(project.id)");
    expect(projectEditorSource).not.toContain("resolveProjectShareAdmission");
    expect(projectEditorSource).not.toContain("resolveProjectWebAdmission");
    expect(projectEditorSource).not.toContain(
      'aria-label="Open project in web"',
    );
    expect(projectEditorSource).not.toContain('aria-label="Copy project link"');
    expect(projectEditorSource).not.toContain(
      "<PresenceBar clients={otherClients} />",
    );
    expect(projectEditorSource).toContain("footer={<UserControls compact />}");
  });
});
