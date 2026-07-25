import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("agent annotation surface integration", () => {
  it("uses one mature context-menu action for Canvas, Timeline, and Director Stage targets", () => {
    const projectEditor = read("packages/web-ui/src/components/ProjectEditor.tsx");
    const timelineEditor = read("packages/remotion-ui/src/components/Editor.tsx");
    const timelineItem = read("packages/remotion-ui/src/components/timeline/TimelineItem.tsx");
    const directorStage = read("packages/web-ui/src/components/ProjectDirectorStageSurface.tsx");
    const directorViewport = read("packages/director-ui/src/DirectorViewport.tsx");
    const contextMenu = read("packages/web-ui/src/components/ui/context-menu.tsx");

    expect(contextMenu).toContain('from "radix-ui"');
    expect(projectEditor).toContain("<AgentAnnotationContextMenu");
    expect(projectEditor).toContain("onNodeContextMenu");
    expect(projectEditor).toContain("onEdgeContextMenu");
    expect(timelineEditor).toContain("onAnnotationTargetContextMenu");
    expect(timelineItem).toContain("onAnnotationTargetContextMenu");
    expect(directorStage).toContain("onAnnotationTargetContextMenu");
    expect(directorViewport).toContain("onObjectContextMenu");
  });

  it("keeps pending annotations in the project composer until a successful submit clears them", () => {
    const projectEditor = read("packages/web-ui/src/components/ProjectEditor.tsx");
    const copilot = read("packages/web-ui/src/components/ChatbotCopilot.tsx");

    expect(projectEditor).toContain("pendingAgentAnnotations");
    expect(projectEditor).toContain("onAnnotationsSubmitted");
    expect(copilot).toContain("annotationBlocks");
    expect(copilot).toContain("buildCopilotPrompt(");
  });

  it("captures native text selections as numbered anchored annotations with an optional comment", () => {
    const projectEditor = read("packages/web-ui/src/components/ProjectEditor.tsx");
    const selectionOverlay = read(
      "packages/web-ui/src/components/copilot/AgentSelectionAnnotationOverlay.tsx",
    );
    const textNode = read("packages/web-ui/src/components/nodes/TextNode.tsx");
    const timelineTracks = read(
      "packages/remotion-ui/src/components/timeline/TimelineTracksContainer.tsx",
    );
    const timelineItem = read(
      "packages/remotion-ui/src/components/timeline/TimelineItem.tsx",
    );
    const directorStage = read(
      "packages/web-ui/src/components/ProjectDirectorStageSurface.tsx",
    );

    expect(projectEditor).toContain("<AgentSelectionAnnotationOverlay");
    expect(projectEditor).toContain("onPointerUpCapture");
    expect(selectionOverlay).toContain("window.getSelection");
    expect(selectionOverlay).toContain("data-agent-annotation-highlight");
    expect(selectionOverlay).toContain("data-agent-annotation-pin");
    // Object-level annotations on every surface share one DOM-anchored pin
    // layer with numbered pins and the in-place note editor.
    expect(projectEditor).toContain("<AgentAnnotationDomPinLayer");
    const domPinLayer = read(
      "packages/web-ui/src/components/copilot/AnnotationDomPinLayer.tsx",
    );
    expect(domPinLayer).toContain('data-agent-annotation-pin=""');
    expect(domPinLayer).toContain("annotationLocateSelector");
    expect(domPinLayer).toContain("AnnotationNoteEditor");
    expect(selectionOverlay).toContain("Add an optional comment");
    expect(selectionOverlay).toContain("PopoverAnchor");
    expect(selectionOverlay).toContain("data-agent-annotation-object-id");
    expect(textNode).toContain("data-agent-annotation-object-id");
    expect(textNode).toContain("nodrag nopan nowheel select-text");
    expect(timelineTracks).toContain("data-agent-annotation-object-id");
    expect(timelineItem).toContain("data-agent-annotation-object-id");
    expect(directorStage).toContain("annotationTarget");
  });
});
