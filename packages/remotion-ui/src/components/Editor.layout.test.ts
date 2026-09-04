import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  normalizeSource,
  sourceContains,
} from "@clash/gui/test-support/source-match";

expect.extend({
  toContainSource(received: unknown, expected: string) {
    const pass =
      typeof received === "string" && sourceContains(received, expected);
    return {
      pass,
      message: () =>
        `expected source ${pass ? "not " : ""}to contain normalized snippet:\n${expected}`,
    };
  },
});

declare module "vitest" {
  interface Assertion<T = any> {
    toContainSource(expected: string): T;
  }
}

describe("Editor embedded layout", () => {
  it("protects Preview width by sharing horizontal compression with both side panels", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "'--clash-timeline-side-panel-min-width': sidePanelCollapsed ? '0px' : 'min(12rem,25%)'",
    );
    expect(source).toContainSource(
      "'--clash-timeline-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`",
    );
    expect(source).toContainSource(
      "'--clash-timeline-preview-min-width': 'min(21rem,42%)'",
    );
    expect(source).toContainSource(
      "'--clash-timeline-inspector-min-width': inspectorCollapsed ? '0px' : 'min(13rem,28%)'",
    );
    expect(source).toContainSource(
      "[grid-template-columns:minmax(var(--clash-timeline-side-panel-min-width),var(--clash-timeline-side-panel-width))_minmax(var(--clash-timeline-preview-min-width),1fr)_minmax(var(--clash-timeline-inspector-min-width),var(--clash-timeline-inspector-width))]",
    );
    expect(source).not.toContainSource(
      "data-[side-panel-collapsed=true]:[grid-template-columns:",
    );
  });

  it("promotes the Timeline Library into a Jianying-style top-level tool rail", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource('data-editor-primary-nav=""');
    expect(source).toContainSource('aria-label="Timeline editing tools"');
    expect(source).toContainSource("data-editor-primary-tool={tool.id}");
    expect(source).toContainSource("TIMELINE_PRIMARY_TOOLS.map((tool)");
    expect(source).toContainSource("id: 'sound-effects', label: 'Audio'");
    expect(source).toContainSource("id: 'text', label: 'Text'");
    expect(source).toContainSource("id: 'stickers', label: 'Graphics'");
    expect(source).toContainSource("id: 'fx', label: 'Effects'");
    expect(source).toContainSource("id: 'captions', label: 'Captions'");
    expect(source).not.toContainSource("id: 'transcript', label: 'Transcript'");
    expect(source).toContainSource("captions: 'captions'");
    expect(source).toContainSource('data-editor-region="captions"');
    expect(source).toContainSource("<CaptionWorkspace");
    expect(source).not.toContainSource("<TextWorkspaceTabs");
    expect(source).toContainSource("id: 'filters', label: 'Color'");
    expect(source).not.toContainSource(
      "id: 'transitions', label: 'Transitions'",
    );
    expect(source).not.toContainSource("id: 'templates', label: 'Templates'");
    expect(source).not.toContainSource("id: 'adjustments', label: 'Adjust'");
    expect(source).not.toContainSource(
      "id: 'motion-graphics', label: 'Motion'",
    );
    expect(source).toContainSource("selectedCategory={libraryCategory}");
    expect(source).toContainSource(
      "onSelectedCategoryChange={setLibraryCategory}",
    );
    expect(source).not.toContainSource(
      "(['media', 'library', 'transcript'] as const)",
    );
  });

  it("keeps the promoted tools icon-only at their natural width across the page", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "<Tooltip key={tool.id} label={tool.label}>",
    );
    expect(source).toContainSource("aria-label={tool.label}");
    expect(source).not.toContainSource(
      "whitespace-nowrap text-[length:var(--clash-editor-text-caption)]",
    );
    expect(source).toContainSource('data-editor-primary-toolbar=""');
    expect(source).toContainSource('data-editor-command-bar-content=""');
    expect(source).toContainSource(
      'className="clash-project-chrome-header-content flex min-w-0 flex-1 items-center gap-1"',
    );
    expect(source).toContainSource("[grid-column:1/4] [grid-row:1]");
    expect(source).not.toContainSource("[mask-image:linear-gradient(to_right");
    expect(source).not.toContainSource(
      'data-editor-primary-nav=""\n                    aria-label="Timeline editing tools"\n                    role="tablist"\n                    aria-orientation="horizontal"\n                    className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto',
    );
    expect(source).toContainSource(
      'className="flex flex-none items-center gap-0.5"',
    );
    expect(source).toContainSource(
      "className={`clash-workbench-control-button flex h-8 w-8 shrink-0 items-center justify-center",
    );
    expect(source).toContainSource("clash-workbench-control-button");
    expect(source).not.toContainSource(
      "justify-center rounded-matrix transition-colors",
    );
    expect(source).toContainSource("const [sidePanelWidth, setSidePanelWidth]");
    expect(source).toContainSource(
      "'--clash-timeline-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`",
    );
    expect(source).toContainSource('data-editor-resize-handle="side-panel"');
    expect(source).toContainSource('aria-label="Resize editor panel"');
    expect(source).toContainSource(
      'className="flex h-[var(--clash-project-sidebar-header-height,2.5rem)] min-h-0 min-w-0 items-center gap-1 overflow-hidden bg-warm-page [grid-column:1/4] [grid-row:1]"',
    );
  });

  it("keeps inactive Timeline and caption tools readable on dark hover", () => {
    const sources = [
      new URL("./Editor.tsx", import.meta.url),
      new URL("./CaptionWorkspace.tsx", import.meta.url),
    ].map((url) => readFileSync(url, "utf8"));

    for (const source of sources) {
      expect(source).not.toContainSource("hover:bg-black/[0.035]");
      expect(source).toContainSource("text-content-muted");
      expect(source).toContainSource("hover:bg-warm-hover");
      expect(source).toContainSource("hover:text-content-primary");
    }
  });

  it("lets the upper workspace and Timeline resize vertically while Timeline spans full width", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource("const [timelineHeight, setTimelineHeight]");
    expect(source).toContainSource(
      "'--clash-timeline-height': `${timelineHeight}px`",
    );
    expect(source).toContainSource('data-editor-resize-handle="timeline"');
    expect(source).toContainSource('aria-label="Resize Timeline height"');
    expect(source).toContainSource(
      "[grid-template-rows:var(--clash-project-sidebar-header-height,2.5rem)_minmax(0,1fr)_var(--clash-timeline-height)]",
    );
    expect(source).toContainSource("[grid-column:1/4]");
    expect(source).toContainSource(
      "bg-warm-page [grid-row:2] ${transcriptWorkspaceActive ? '[grid-column:1/4]' : '[grid-column:1]'} ${panelCollapseTransitionClass}",
    );
  });

  it("promotes Timeline text editing across the upper workspace while preserving the full-width Timeline", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "const [transcriptWorkspaceExpanded, setTranscriptWorkspaceExpanded]",
    );
    expect(source).toContainSource(
      "const transcriptWorkspaceActive = transcriptWorkspaceExpanded && !sidePanelCollapsed && embeddedPanel === 'captions'",
    );
    expect(source).toContainSource(
      "data-transcript-workspace-expanded={transcriptWorkspaceActive ? 'true' : 'false'}",
    );
    expect(source).toContainSource(
      "onTimelineEditModeChange={setTranscriptWorkspaceExpanded}",
    );
    expect(source).toContainSource(
      "transcriptWorkspaceActive ? '[grid-column:1/4]' : '[grid-column:1]'",
    );
    expect(source).toContainSource("aria-hidden={transcriptWorkspaceActive}");
    expect(source).toContainSource(
      "aria-hidden={inspectorCollapsed || transcriptWorkspaceActive}",
    );
    expect(source).toContainSource("[grid-column:1/4]");
    expect(source).toContainSource("[grid-row:3]");
  });

  it("uses global up and down arrows to move between Assets, Canvas, and Timeline workspaces", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource('data-editor-workspace="assets"');
    expect(source).toContainSource('data-editor-workspace="canvas"');
    expect(source).toContainSource('data-editor-workspace="timeline"');
    expect(source).toContainSource(
      "event.key !== 'ArrowUp' && event.key !== 'ArrowDown'",
    );
    expect(source).toContainSource(
      "isEditableEditorShortcutTarget(event.target)",
    );
  });

  it("keeps top-level editing tools connected to the left workspace and Inspector", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource("layout?: 'standalone' | 'embedded'");
    expect(source).toContainSource("data-layout={layout}");
    expect(source).toContainSource('role="tablist"');
    expect(source).toContainSource('aria-label="Timeline editing tools"');
    expect(source).toContainSource("headerLeadingAction?: React.ReactNode");
    expect(source).toContainSource("{headerLeadingAction}");
    expect(source).toContainSource("TIMELINE_PRIMARY_TOOLS.map((tool)");
    expect(source).toContainSource('data-editor-region="library"');
    expect(source).toContainSource("TimelineLibraryPanel");
    expect(source).toContainSource('data-editor-region="inspector"');
    expect(source).toContainSource('aria-label="Timeline Properties"');
    expect(source).toContainSource(
      '<PropertiesPanel title="Properties" headerAction={collapseInspectorButton} />',
    );
    expect(source).toContainSource("compact");
    expect(source).toContainSource('data-editor-region="media"');
    expect(source).toContainSource('data-editor-region="preview"');
    expect(source).toContainSource('data-editor-region="timeline"');
    expect(source).toContainSource("clash-timeline-floating-surface");
    expect(source).toContainSource('data-editor-grid=""');
    expect(source).toContainSource(
      "data-side-panel-collapsed={sidePanelCollapsed ? 'true' : 'false'}",
    );
    expect(source).toContainSource(
      "[grid-template-rows:var(--clash-project-sidebar-header-height,2.5rem)_minmax(0,1fr)_var(--clash-timeline-height)]",
    );
    expect(source).not.toContainSource("_clamp(280px,42%,400px)]");
    expect(source).not.toContainSource(
      "data-[side-panel-collapsed=true]:[grid-template-columns:",
    );
    expect(source).toContainSource('data-editor-region="command-bar"');
    expect(source).toContainSource('data-editor-region="timeline"');
    expect(source).toContainSource("[grid-column:1/4]");
    expect(source).toContainSource("[grid-row:3]");
    expect(source).toContainSource('data-editor-region="inspector"');
    expect(source).toContainSource("[grid-column:3]");
    expect(source).toContainSource("[grid-row:2]");
    expect(source).not.toContainSource(
      "style={{ height: 'clamp(280px, 46%, 440px)' }}",
    );
    expect(source).toContainSource("onRequestAsset?: () => void");
    expect(source).toContainSource("onRequestAsset={onRequestAsset}");
    expect(source).toContainSource("projectAssetDropActive?: boolean");
    expect(source).toContainSource(
      'data-timeline-project-asset-drop-indicator=""',
    );
  });

  it("collapses the left workspace while keeping its boundary controls available", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "const [sidePanelCollapsed, setSidePanelCollapsed]",
    );
    expect(source).toContainSource('aria-label="Expand editor panel"');
    expect(source).toContainSource('aria-label="Collapse editor panel"');
    expect(source).toContainSource('data-editor-primary-nav=""');
    expect(source).toContainSource("setSidePanelCollapsed(false)");
    expect(source).toContainSource("showHeader={false}");
    expect(source).toContainSource("const sidePanelRevealButton = (");
    expect(source).toContainSource("const collapseSidePanelButton = (");
    expect(source).toContainSource(
      "headerTrailingAction={collapseSidePanelButton}",
    );
    expect(source).toContainSource(
      "<EditorPanelToggleIcon collapsed={true} />",
    );
    expect(source).toContainSource(
      "<EditorPanelToggleIcon collapsed={false} />",
    );
    expect(source).not.toContainSource("const collapsedSidePanelWidth = '0px'");
    expect(source).not.toContainSource("'--clash-timeline-collapsed-width'");
    expect(source).not.toContainSource(
      "data-[side-panel-collapsed=true]:[grid-template-columns:",
    );
    expect(source).toContainSource(
      "'--clash-timeline-side-panel-min-width': sidePanelCollapsed ? '0px' : 'min(12rem,25%)'",
    );
    expect(source).toContainSource(
      "'--clash-timeline-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`",
    );
    expect(source).toContainSource("group/timeline-editor");
    expect(source).not.toContainSource(
      "const previewGridColumnClass = sidePanelCollapsed",
    );
    expect(source).toContainSource("bg-warm-page [grid-column:2] [grid-row:2]");
  });

  it("pins the tool rail independently of the resizable side-panel width", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource('data-editor-panel-controls=""');
    expect(source).not.toContainSource(
      "minWidth: sidePanelCollapsed ? 'auto' : 'var(--clash-timeline-side-panel-width)'",
    );
    expect(source).not.toContainSource(
      "width: sidePanelCollapsed ? 'auto' : 'var(--clash-timeline-side-panel-width)'",
    );
    expect(source).toContainSource(
      'className="flex w-max shrink-0 items-center gap-[var(--clash-timeline-control-gap)]"',
    );
  });

  it("keeps the creative tool rail inside the left-panel header", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const panelControlsIndex = source.indexOf('data-editor-panel-controls=""');
    const primaryNavIndex = source.indexOf('data-editor-primary-nav=""');
    const inspectorActionsIndex = source.indexOf(
      'data-editor-region="inspector-actions"',
    );

    expect(panelControlsIndex).toBeGreaterThan(-1);
    expect(primaryNavIndex).toBeGreaterThan(panelControlsIndex);
    expect(primaryNavIndex).toBeLessThan(inspectorActionsIndex);
  });

  it("replaces the pinned creative tools with one reveal control while the left workspace is collapsed", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const branchStart = source.indexOf("{!sidePanelCollapsed ? (");
    const revealIndex = source.indexOf("sidePanelRevealButton", branchStart);
    const branchEnd = source.indexOf(")}", revealIndex);

    expect(branchStart).toBeGreaterThan(-1);
    expect(revealIndex).toBeGreaterThan(branchStart);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const collapsedPanelBranch = source.slice(
      branchStart,
      branchEnd + ")}".length,
    );
    expect(collapsedPanelBranch).toContainSource(
      '{!sidePanelCollapsed ? (<nav data-editor-primary-nav=""',
    );
    expect(collapsedPanelBranch).toContainSource(
      "</nav>) : (sidePanelRevealButton)}",
    );
  });

  it("keeps the first creative tool in the same slot as the collapsed reveal control", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      'className="flex flex-none items-center gap-0.5"',
    );
    expect(source).not.toContainSource(
      'className="flex flex-none items-center gap-0.5 px-2"',
    );
  });

  it("uses one mirrored collapse motion contract for the left panel and Inspector", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "const panelCollapseTransitionClass = 'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';",
    );
    expect(source.match(/\$\{panelCollapseTransitionClass\}/g)).toHaveLength(2);
    expect(source).toContainSource("aria-hidden={sidePanelCollapsed}");
    expect(source).toContainSource(
      "'pointer-events-none -translate-x-2 opacity-0'",
    );
    expect(source).toContainSource(
      "'pointer-events-none translate-x-2 opacity-0'",
    );
    expect(source).toContainSource("'translate-x-0 opacity-100'");
    expect(source).not.toContainSource(
      "const previewGridColumnClass = sidePanelCollapsed",
    );
    expect(source).toContainSource("bg-warm-page [grid-column:2] [grid-row:2]");
  });

  it("collapses Inspector without leaving its grid column behind", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "const [inspectorCollapsed, setInspectorCollapsed]",
    );
    expect(source).toContainSource(
      "data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}",
    );
    expect(source).toContainSource(
      "'--clash-timeline-inspector-width': inspectorCollapsed ? '0px' : `${inspectorWidth}px`",
    );
    expect(source).toContainSource("var(--clash-timeline-inspector-width)");
    expect(source).toContainSource('aria-label="Expand Properties"');
    expect(source).toContainSource('aria-label="Collapse Properties"');
    expect(source).toContainSource(
      "setInspectorCollapsed((collapsed) => !collapsed)",
    );
    expect(source).toContainSource("const InspectorRevealIcon: React.FC");
    expect(source).toContainSource("const inspectorRevealButton = (");
    expect(source).toContainSource("const collapseInspectorButton = (");
    expect(source).toContainSource("<InspectorRevealIcon />");
    expect(source).toContainSource(
      "<InspectorPanelToggleIcon collapsed={false} />",
    );
    expect(source).toContainSource(
      "bg-brand/[0.09] text-brand transition-colors hover:bg-brand/[0.14]",
    );
    expect(source).toContainSource(
      "aria-hidden={inspectorCollapsed || transcriptWorkspaceActive}",
    );
    expect(source).toContainSource("panelCollapseTransitionClass");
    expect(source).toContainSource(
      "'pointer-events-none translate-x-2 opacity-0'",
    );
    expect(source).toContainSource("'translate-x-0 opacity-100'");
    expect(source).not.toContainSource(
      "const previewGridColumnClass = sidePanelCollapsed",
    );
    expect(source).not.toContainSource(
      "const previewGridColumnClass = inspectorCollapsed",
    );
    expect(source).toContainSource("[grid-column:1/4]");
    expect(source).toContainSource("headerAction={collapseInspectorButton}");
    expect(
      source.indexOf("{inspectorCollapsed ? inspectorRevealButton : null}"),
    ).toBeLessThan(source.indexOf("<OpenInMenu"));
    expect(source).toContainSource(
      'className="ml-auto flex w-max shrink-0 items-center justify-end gap-2"',
    );
  });

  it("resizes Properties from its left edge with pointer and keyboard controls", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "const [inspectorWidth, setInspectorWidth]",
    );
    expect(source).toContainSource(
      'data-editor-resize-handle="inspector"',
    );
    expect(source).toContainSource('aria-label="Resize Properties panel"');
    expect(source).toContainSource('aria-orientation="vertical"');
    expect(source).toContainSource(
      "if (event.key === 'ArrowLeft') resizeInspectorBy(12)",
    );
    expect(source).toContainSource(
      "if (event.key === 'ArrowRight') resizeInspectorBy(-12)",
    );
    expect(source).toContainSource(
      "onPointerDown={handleInspectorResizePointerDown}",
    );
    expect(source).toContainSource(
      "onPointerMove={handleInspectorResizePointerMove}",
    );
    expect(source).toContainSource("onPointerUp={finishInspectorResize}");
    expect(source).toContainSource("onPointerCancel={finishInspectorResize}");
    expect(source).toContainSource("[grid-column:3] [grid-row:2]");
    expect(source).toContainSource("cursor-col-resize");
    expect(source).toContainSource("const keepInspectorInsideWorkspace");
    expect(source).not.toContainSource("const keepPanelsInsideWorkspace");
  });

  it("keeps the side controls flat and lets the content own the floating surface", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const assetPanelSource = readFileSync(
      new URL("./AssetPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource('data-editor-primary-nav=""');
    expect(source).not.toContainSource("[mask-image:linear-gradient(to_right");
    expect(source).not.toContainSource("sideToolbarSurfaceClassName");
    expect(source).not.toContainSource("clash-timeline-toolbar-surface");
    expect(source).not.toContainSource("rounded-lg p-[3px]");
    expect(source).toContainSource("clash-timeline-panel-surface");
    expect(assetPanelSource).toContainSource("clash-timeline-panel-surface");
    expect(source).toContainSource(
      "'bg-brand/[0.09] text-brand hover:bg-brand/[0.14]'",
    );
  });

  it("uses a continuous pane workspace instead of a rounded-card matrix", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const embeddedLayout = source.slice(
      source.indexOf('data-editor-grid=""'),
      source.indexOf(
        '<div className="flex h-full gap-3',
        source.indexOf('data-editor-grid=""'),
      ),
    );

    expect(embeddedLayout).toContainSource(
      "gap-[var(--clash-timeline-gutter)] overflow-hidden bg-warm-page",
    );
    expect(embeddedLayout).toContainSource(
      "pb-[var(--clash-timeline-gutter)] pl-[var(--clash-timeline-gutter)]",
    );
    expect(embeddedLayout).not.toContainSource(
      "pl-[var(--clash-timeline-gutter)] pr-[var(--clash-timeline-gutter)] motion-reduce",
    );
    expect(embeddedLayout).not.toContainSource(
      "pt-[var(--clash-timeline-gutter)]",
    );
    expect(embeddedLayout).toContainSource(
      "bg-warm-page [grid-row:2] ${transcriptWorkspaceActive ? '[grid-column:1/4]' : '[grid-column:1]'} ${panelCollapseTransitionClass}",
    );
    expect(embeddedLayout).toContainSource(
      "[--clash-timeline-gutter:var(--clash-project-chrome-gutter,0.5rem)]",
    );
    expect(embeddedLayout).toContainSource(
      "[--clash-timeline-control-gap:var(--clash-control-gap,0.25rem)]",
    );
    expect(embeddedLayout).not.toContainSource("--clash-timeline-header-inset");
    expect(embeddedLayout).toContainSource('data-editor-region="command-bar"');
    expect(embeddedLayout).toContainSource("[grid-column:1/4] [grid-row:1]");
    expect(embeddedLayout).not.toContainSource(
      "[--clash-project-chrome-gutter:0.5rem]",
    );
    expect(embeddedLayout).not.toContainSource("clash-canvas-overlay-panel");
    expect(embeddedLayout).not.toContainSource("clash-canvas-toolbar-surface");
    expect(embeddedLayout).not.toContainSource("clash-canvas-menu-surface");
    expect(embeddedLayout).not.toContainSource("shadow-[0_8px_24px");
  });

  it("uses a right gutter only when the external Copilot launcher is collapsed into the header", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    const embeddedLayout = source.slice(
      source.indexOf('data-editor-grid=""'),
      source.indexOf(
        '<div className="flex h-full gap-3',
        source.indexOf('data-editor-grid=""'),
      ),
    );

    expect(source).toContainSource(
      "const reserveHeaderEndGutter = headerEndInset > 0;",
    );
    expect(embeddedLayout).toContainSource(
      "${reserveHeaderEndGutter ? 'pr-[var(--clash-timeline-gutter)]' : ''}",
    );
    expect(embeddedLayout).not.toContainSource(
      "pl-[var(--clash-timeline-gutter)] pr-[var(--clash-timeline-gutter)] motion-reduce",
    );
    expect(embeddedLayout).not.toContainSource("overflow-visible");
  });

  it("contains compact media rows instead of clipping them behind the Preview boundary", () => {
    const source = readFileSync(
      new URL("./AssetPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "clash-timeline-panel-surface rounded-matrix bg-warm-surface p-2 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
    );
    expect(source).toContainSource(
      'data-asset-list="" className={`flex min-w-0 flex-col',
    );
    expect(source).toContainSource(
      "group flex w-full min-w-0 cursor-move items-center overflow-hidden",
    );
  });

  it("merges Export and Open in into one menu above the right-side Inspector", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const normalizedSource = normalizeSource(source);

    expect(source).toContainSource(
      "onOpenInNle?: (target: NleTarget) => Promise<void>",
    );
    expect(source).toContainSource('data-editor-region="command-bar"');
    expect(source).toContainSource('data-editor-region="inspector-actions"');
    expect(source).toContainSource("<OpenInMenu");
    expect(source).toContainSource("onExport={onExport}");
    expect(source).not.toContainSource("onClick={() => void runExport()}");
    expect(source).toContainSource("availability={nleAvailability}");
    expect(source).toContainSource(
      "onRefreshAvailability={onRefreshNleAvailability}",
    );
    expect(
      normalizedSource.indexOf(
        normalizeSource("{inspectorCollapsed ? inspectorRevealButton : null}"),
      ),
    ).toBeLessThan(normalizedSource.indexOf(normalizeSource("<OpenInMenu")));
    expect(
      normalizedSource.indexOf(
        normalizeSource('data-editor-region="command-bar"'),
      ),
    ).toBeLessThan(
      normalizedSource.indexOf(
        normalizeSource(
          '<PropertiesPanel title="Properties" headerAction={collapseInspectorButton} />',
        ),
      ),
    );
  });

  it("aligns the command actions with the Inspector and Timeline right edge", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const commandBarClass =
      source.match(
        /data-editor-region="command-bar"\s+className="([^"]+)"/,
      )?.[1] ?? "";

    expect(commandBarClass).toBe(
      "flex h-[var(--clash-project-sidebar-header-height,2.5rem)] min-h-0 min-w-0 items-center gap-1 overflow-hidden bg-warm-page [grid-column:1/4] [grid-row:1]",
    );
    expect(commandBarClass).not.toContainSource("px-2");
  });

  it("matches the Copilot shell top inset without moving the editor panels", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource(
      "[grid-template-rows:var(--clash-project-sidebar-header-height,2.5rem)_minmax(0,1fr)_var(--clash-timeline-height)]",
    );
    expect(source).not.toContainSource("pt-[var(--clash-timeline-gutter)]");
  });

  it("rounds the Inspector content without pulling its command bar into the panel", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const commandBarIndex = source.indexOf('data-editor-region="command-bar"');
    const inspectorPanelIndex = source.indexOf(
      'data-editor-inspector-panel=""',
    );

    expect(inspectorPanelIndex).toBeGreaterThan(commandBarIndex);
    expect(source).toContainSource('data-editor-inspector-panel=""');
    expect(source).toContainSource(
      "clash-timeline-panel-surface min-h-0 flex-1 overflow-hidden bg-warm-surface",
    );
    expect(source).toContainSource(
      "clash-timeline-preview-surface clash-timeline-panel-surface h-full w-full overflow-hidden bg-warm-surface",
    );
    expect(source).toContainSource(
      "clash-timeline-floating-surface clash-timeline-panel-surface relative flex min-h-0 min-w-0 overflow-hidden bg-warm-surface",
    );
    expect(source).not.toContainSource(
      'data-editor-inspector-panel=""\n                className="m-2 min-h-0 flex-1 overflow-hidden rounded-xl border',
    );
  });

  it("keeps Text and Captions separate while transcript powers the caption workflow", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const captionWorkspaceSource = readFileSync(
      new URL("./CaptionWorkspace.tsx", import.meta.url),
      "utf8",
    );

    expect(source).not.toContainSource("panel: 'transcript'");
    expect(source).not.toContainSource("TranscriptEditor");
    expect(captionWorkspaceSource).toContainSource(
      "deriveTimelineTranscriptWords",
    );
    expect(captionWorkspaceSource).toContainSource(
      "type CaptionWorkspaceView = 'recognize' | 'edit' | 'import' | 'styles'",
    );
    expect(source).toContainSource(
      "[grid-template-columns:minmax(var(--clash-timeline-side-panel-min-width),var(--clash-timeline-side-panel-width))_minmax(var(--clash-timeline-preview-min-width),1fr)_minmax(var(--clash-timeline-inspector-min-width),var(--clash-timeline-inspector-width))]",
    );
    expect(source).toContainSource('data-editor-primary-nav=""');
    expect(source).toContainSource('aria-orientation="horizontal"');
    expect(source).toContainSource(
      "{ id: 'media', label: 'Media', panel: 'media' }",
    );
    expect(source).not.toContainSource(
      "{ id: 'transcript', label: 'Transcript', panel: 'transcript' }",
    );
    expect(source).toContainSource(
      "{ id: 'captions', label: 'Captions', panel: 'captions' }",
    );
    expect(source).toContainSource(
      "type EmbeddedPanel = 'media' | 'library' | 'captions'",
    );
    expect(source).toContainSource('data-editor-region="captions"');
    expect(captionWorkspaceSource).toContainSource(
      'data-editor-caption-workspace=""',
    );
    expect(source).toContainSource("onTranscribeAsset={onTranscribeAsset}");
    expect(source).not.toContainSource("const isTextWorkspace =");
    expect(source).not.toContainSource("active={textWorkspaceView}");
    expect(source).not.toContainSource("width: embeddedPanel");
    expect(source).not.toContainSource("grid-cols-3 rounded-md bg-slate-100");
    expect(captionWorkspaceSource).toContainSource(
      'aria-label="Import subtitle file"',
    );
    expect(captionWorkspaceSource).toContainSource(
      "aria-label={`Caption sentence ${index + 1} text`}",
    );
    expect(source).not.toContainSource("Apply transcript edits");
  });

  it("delegates scoped media selection to the host workspace", () => {
    const source = readFileSync(
      new URL("./AssetPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContainSource("onRequestAsset?: () => void");
    expect(source).toContainSource("onClick={onRequestAsset}");
    expect(source).toContainSource("Add media");
  });

  it("uses a concise, locale-consistent empty Timeline state", () => {
    const source = readFileSync(
      new URL("./timeline/TimelineTracksContainer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource("Drop media to start editing");
    expect(source).toContainSource(
      "Drag from Media, or add text and color from Quick add.",
    );
    expect(source).not.toContainSource("轨道标签");
    expect(source).not.toContainSource("开始你的创作");
  });

  it("remeasures the Timeline viewport when its parent surface is squeezed", () => {
    const source = readFileSync(
      new URL("./Timeline.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource("new ResizeObserver(measure)");
    expect(source).toContainSource("resizeObserver?.observe(el)");
    expect(source).toContainSource("resizeObserver?.disconnect()");
  });

  it("reserves only a compact header slot for an external Copilot launcher", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContainSource("headerEndInset?: number");
    expect(source).toContainSource("style={{ paddingRight: headerEndInset }}");
  });
});
