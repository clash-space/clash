import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { sourceContains, sourceMatches } from "../test-support/source-match";
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
    expect(
      sourceContains(source, 'label="Expand canvas minimap"'),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "data-canvas-minimap-resize-handle"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "clash-canvas-minimap-resize-handle"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "clash-canvas-minimap-resize-grip"),
      "mechanism missing",
    ).toBe(true);
    expect(globalCss).toMatch(
      /\.clash-canvas-minimap-resize-grip\s*\{[\s\S]*?border-top:\s*1px solid currentColor;[\s\S]*?border-right:\s*1px solid currentColor;[\s\S]*?border-top-right-radius:\s*7px;/,
    );
    expect(globalCss).not.toContain("transform: rotate(-45deg)");
    expect(globalCss).not.toContain("-4px 4px 0 currentColor");
    expect(
      sourceMatches(source, /onPointerDown=\{\s*startMinimapResize\s*\}/),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "shouldCollapseMinimap"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "isExpandedMinimapSize(nextSize)"),
      "mechanism missing",
    ).toBe(true);
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
    expect(
      sourceContains(
        source,
        'maskStrokeColor="var(--canvas-minimap-viewport)"',
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "maskStrokeWidth={1.5}"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceMatches(
        source,
        /style=\{\{\s*width: minimapSize\.width,\s*height: minimapSize\.height,?\s*\}\}/,
      ),
      `mechanism missing`,
    ).toBe(true);
    expect(sourceContains(source, "offsetScale={8}"), "mechanism missing").toBe(
      true,
    );
    expect(globalCss).toContain(
      "--canvas-minimap-viewport: var(--clash-accent)",
    );
  });

  it("floats folders above the canvas, omits the header, and treats Main as the implicit root", () => {
    expect(
      sourceContains(source, "{!canvasFoldersOpen ? ("),
      "mechanism missing",
    ).toBe(true);
    expect(source).toMatch(
      /style=\{\{\s*bottom: minimapControlOffset,?\s*\}\}/,
    );
    expect(source).toMatch(
      /<Tooltip\s+label="Canvas folders"\s+placement="right"\s*>/,
    );
    expect(
      sourceContains(source, 'label="Canvas folders"'),
      "mechanism missing",
    ).toBe(true);
    expect(source).toMatch(
      /icon=\{\s*<FolderSimple\s+className="h-3.5 w-3.5"\s+weight="regular"\s*\/>\s*\}/,
    );
    expect(
      sourceMatches(source, />\s*Canvas folders\s*<\/Button>/),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceContains(source, 'label="Collapse canvas folders"'),
      "mechanism missing",
    ).toBe(true);
    expect(source).toMatch(
      /onClick=\{\(\) =>\s*setCanvasFoldersOpen\(false\)\s*\}/,
    );
    expect(
      sourceContains(source, 'node.type === "group"'),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, 'aria-label="Canvas folders"'),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "isImplicitCanvasRoot(canvas.name)"),
      "mechanism missing",
    ).toBe(true);
    expect(sourceContains(source, "{canvas.name}"), "mechanism missing").toBe(
      true,
    );
    expect(
      sourceContains(source, "canvas.id === activeCanvasId"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "<CanvasFolderEntries"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "clash-canvas-folders-header"),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceContains(source, "absolute inset-0 z-0"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(
        source,
        "left-[var(--clash-project-canvas-left)] transition-[left]",
      ),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceContains(source, "left-[var(--clash-project-control-rail-left)]"),
      "mechanism missing",
    ).toBe(true);
    expect(source).toMatch(
      /data-canvas-folders-panel[\s\S]*?className="[^"]*bottom-\[var\(--clash-project-chrome-gutter\)\]/,
    );
    expect(source).toMatch(
      /data-canvas-folders-panel[\s\S]*?className="[^"]*top-\[var\(--clash-project-frame-top\)\]/,
    );
    expect(
      sourceContains(source, "clash-canvas-overlay-panel"),
      "mechanism missing",
    ).toBe(true);
    // Locks the intent, not the old magic number: the panel is isolated and takes
    // its radius from the shared workbench token. Asserting `8px` pinned a value
    // that has since moved to `--clash-workbench-surface-radius` (now 10px), so
    // the literal only detected the token migration, not a regression.
    expect(
      sourceMatches(
        globalCss,
        /\.clash-canvas-overlay-panel[^{]*\{[^}]*?isolation:\s*isolate;[^}]*?border-radius:\s*var\(--clash-workbench-surface-radius\);/,
      ),
      `mechanism missing`,
    ).toBe(true);
    expect(sourceContains(source, "No folders yet"), "must not reappear").toBe(
      false,
    );
    expect(
      sourceContains(source, "Groups on this canvas appear here."),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceContains(source, "left-[var(--clash-project-control-rail-left)]"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, 'canvasFoldersOpen ? "left-[13rem]"'),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceMatches(source, /reactFlowInstanceRef\.current\?\.fitView\(\s*\{/),
      "mechanism missing",
    ).toBe(true);
  });

  it("keeps ungrouped assets at the canvas root and grouped assets under their group folder", () => {
    expect(
      sourceContains(source, "buildCanvasFolderEntries(nodes, projectAssets)"),
      "mechanism missing",
    ).toBe(true);
    expect(sourceContains(source, 'kind: "asset"'), "mechanism missing").toBe(
      true,
    );
    expect(
      sourceContains(source, 'entry.kind === "group"'),
      "mechanism missing",
    ).toBe(true);
    expect(sourceContains(source, "node.parentId"), "mechanism missing").toBe(
      true,
    );
    expect(
      sourceContains(
        source,
        "resolveCanvasNodeProjectAsset(node, projectAssets)",
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "onSelect={focusCanvasFolderNode}"),
      `mechanism missing`,
    ).toBe(true);
  });

  it("adds folder search and uses real asset thumbnails", () => {
    expect(
      sourceContains(source, 'aria-label="Search canvas folders"'),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, 'placeholder="Search"'),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "canvasFolderQuery"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "filteredCanvasFolderEntries"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "filterCanvasFolderEntries"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "useAsset(projectId, assetId)"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "entry.node.data?.previewUrl"),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceContains(source, "entry.node.data?.src"),
      "must not reappear",
    ).toBe(false);
    expect(sourceContains(source, "<AssetThumbnail"), "mechanism missing").toBe(
      true,
    );
    expect(source).toMatch(
      /data-canvas-folders-panel[\s\S]*?className="[^"]*top-\[var\(--clash-project-frame-top\)\]/,
    );
    expect(
      sourceContains(
        source,
        "relative flex h-[var(--clash-project-control-rhythm)] shrink-0",
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(
        source,
        "after:absolute after:inset-x-1.5 after:bottom-0 after:h-px",
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(
        source,
        "h-[var(--clash-project-control-rhythm)] border-transparent bg-transparent",
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(
        source,
        "min-h-0 flex-1 overflow-y-auto px-1.5 pb-10 pt-[var(--clash-project-action-phase)]",
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(
        source,
        "flex h-[var(--clash-project-control-rhythm)] w-full items-center",
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "relative flex h-10 shrink-0"),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceContains(source, "shrink-0 items-center border-b"),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceContains(
        source,
        "top-[var(--clash-project-frame-top)] z-20 flex w-48",
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "border-warm-border bg-warm-page/70 pl-8"),
      "must not reappear",
    ).toBe(false);
  });

  it("animates between the expanded minimap and its collapsed button", () => {
    expect(sourceContains(source, "AnimatePresence"), "mechanism missing").toBe(
      true,
    );
    expect(
      sourceContains(source, "const [minimapResizing, setMinimapResizing]"),
      "mechanism missing",
    ).toBe(true);
    expect(source).toMatch(
      /animate=\{\{\s*width: minimapCollapsed\s*\? 36\s*: minimapSize\.width,\s*height: minimapCollapsed\s*\? 36\s*: minimapSize\.height,/,
    );
    expect(
      sourceContains(source, 'key="expanded-minimap"'),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, 'key="collapsed-minimap"'),
      "mechanism missing",
    ).toBe(true);
    // Patterns run against the normalized form, which strips the spaces just
    // inside braces, so write them that way rather than as Prettier emits them.
    expect(
      sourceMatches(source, /minimapResizing \? \{ duration: 0 \}/),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "collapseVelocityFromPointer"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "setMinimapCollapseVelocity"),
      "mechanism missing",
    ).toBe(true);
    expect(sourceContains(source, 'type: "spring"'), "mechanism missing").toBe(
      true,
    );
    expect(
      sourceMatches(source, /velocity:\s*-minimapCollapseVelocity/),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "transition-[bottom] duration-200 ease-out"),
      "mechanism missing",
    ).toBe(true);
  });

  it("keeps folder and minimap at the bottom while canvas actions stay in the toolbar", () => {
    expect(source).toMatch(
      /pointer-events-none absolute bottom-\[var\(--clash-project-chrome-gutter\)\] left-\[var\(--clash-project-control-rail-left\)\] z-10 flex flex-col items-start gap-2/,
    );
    expect(
      sourceContains(
        source,
        "calc(${minimapCollapsed ? 36 : minimapSize.height}px + var(--clash-project-chrome-gutter) + var(--clash-project-chrome-gutter))",
      ),
      "mechanism missing",
    ).toBe(true);
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
    expect(
      sourceContains(source, "bottom-[var(--clash-project-chrome-gutter)]"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "max-h-[min(28rem,calc(100%-5.5rem))]"),
      "must not reappear",
    ).toBe(false);
  });

  it("fits every node into the viewport instead of preserving an oversized zoom", () => {
    expect(
      sourceContains(source, "fitAllNodesIntoViewport"),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "nodesRef.current.filter((node) => !node.hidden)"),
      "must not reappear",
    ).toBe(false);
    expect(
      sourceMatches(
        source,
        /instance\.fitView\(\{\s*nodes:\s*allNodes,\s*padding:/,
      ),
      "mechanism missing",
    ).toBe(true);
    expect(
      sourceContains(source, "reactFlowInstanceRef.current?.setCenter("),
      "must not preserve an oversized zoom",
    ).toBe(false);
    expect(
      sourceContains(source, 'label="Center view on nodes"'),
      "mechanism missing",
    ).toBe(true);
  });
});
