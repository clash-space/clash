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

  it("uses Ariakit tooltip primitives for canvas toolbar icon buttons instead of browser title attributes", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
    const toolbarSource = readCanvasToolbarSource();

    expect(editorSource).toContain("@ariakit/react");
    expect(editorSource).toContain("TooltipProvider");
    expect(editorSource).toContain("TooltipAnchor");
    expect(editorSource).toContain("Tooltip");
    expect(toolbarSource).toContain("CanvasToolbarTooltip");
    expect(toolbarSource).not.toContain("title=");
  });
});
