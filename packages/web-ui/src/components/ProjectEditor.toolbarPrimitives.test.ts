import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

function readCanvasToolbarSource() {
  const source = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
  const start = source.indexOf('clash-canvas-toolbar-surface');
  const end = source.indexOf('id="copilot-container"', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function readSelectionGroupButtonSource() {
  const source = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
  const start = source.indexOf("function SelectionGroupButton");
  const end = source.indexOf("export default function ProjectEditor", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("ProjectEditor toolbar primitives", () => {
  it("uses the shared Radix toggle primitive for canvas mode instead of a hand-rolled toggle button", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
    const toggleSource = readSource("packages/web-ui/src/components/ui/toggle.tsx");

    expect(toggleSource).toContain("TogglePrimitive.Root");
    expect(editorSource).toContain("./ui/toggle");
    expect(editorSource).toContain("<Toggle");
    expect(editorSource).toContain("pressed={canvasMode === 'hand'}");
    expect(editorSource).toContain("onPressedChange={(pressed) => setCanvasMode(pressed ? 'hand' : 'select')}");
    expect(editorSource).not.toContain("onClick={() => setCanvasMode(prev => prev === 'select' ? 'hand' : 'select')}");
  });

  it("uses the shared tooltip primitive for canvas toolbar icon buttons instead of browser title attributes", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
    const toolbarSource = readCanvasToolbarSource();
    const tooltipSource = readSource("packages/web-ui/src/components/ui/tooltip.tsx");

    expect(tooltipSource).toContain("@ariakit/react");
    expect(tooltipSource).toContain("TooltipProvider");
    expect(tooltipSource).toContain("TooltipAnchor");
    expect(tooltipSource).toContain("Tooltip");
    expect(editorSource).toContain("./ui/tooltip");
    expect(toolbarSource).toContain("<Tooltip label=");
    expect(editorSource).not.toContain("CanvasToolbarTooltip");
    expect(editorSource).not.toContain("TooltipProvider");
    expect(editorSource).not.toContain("TooltipAnchor");
    expect(toolbarSource).not.toContain("title=");
  });

  it("uses the shared tooltip primitive for project editor icon actions outside the canvas toolbar", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");

    expect(editorSource).toContain('<Tooltip label="Wrap selected nodes in a new Group">');
    expect(editorSource).toContain('<Tooltip label="Return to projects">');
    expect(editorSource).not.toContain('title="Wrap selected nodes in a new Group"');
    expect(editorSource).not.toContain('title="Return to projects"');
  });

  it("lets ReactFlow own the group action event boundary instead of hand-rolled mouse suppression", () => {
    const buttonSource = readSelectionGroupButtonSource();

    expect(buttonSource).toContain("nodrag");
    expect(buttonSource).toContain("nopan");
    expect(buttonSource).not.toContain("onMouseDown={(e) => e.stopPropagation()}");
  });
});
