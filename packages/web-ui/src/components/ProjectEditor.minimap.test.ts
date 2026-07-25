import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./ProjectEditor.tsx", import.meta.url),
  "utf8",
);
const globalCss = readFileSync(
  new URL("../../../../apps/web/app/globals.css", import.meta.url),
  "utf8",
);

describe("ProjectEditor canvas minimap", () => {
  it("renders an interactive minimap inside the ReactFlow canvas", () => {
    expect(source).toMatch(
      /import\s*\{[\s\S]*?MiniMap[\s\S]*?\}\s*from ["']@xyflow\/react["']/,
    );
    expect(source).toMatch(
      /<MiniMap[\s\S]*?ariaLabel="Canvas minimap"[\s\S]*?position="bottom-left"[\s\S]*?pannable[\s\S]*?zoomable[\s\S]*?\/>/,
    );
    expect(source).toContain('label="Expand canvas minimap"');
    expect(source).toContain("data-canvas-minimap-resize-handle");
    expect(source).toContain("clash-canvas-minimap-resize-handle");
    expect(source).toContain("clash-canvas-minimap-resize-grip");
    expect(globalCss).toMatch(
      /\.clash-canvas-minimap-resize-grip\s*\{[\s\S]*?border-top:\s*1px solid currentColor;[\s\S]*?border-right:\s*1px solid currentColor;[\s\S]*?border-top-right-radius:\s*7px;/,
    );
    expect(globalCss).not.toContain("transform: rotate(-45deg)");
    expect(globalCss).not.toContain("-4px 4px 0 currentColor");
    expect(source).toMatch(/onPointerDown=\{\s*startMinimapResize\s*\}/);
    expect(source).toContain("shouldCollapseMinimap");
    expect(source).toContain("isExpandedMinimapSize(nextSize)");
  });

  it("keeps the minimap legible against the warm canvas", () => {
    expect(globalCss).toContain(
      "--canvas-minimap-mask: rgba(255, 254, 253, 0.2)",
    );
    expect(globalCss).toContain("--canvas-minimap-group: #eee9e1");
    expect(globalCss).toContain("--canvas-minimap-group-stroke: #b8afa4");
    expect(globalCss).toMatch(
      /\.dark\s*\{[\s\S]*--canvas-minimap-node: #737373/,
    );
    expect(source).toMatch(
      /node\.type === "group"\s*\? "var\(--canvas-minimap-group\)"/,
    );
    expect(source).toContain(
      'maskStrokeColor="var(--canvas-minimap-viewport)"',
    );
    expect(source).toContain("maskStrokeWidth={1.5}");
    expect(source).toMatch(
      /style=\{\{\s*width: minimapSize\.width,\s*height: minimapSize\.height,?\s*\}\}/,
    );
    expect(source).toContain("offsetScale={8}");
    expect(globalCss).toContain("--canvas-minimap-viewport: var(--clash-accent)");
  });

  it("floats folders above the canvas, omits the header, and treats Main as the implicit root", () => {
    expect(source).toContain("{!canvasFoldersOpen ? (");
    expect(source).toMatch(
      /style=\{\{\s*bottom: minimapControlOffset,?\s*\}\}/,
    );
    expect(source).toMatch(
      /<Tooltip\s+label="Canvas folders"\s+placement="right"\s*>/,
    );
    expect(source).toContain('label="Canvas folders"');
    expect(source).toMatch(
      /icon=\{\s*<FolderSimple\s+className="h-3.5 w-3.5"\s+weight="regular"\s*\/>\s*\}/,
    );
    expect(source).not.toMatch(/>\s*Canvas folders\s*<\/Button>/);
    expect(source).toContain('label="Collapse canvas folders"');
    expect(source).toMatch(
      /onClick=\{\(\) =>\s*setCanvasFoldersOpen\(false\)\s*\}/,
    );
    expect(source).toContain('node.type === "group"');
    expect(source).toContain('aria-label="Canvas folders"');
    expect(source).toContain("isImplicitCanvasRoot(canvas.name)");
    expect(source).toContain("{canvas.name}");
    expect(source).toContain("canvas.id === activeCanvasId");
    expect(source).toContain("<CanvasFolderEntries");
    expect(source).not.toContain("clash-canvas-folders-header");
    expect(source).toContain("absolute inset-0 z-0");
    expect(source).not.toContain(
      "left-[var(--clash-project-canvas-left)] transition-[left]",
    );
    expect(source).toContain("left-[var(--clash-project-control-rail-left)]");
    expect(source).toMatch(
      /data-canvas-folders-panel[\s\S]*?className="[^"]*bottom-\[var\(--clash-project-chrome-gutter\)\]/,
    );
    expect(source).toMatch(
      /data-canvas-folders-panel[\s\S]*?className="[^"]*top-\[var\(--clash-project-frame-top\)\]/,
    );
    expect(source).toContain("clash-canvas-overlay-panel");
    expect(globalCss).toMatch(
      /\.clash-canvas-overlay-panel\s*\{[\s\S]*?isolation:\s*isolate;[\s\S]*?border-radius:\s*8px;[\s\S]*?contain:\s*layout paint;/,
    );
    expect(source).not.toContain("No folders yet");
    expect(source).not.toContain("Groups on this canvas appear here.");
    expect(source).toContain("left-[var(--clash-project-control-rail-left)]");
    expect(source).not.toContain('canvasFoldersOpen ? "left-[13rem]"');
    expect(source).toMatch(/reactFlowInstanceRef\.current\?\.fitView\(\s*\{/);
  });

  it("keeps ungrouped assets at the canvas root and grouped assets under their group folder", () => {
    expect(source).toContain("buildCanvasFolderEntries(nodes, projectAssets)");
    expect(source).toContain('kind: "asset"');
    expect(source).toContain('entry.kind === "group"');
    expect(source).toContain("node.parentId");
    expect(source).toContain(
      "resolveCanvasNodeProjectAsset(node, projectAssets)",
    );
    expect(source).toContain("onSelect={focusCanvasFolderNode}");
  });

  it("adds folder search and uses real asset thumbnails", () => {
    expect(source).toContain('aria-label="Search canvas folders"');
    expect(source).toContain('placeholder="Search"');
    expect(source).toContain("canvasFolderQuery");
    expect(source).toContain("filteredCanvasFolderEntries");
    expect(source).toContain("filterCanvasFolderEntries");
    expect(source).toContain("useAsset(assetId)");
    expect(source).toContain("projectAssetThumbnailSource(entry.asset)");
    expect(source.indexOf("entry.asset?.thumbnailUrl")).toBeLessThan(
      source.indexOf("entry.node.data?.previewUrl"),
    );
    expect(source).toContain("<AssetThumbnail");
    expect(source).toMatch(
      /data-canvas-folders-panel[\s\S]*?className="[^"]*top-\[var\(--clash-project-frame-top\)\]/,
    );
    expect(source).toContain(
      "relative flex h-[var(--clash-project-control-rhythm)] shrink-0",
    );
    expect(source).toContain(
      "after:absolute after:inset-x-1.5 after:bottom-0 after:h-px",
    );
    expect(source).toContain(
      "h-[var(--clash-project-control-rhythm)] border-transparent bg-transparent",
    );
    expect(source).toContain(
      "min-h-0 flex-1 overflow-y-auto px-1.5 pb-10 pt-[var(--clash-project-action-phase)]",
    );
    expect(source).toContain(
      "flex h-[var(--clash-project-control-rhythm)] w-full items-center",
    );
    expect(source).not.toContain("relative flex h-10 shrink-0");
    expect(source).not.toContain("shrink-0 items-center border-b");
    expect(source).toContain(
      "top-[var(--clash-project-frame-top)] z-20 flex w-48",
    );
    expect(source).not.toContain("border-warm-border bg-warm-page/70 pl-8");
  });

  it("animates between the expanded minimap and its collapsed button", () => {
    expect(source).toContain("AnimatePresence");
    expect(source).toContain("const [minimapResizing, setMinimapResizing]");
    expect(source).toMatch(
      /animate=\{\{\s*width: minimapCollapsed\s*\? 36\s*: minimapSize\.width,\s*height: minimapCollapsed\s*\? 36\s*: minimapSize\.height,/,
    );
    expect(source).toContain('key="expanded-minimap"');
    expect(source).toContain('key="collapsed-minimap"');
    expect(source).toMatch(/minimapResizing\s*\? \{ duration: 0 \}/);
    expect(source).toContain("collapseVelocityFromPointer");
    expect(source).toContain("setMinimapCollapseVelocity");
    expect(source).toContain('type: "spring"');
    expect(source).toMatch(/velocity:\s*-minimapCollapseVelocity/);
    expect(source).toContain("transition-[bottom] duration-200 ease-out");
  });

  it("keeps folder and minimap at the bottom while canvas actions stay in the toolbar", () => {
    expect(source).toMatch(
      /pointer-events-none absolute bottom-\[var\(--clash-project-chrome-gutter\)\] left-\[var\(--clash-project-control-rail-left\)\] z-10 flex flex-col items-start gap-2/,
    );
    expect(source).toContain(
      "calc(${minimapCollapsed ? 36 : minimapSize.height}px + var(--clash-project-chrome-gutter) + var(--clash-project-chrome-gutter))",
    );
    const lowerControlsStart = source.indexOf(
      "pointer-events-none absolute bottom-[var(--clash-project-chrome-gutter)]",
    );
    const lowerControlsEnd = source.indexOf("</ReactFlow>", lowerControlsStart);
    const lowerControls = source.slice(lowerControlsStart, lowerControlsEnd);
    expect(lowerControls).not.toContain('label="Auto Layout"');
    expect(lowerControls).not.toContain('label="Center view on nodes"');
    expect(lowerControls).toContain("{minimapCollapsed ? (");
    expect(source).toMatch(
      /<Toolbar\.Root[\s\S]*?<Tooltip\s+label="Auto Layout"[\s\S]*?<Tooltip\s+label="Center view on nodes"/,
    );
    expect(
      source.match(/<IconButton\s*\n\s*label="Auto Layout"/g),
    ).toHaveLength(1);
    expect(source).toMatch(
      /icon=\{\s*<MagicWand\s+className="h-3.5 w-3.5"\s+weight="regular"\s*\/>\s*\}/,
    );
    expect(source).toMatch(
      /icon=\{\s*<Crosshair\s+className="h-3.5 w-3.5"\s+weight="bold"\s*\/>\s*\}/,
    );
    expect(source).toMatch(
      /icon=\{\s*<MapTrifold\s+className="h-3.5 w-3.5"\s+weight="regular"\s*\/>\s*\}/,
    );
  });

  it("stretches the canvas-folder panel to the bottom of the workspace", () => {
    expect(source).toContain("bottom-[var(--clash-project-chrome-gutter)]");
    expect(source).not.toContain("max-h-[min(28rem,calc(100%-5.5rem))]");
  });

  it("recenters the viewport on the average center of all nodes", () => {
    expect(source).toContain("averageRectCenters(");
    expect(source).toContain("centerViewportOnAverageNodePosition");
    expect(source).not.toContain(
      "nodesRef.current.filter((node) => !node.hidden)",
    );
    expect(source).toContain("reactFlowInstanceRef.current?.setCenter(");
    expect(source).toContain('label="Center view on nodes"');
  });
});
