import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Editor embedded layout", () => {
  it("protects Preview width by sharing horizontal compression with both side panels", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("'--clash-timeline-side-panel-min-width': sidePanelCollapsed ? '0px' : '12rem'");
    expect(source).toContain("'--clash-timeline-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`");
    expect(source).toContain("'--clash-timeline-preview-min-width': '21rem'");
    expect(source).toContain(
      "'--clash-timeline-inspector-min-width': inspectorCollapsed ? '0px' : '13rem'",
    );
    expect(source).toContain(
      '[grid-template-columns:minmax(var(--clash-timeline-side-panel-min-width),var(--clash-timeline-side-panel-width))_minmax(var(--clash-timeline-preview-min-width),1fr)_minmax(var(--clash-timeline-inspector-min-width),var(--clash-timeline-inspector-width))]',
    );
    expect(source).not.toContain('data-[side-panel-collapsed=true]:[grid-template-columns:');
  });

  it("promotes the Timeline Library into a Jianying-style top-level tool rail", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('data-editor-primary-nav=""');
    expect(source).toContain('aria-label="Timeline editing tools"');
    expect(source).toContain('data-editor-primary-tool={tool.id}');
    expect(source).toContain('TIMELINE_PRIMARY_TOOLS.map((tool)');
    expect(source).toContain("id: 'sound-effects', label: 'Audio'");
    expect(source).toContain("id: 'text', label: 'Text'");
    expect(source).toContain("id: 'stickers', label: 'Graphics'");
    expect(source).toContain("id: 'fx', label: 'Effects'");
    expect(source).toContain("id: 'captions', label: 'Captions'");
    expect(source).not.toContain("id: 'transcript', label: 'Transcript'");
    expect(source).toContain("captions: 'captions'");
    expect(source).toContain('data-editor-region="captions"');
    expect(source).toContain('<CaptionWorkspace');
    expect(source).not.toContain('<TextWorkspaceTabs');
    expect(source).toContain("id: 'filters', label: 'Color'");
    expect(source).not.toContain("id: 'transitions', label: 'Transitions'");
    expect(source).not.toContain("id: 'templates', label: 'Templates'");
    expect(source).not.toContain("id: 'adjustments', label: 'Adjust'");
    expect(source).not.toContain("id: 'motion-graphics', label: 'Motion'");
    expect(source).toContain('selectedCategory={libraryCategory}');
    expect(source).toContain('onSelectedCategoryChange={setLibraryCategory}');
    expect(source).not.toContain("(['media', 'library', 'transcript'] as const)");
  });

  it("keeps the promoted tools icon-only at their natural width across the page", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('<Tooltip key={tool.id} label={tool.label}>');
    expect(source).toContain('aria-label={tool.label}');
    expect(source).not.toContain('whitespace-nowrap text-[length:var(--clash-editor-text-caption)]');
    expect(source).toContain('data-editor-primary-toolbar=""');
    expect(source).toContain('data-editor-command-bar-content=""');
    expect(source).toContain('className="clash-project-chrome-header-content flex min-w-0 flex-1 items-center gap-1"');
    expect(source).toContain('[grid-column:1/4] [grid-row:1]');
    expect(source).not.toContain('[mask-image:linear-gradient(to_right');
    expect(source).not.toContain('data-editor-primary-nav=""\n                    aria-label="Timeline editing tools"\n                    role="tablist"\n                    aria-orientation="horizontal"\n                    className="flex min-w-0 flex-1 items-center gap-0 overflow-x-auto');
    expect(source).toContain('className="flex flex-none items-center gap-0.5"');
    expect(source).toContain('className={`clash-workbench-control-button flex h-8 w-8 shrink-0 items-center justify-center');
    expect(source).toContain('clash-workbench-control-button');
    expect(source).not.toContain('justify-center rounded-matrix transition-colors');
    expect(source).toContain("const [sidePanelWidth, setSidePanelWidth]");
    expect(source).toContain("'--clash-timeline-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`");
    expect(source).toContain('data-editor-resize-handle="side-panel"');
    expect(source).toContain('aria-label="Resize editor panel"');
    expect(source).toContain(
      'className="flex h-[var(--clash-project-sidebar-header-height,2.5rem)] min-h-0 min-w-0 items-center gap-1 overflow-hidden bg-warm-page [grid-column:1/4] [grid-row:1]"',
    );
  });

  it("lets the upper workspace and Timeline resize vertically while Timeline spans full width", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const [timelineHeight, setTimelineHeight]");
    expect(source).toContain("'--clash-timeline-height': `${timelineHeight}px`");
    expect(source).toContain('data-editor-resize-handle="timeline"');
    expect(source).toContain('aria-label="Resize Timeline height"');
    expect(source).toContain('[grid-template-rows:var(--clash-project-sidebar-header-height,2.5rem)_minmax(0,1fr)_var(--clash-timeline-height)]');
    expect(source).toContain('[grid-column:1/4]');
    expect(source).toContain("bg-warm-page [grid-row:2] ${transcriptWorkspaceActive ? '[grid-column:1/4]' : '[grid-column:1]'} ${panelCollapseTransitionClass}");
  });

  it("promotes Timeline text editing across the upper workspace while preserving the full-width Timeline", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const [transcriptWorkspaceExpanded, setTranscriptWorkspaceExpanded]");
    expect(source).toContain("const transcriptWorkspaceActive = transcriptWorkspaceExpanded && !sidePanelCollapsed && embeddedPanel === 'captions'");
    expect(source).toContain("data-transcript-workspace-expanded={transcriptWorkspaceActive ? 'true' : 'false'}");
    expect(source).toContain("onTimelineEditModeChange={setTranscriptWorkspaceExpanded}");
    expect(source).toContain("transcriptWorkspaceActive ? '[grid-column:1/4]' : '[grid-column:1]'");
    expect(source).toContain("aria-hidden={transcriptWorkspaceActive}");
    expect(source).toContain("aria-hidden={inspectorCollapsed || transcriptWorkspaceActive}");
    expect(source).toContain('[grid-column:1/4]');
    expect(source).toContain('[grid-row:3]');
  });

  it("uses global up and down arrows to move between Assets, Canvas, and Timeline workspaces", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('data-editor-workspace="assets"');
    expect(source).toContain('data-editor-workspace="canvas"');
    expect(source).toContain('data-editor-workspace="timeline"');
    expect(source).toContain("event.key !== 'ArrowUp' && event.key !== 'ArrowDown'");
    expect(source).toContain("isEditableEditorShortcutTarget(event.target)");
  });

  it("keeps top-level editing tools connected to the left workspace and Inspector", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("layout?: 'standalone' | 'embedded'");
    expect(source).toContain("data-layout={layout}");
    expect(source).toContain('role="tablist"');
    expect(source).toContain('aria-label="Timeline editing tools"');
    expect(source).toContain("headerLeadingAction?: React.ReactNode");
    expect(source).toContain("{headerLeadingAction}");
    expect(source).toContain("TIMELINE_PRIMARY_TOOLS.map((tool)");
    expect(source).toContain('data-editor-region="library"');
    expect(source).toContain('TimelineLibraryPanel');
    expect(source).toContain('data-editor-region="inspector"');
    expect(source).toContain('aria-label="Timeline Properties"');
    expect(source).toContain('<PropertiesPanel title="Properties" headerAction={collapseInspectorButton} />');
    expect(source).toContain("compact");
    expect(source).toContain('data-editor-region="media"');
    expect(source).toContain('data-editor-region="preview"');
    expect(source).toContain('data-editor-region="timeline"');
    expect(source).toContain("clash-timeline-floating-surface");
    expect(source).toContain('data-editor-grid=""');
    expect(source).toContain('data-side-panel-collapsed={sidePanelCollapsed ? \'true\' : \'false\'}');
    expect(source).toContain('[grid-template-rows:var(--clash-project-sidebar-header-height,2.5rem)_minmax(0,1fr)_var(--clash-timeline-height)]');
    expect(source).not.toContain('_clamp(280px,42%,400px)]');
    expect(source).not.toContain('data-[side-panel-collapsed=true]:[grid-template-columns:');
    expect(source).toContain('data-editor-region="command-bar"');
    expect(source).toContain('data-editor-region="timeline"');
    expect(source).toContain('[grid-column:1/4]');
    expect(source).toContain('[grid-row:3]');
    expect(source).toContain('data-editor-region="inspector"');
    expect(source).toContain('[grid-column:3]');
    expect(source).toContain('[grid-row:2]');
    expect(source).not.toContain("style={{ height: 'clamp(280px, 46%, 440px)' }}");
    expect(source).toContain("onRequestAsset?: () => void");
    expect(source).toContain("onRequestAsset={onRequestAsset}");
    expect(source).toContain("projectAssetDropActive?: boolean");
    expect(source).toContain('data-timeline-project-asset-drop-indicator=""');
  });

  it("collapses the left workspace while keeping its boundary controls available", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const [sidePanelCollapsed, setSidePanelCollapsed]");
    expect(source).toContain('aria-label="Expand editor panel"');
    expect(source).toContain('aria-label="Collapse editor panel"');
    expect(source).toContain('data-editor-primary-nav=""');
    expect(source).toContain("setSidePanelCollapsed(false)");
    expect(source).toContain('showHeader={false}');
    expect(source).toContain('const sidePanelRevealButton = (');
    expect(source).toContain('const collapseSidePanelButton = (');
    expect(source).toContain('headerTrailingAction={collapseSidePanelButton}');
    expect(source).toContain('<EditorPanelToggleIcon collapsed={true} />');
    expect(source).toContain('<EditorPanelToggleIcon collapsed={false} />');
    expect(source).not.toContain("const collapsedSidePanelWidth = '0px'");
    expect(source).not.toContain("'--clash-timeline-collapsed-width'");
    expect(source).not.toContain('data-[side-panel-collapsed=true]:[grid-template-columns:');
    expect(source).toContain("'--clash-timeline-side-panel-min-width': sidePanelCollapsed ? '0px' : '12rem'");
    expect(source).toContain("'--clash-timeline-side-panel-width': sidePanelCollapsed ? '0px' : `${sidePanelWidth}px`");
    expect(source).toContain("group/timeline-editor");
    expect(source).not.toContain("const previewGridColumnClass = sidePanelCollapsed");
    expect(source).toContain('bg-warm-page [grid-column:2] [grid-row:2]');
  });

  it("pins the tool rail independently of the resizable side-panel width", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('data-editor-panel-controls=""');
    expect(source).not.toContain(
      "minWidth: sidePanelCollapsed ? 'auto' : 'var(--clash-timeline-side-panel-width)'",
    );
    expect(source).not.toContain(
      "width: sidePanelCollapsed ? 'auto' : 'var(--clash-timeline-side-panel-width)'",
    );
    expect(source).toContain(
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
    const inspectorActionsIndex = source.indexOf('data-editor-region="inspector-actions"');

    expect(panelControlsIndex).toBeGreaterThan(-1);
    expect(primaryNavIndex).toBeGreaterThan(panelControlsIndex);
    expect(primaryNavIndex).toBeLessThan(inspectorActionsIndex);
  });

  it("replaces the pinned creative tools with one reveal control while the left workspace is collapsed", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /\{!sidePanelCollapsed \? \(\s+<nav[\s\S]*?data-editor-primary-nav=""/,
    );
    expect(source).toMatch(/<\/nav>\s+\) : sidePanelRevealButton\}/);
  });

  it("keeps the first creative tool in the same slot as the collapsed reveal control", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('className="flex flex-none items-center gap-0.5"');
    expect(source).not.toContain('className="flex flex-none items-center gap-0.5 px-2"');
  });

  it("uses one mirrored collapse motion contract for the left panel and Inspector", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const panelCollapseTransitionClass = 'transition-[opacity,transform] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none';");
    expect(source.match(/\$\{panelCollapseTransitionClass\}/g)).toHaveLength(2);
    expect(source).toContain('aria-hidden={sidePanelCollapsed}');
    expect(source).toContain("'pointer-events-none -translate-x-2 opacity-0'");
    expect(source).toContain("'pointer-events-none translate-x-2 opacity-0'");
    expect(source).toContain("'translate-x-0 opacity-100'");
    expect(source).not.toContain('const previewGridColumnClass = sidePanelCollapsed');
    expect(source).toContain('bg-warm-page [grid-column:2] [grid-row:2]');
  });

  it("collapses Inspector without leaving its grid column behind", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const [inspectorCollapsed, setInspectorCollapsed]");
    expect(source).toContain(
      "data-inspector-collapsed={inspectorCollapsed ? 'true' : 'false'}",
    );
    expect(source).toContain(
      "'--clash-timeline-inspector-width': inspectorCollapsed ? '0px' : 'clamp(280px,22%,340px)'",
    );
    expect(source).toContain("var(--clash-timeline-inspector-width)");
    expect(source).toContain('aria-label="Expand Properties"');
    expect(source).toContain('aria-label="Collapse Properties"');
    expect(source).toContain("setInspectorCollapsed((collapsed) => !collapsed)");
    expect(source).toContain('const InspectorRevealIcon: React.FC');
    expect(source).toContain('const inspectorRevealButton = (');
    expect(source).toContain('const collapseInspectorButton = (');
    expect(source).toContain('<InspectorRevealIcon />');
    expect(source).toContain('<InspectorPanelToggleIcon collapsed={false} />');
    expect(source).toContain('bg-brand/[0.09] text-brand transition-colors hover:bg-brand/[0.14]');
    expect(source).toContain("aria-hidden={inspectorCollapsed || transcriptWorkspaceActive}");
    expect(source).toContain('panelCollapseTransitionClass');
    expect(source).toContain("'pointer-events-none translate-x-2 opacity-0'");
    expect(source).toContain("'translate-x-0 opacity-100'");
    expect(source).not.toContain("const previewGridColumnClass = sidePanelCollapsed");
    expect(source).not.toContain("const previewGridColumnClass = inspectorCollapsed");
    expect(source).toContain('[grid-column:1/4]');
    expect(source).toContain('headerAction={collapseInspectorButton}');
    expect(source.indexOf('{inspectorCollapsed ? inspectorRevealButton : null}')).toBeLessThan(
      source.indexOf('<OpenInMenu'),
    );
    expect(source).toContain(
      'className="ml-auto flex w-max shrink-0 items-center justify-end gap-2"',
    );
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

    expect(source).toContain('data-editor-primary-nav=""');
    expect(source).not.toContain('[mask-image:linear-gradient(to_right');
    expect(source).not.toContain("sideToolbarSurfaceClassName");
    expect(source).not.toContain("clash-timeline-toolbar-surface");
    expect(source).not.toContain("rounded-lg p-[3px]");
    expect(source).toContain("clash-timeline-panel-surface");
    expect(assetPanelSource).toContain("clash-timeline-panel-surface");
    expect(source).toContain("'bg-brand/[0.09] text-brand hover:bg-brand/[0.14]'");
  });

  it("uses a continuous pane workspace instead of a rounded-card matrix", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const embeddedLayout = source.slice(
      source.indexOf('data-editor-grid=""'),
      source.indexOf('<div className="flex h-full gap-3', source.indexOf('data-editor-grid=""')),
    );

    expect(embeddedLayout).toContain("gap-[var(--clash-timeline-gutter)] overflow-hidden bg-warm-page");
    expect(embeddedLayout).toContain("pb-[var(--clash-timeline-gutter)] pl-[var(--clash-timeline-gutter)]");
    expect(embeddedLayout).not.toContain(
      "pl-[var(--clash-timeline-gutter)] pr-[var(--clash-timeline-gutter)] motion-reduce",
    );
    expect(embeddedLayout).not.toContain("pt-[var(--clash-timeline-gutter)]");
    expect(embeddedLayout).toContain("bg-warm-page [grid-row:2] ${transcriptWorkspaceActive ? '[grid-column:1/4]' : '[grid-column:1]'} ${panelCollapseTransitionClass}");
    expect(embeddedLayout).toContain("[--clash-timeline-gutter:var(--clash-project-chrome-gutter,0.5rem)]");
    expect(embeddedLayout).toContain("[--clash-timeline-control-gap:var(--clash-control-gap,0.25rem)]");
    expect(embeddedLayout).not.toContain("--clash-timeline-header-inset");
    expect(embeddedLayout).toContain('data-editor-region="command-bar"');
    expect(embeddedLayout).toContain('[grid-column:1/4] [grid-row:1]');
    expect(embeddedLayout).not.toContain("[--clash-project-chrome-gutter:0.5rem]");
    expect(embeddedLayout).not.toContain("clash-canvas-overlay-panel");
    expect(embeddedLayout).not.toContain("clash-canvas-toolbar-surface");
    expect(embeddedLayout).not.toContain("clash-canvas-menu-surface");
    expect(embeddedLayout).not.toContain("shadow-[0_8px_24px");
  });

  it("uses a right gutter only when the external Copilot launcher is collapsed into the header", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    const embeddedLayout = source.slice(
      source.indexOf('data-editor-grid=""'),
      source.indexOf('<div className="flex h-full gap-3', source.indexOf('data-editor-grid=""')),
    );

    expect(source).toContain(
      "const reserveHeaderEndGutter = headerEndInset > 0;",
    );
    expect(embeddedLayout).toContain(
      "${reserveHeaderEndGutter ? 'pr-[var(--clash-timeline-gutter)]' : ''}",
    );
    expect(embeddedLayout).not.toContain(
      "pl-[var(--clash-timeline-gutter)] pr-[var(--clash-timeline-gutter)] motion-reduce",
    );
    expect(embeddedLayout).not.toContain("overflow-visible");
  });

  it("contains compact media rows instead of clipping them behind the Preview boundary", () => {
    const source = readFileSync(
      new URL("./AssetPanel.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "clash-timeline-panel-surface rounded-matrix bg-warm-surface p-2 min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto",
    );
    expect(source).toContain(
      'data-asset-list="" className={`flex min-w-0 flex-col',
    );
    expect(source).toContain(
      "group flex w-full min-w-0 cursor-move items-center overflow-hidden",
    );
  });

  it("merges Export and Open in into one menu above the right-side Inspector", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("onOpenInNle?: (target: NleTarget) => Promise<void>");
    expect(source).toContain('data-editor-region="command-bar"');
    expect(source).toContain('data-editor-region="inspector-actions"');
    expect(source).toContain('<OpenInMenu');
    expect(source).toContain('onExport={onExport}');
    expect(source).not.toContain('onClick={() => void runExport()}');
    expect(source).toContain('availability={nleAvailability}');
    expect(source).toContain('onRefreshAvailability={onRefreshNleAvailability}');
    expect(source.indexOf('{inspectorCollapsed ? inspectorRevealButton : null}')).toBeLessThan(
      source.indexOf('<OpenInMenu'),
    );
    expect(source.indexOf('data-editor-region="command-bar"')).toBeLessThan(
      source.indexOf('<PropertiesPanel title="Properties" headerAction={collapseInspectorButton} />'),
    );
  });

  it("aligns the command actions with the Inspector and Timeline right edge", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const commandBarClass = source.match(
      /data-editor-region="command-bar"\s+className="([^"]+)"/,
    )?.[1] ?? "";

    expect(commandBarClass).toBe(
      "flex h-[var(--clash-project-sidebar-header-height,2.5rem)] min-h-0 min-w-0 items-center gap-1 overflow-hidden bg-warm-page [grid-column:1/4] [grid-row:1]",
    );
    expect(commandBarClass).not.toContain("px-2");
  });

  it("matches the Copilot shell top inset without moving the editor panels", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('[grid-template-rows:var(--clash-project-sidebar-header-height,2.5rem)_minmax(0,1fr)_var(--clash-timeline-height)]');
    expect(source).not.toContain('pt-[var(--clash-timeline-gutter)]');
  });

  it("rounds the Inspector content without pulling its command bar into the panel", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );
    const commandBarIndex = source.indexOf('data-editor-region="command-bar"');
    const inspectorPanelIndex = source.indexOf('data-editor-inspector-panel=""');

    expect(inspectorPanelIndex).toBeGreaterThan(commandBarIndex);
    expect(source).toContain('data-editor-inspector-panel=""');
    expect(source).toContain('clash-timeline-panel-surface min-h-0 flex-1 overflow-hidden bg-warm-surface');
    expect(source).toContain('clash-timeline-preview-surface clash-timeline-panel-surface h-full w-full overflow-hidden bg-warm-surface');
    expect(source).toContain('clash-timeline-floating-surface clash-timeline-panel-surface relative flex min-h-0 min-w-0 overflow-hidden bg-warm-surface');
    expect(source).not.toContain('data-editor-inspector-panel=""\n                className="m-2 min-h-0 flex-1 overflow-hidden rounded-xl border');
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

    expect(source).not.toContain("panel: 'transcript'");
    expect(source).not.toContain("TranscriptEditor");
    expect(captionWorkspaceSource).toContain('deriveTimelineTranscriptWords');
    expect(captionWorkspaceSource).toContain("type CaptionWorkspaceView = 'recognize' | 'edit' | 'import' | 'styles'");
    expect(source).toContain('[grid-template-columns:minmax(var(--clash-timeline-side-panel-min-width),var(--clash-timeline-side-panel-width))_minmax(var(--clash-timeline-preview-min-width),1fr)_minmax(var(--clash-timeline-inspector-min-width),var(--clash-timeline-inspector-width))]');
    expect(source).toContain('data-editor-primary-nav=""');
    expect(source).toContain('aria-orientation="horizontal"');
    expect(source).toContain("{ id: 'media', label: 'Media', panel: 'media' }");
    expect(source).not.toContain("{ id: 'transcript', label: 'Transcript', panel: 'transcript' }");
    expect(source).toContain("{ id: 'captions', label: 'Captions', panel: 'captions' }");
    expect(source).toContain("type EmbeddedPanel = 'media' | 'library' | 'captions'");
    expect(source).toContain('data-editor-region="captions"');
    expect(captionWorkspaceSource).toContain('data-editor-caption-workspace=""');
    expect(source).toContain('onTranscribeAsset={onTranscribeAsset}');
    expect(source).not.toContain('const isTextWorkspace =');
    expect(source).not.toContain('active={textWorkspaceView}');
    expect(source).not.toContain("width: embeddedPanel");
    expect(source).not.toContain("grid-cols-3 rounded-md bg-slate-100");
    expect(captionWorkspaceSource).toContain('aria-label="Import subtitle file"');
    expect(captionWorkspaceSource).toContain('aria-label={`Caption sentence ${index + 1} text`}');
    expect(source).not.toContain("Apply transcript edits");
  });

  it("delegates scoped media selection to the host workspace", () => {
    const source = readFileSync(
      new URL("./AssetPanel.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain("onRequestAsset?: () => void");
    expect(source).toContain("onClick={onRequestAsset}");
    expect(source).toContain("Add media");
  });

  it("uses a concise, locale-consistent empty Timeline state", () => {
    const source = readFileSync(
      new URL("./timeline/TimelineTracksContainer.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("Drop media to start editing");
    expect(source).toContain(
      "Drag from Media, or add text and color from Quick add.",
    );
    expect(source).not.toContain("轨道标签");
    expect(source).not.toContain("开始你的创作");
  });

  it("remeasures the Timeline viewport when its parent surface is squeezed", () => {
    const source = readFileSync(
      new URL("./Timeline.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("new ResizeObserver(measure)");
    expect(source).toContain("resizeObserver?.observe(el)");
    expect(source).toContain("resizeObserver?.disconnect()");
  });

  it("reserves only a compact header slot for an external Copilot launcher", () => {
    const source = readFileSync(
      new URL("./Editor.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("headerEndInset?: number");
    expect(source).toContain("style={{ paddingRight: headerEndInset }}");
  });
});
