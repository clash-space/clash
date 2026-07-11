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
  it("uses Radix Toolbar for roving focus and single-select canvas modes", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");

    expect(editorSource).toContain("import { Toolbar } from 'radix-ui'");
    expect(editorSource).toContain('<Toolbar.Root');
    expect(editorSource).toContain('orientation="vertical"');
    expect(editorSource).toContain('<Toolbar.ToggleGroup');
    expect(editorSource).toContain('type="single"');
    expect(editorSource).toContain('<Toolbar.ToggleItem value="select" asChild>');
    expect(editorSource).toContain('<Toolbar.ToggleItem value="hand" asChild>');
    expect(editorSource).not.toContain('role="group"');
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

  it("only removes asset refs when the atomic Loro delete batch was accepted", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");

    expect(editorSource).toContain("const persistedDeletedNodes = loroSync.removeNodes(deletedNodes.map((node) => node.id))");
    expect(editorSource).toContain("? deletedNodes");
    expect(editorSource).toContain("const deletedIds = new Set(persistedDeletedNodes.map((n) => n.id));");
    expect(editorSource).toContain("persistedDeletedNodes\n                .map");
  });

  it("uses shared button primitives for project editor chrome and canvas toolbar actions", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
    const toolbarSource = readCanvasToolbarSource();
    const selectionButtonSource = readSelectionGroupButtonSource();

    expect(editorSource).toContain("./ui/button");
    expect(editorSource).toContain("./ui/icon-button");
    expect(editorSource).toContain("<Button");
    expect(editorSource).toContain("<IconButton");
    expect(toolbarSource).not.toContain("<motion.button");
    expect(selectionButtonSource).not.toContain("<motion.button");
  });

  it("lets the shared accordion primitive own debug node log disclosure", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");
    const debugOverlayStart = editorSource.indexOf("function DebugNodeIds");
    const debugOverlayEnd = editorSource.indexOf("export default function ProjectEditor", debugOverlayStart);
    const debugOverlaySource = editorSource.slice(debugOverlayStart, debugOverlayEnd);

    expect(editorSource).toContain("./ui/accordion");
    expect(debugOverlaySource).toContain("<Accordion");
    expect(debugOverlaySource).toContain('type="single"');
    expect(debugOverlaySource).toContain("AccordionItem");
    expect(debugOverlaySource).toContain("AccordionTrigger asChild");
    expect(debugOverlaySource).toContain("AccordionContent");
    expect(debugOverlaySource).not.toContain("expandedNode");
    expect(debugOverlaySource).not.toContain("setExpandedNode");
    expect(debugOverlaySource).not.toContain("isExpanded &&");
  });

  it("dispatches host mutation records from the live ProjectEditor runtime", () => {
    const editorSource = readSource("packages/web-ui/src/components/ProjectEditor.tsx");

    expect(editorSource).toContain("@clash/web-ui/lib/hostMutationEvents");
    expect(editorSource).toContain("onMutation: (mutation) => dispatchHostMutationEvent(project.id, mutation)");
  });
});
