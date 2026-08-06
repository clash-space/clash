import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("agent annotation surface integration", () => {
  it("uses one mature context-menu action for Canvas, Timeline, and Director Stage targets", () => {
    const projectEditor = read(
      "packages/web-ui/src/components/ProjectEditor.tsx",
    );
    const timelineEditor = read(
      "packages/remotion-ui/src/components/Editor.tsx",
    );
    const timelineItem = read(
      "packages/remotion-ui/src/components/timeline/TimelineItem.tsx",
    );
    const directorStage = read(
      "packages/web-ui/src/components/ProjectDirectorStageSurface.tsx",
    );
    const directorViewport = read(
      "packages/director-ui/src/DirectorViewport.tsx",
    );
    const contextMenu = read(
      "packages/web-ui/src/components/ui/context-menu.tsx",
    );

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
    const projectEditor = read(
      "packages/web-ui/src/components/ProjectEditor.tsx",
    );
    const copilot = read("packages/web-ui/src/components/ChatbotCopilot.tsx");

    expect(projectEditor).toContain("pendingAgentAnnotations");
    expect(projectEditor).toContain("onAnnotationsSubmitted");
    expect(copilot).toContain("annotationBlocks");
    expect(copilot).toContain("buildCopilotPrompt(");
  });

  it("captures native text selections as numbered anchored annotations with an optional comment", () => {
    const projectEditor = read(
      "packages/web-ui/src/components/ProjectEditor.tsx",
    );
    const selectionOverlay = read(
      "packages/web-ui/src/components/copilot/AgentSelectionAnnotationOverlay.tsx",
    );
    const textNode = read("packages/web-ui/src/components/nodes/TextNode.tsx");
    const textEditor = read(
      "packages/web-ui/src/components/TextDocumentEditorSurface.tsx",
    );
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
    expect(projectEditor).toContain("onContextMenuCapture");
    expect(projectEditor).not.toContain("onPointerUpCapture");
    expect(selectionOverlay).toContain("window.getSelection");
    expect(selectionOverlay).toContain("data-agent-annotation-highlight");
    expect(selectionOverlay).toContain("data-agent-annotation-pin");
    // Object-level annotations on every surface share one DOM-anchored pin
    // layer, and every pin routes into the same right-side inspector.
    expect(projectEditor).toContain("<AgentAnnotationDomPinLayer");
    const domPinLayer = read(
      "packages/web-ui/src/components/copilot/AnnotationDomPinLayer.tsx",
    );
    expect(domPinLayer).toContain('data-agent-annotation-pin=""');
    expect(domPinLayer).toContain("annotationLocateSelector");
    expect(domPinLayer).toContain("onSelect");
    expect(domPinLayer).not.toContain("AnnotationNoteEditor");
    expect(selectionOverlay).toContain("Add an optional comment");
    expect(selectionOverlay).toContain("PopoverAnchor");
    expect(selectionOverlay).toContain("data-agent-annotation-object-id");
    expect(textEditor).toContain("data-agent-annotation-selection-root");
    expect(textEditor).toContain("data-agent-annotation-object-id");
    expect(textNode).toContain("pointer-events-none");
    expect(textNode).toContain("select-none");
    expect(textNode).not.toContain("nodrag nopan nowheel select-text");
    expect(timelineTracks).toContain("data-agent-annotation-object-id");
    expect(timelineItem).toContain("data-agent-annotation-object-id");
    expect(directorStage).toContain("annotationTarget");
  });

  it("opens every annotation path in one right-side inspector with shared context actions", () => {
    const projectEditor = read(
      "packages/web-ui/src/components/ProjectEditor.tsx",
    );
    const copilot = read("packages/web-ui/src/components/ChatbotCopilot.tsx");
    const chatInput = read(
      "packages/web-ui/src/components/copilot/ChatInput.tsx",
    );
    const annotationBlock = read(
      "packages/web-ui/src/components/copilot/AgentAnnotationBlock.tsx",
    );
    const canvasPins = read(
      "packages/web-ui/src/components/copilot/CanvasAnnotationPinLayer.tsx",
    );
    const domPins = read(
      "packages/web-ui/src/components/copilot/AnnotationDomPinLayer.tsx",
    );
    const selectionOverlay = read(
      "packages/web-ui/src/components/copilot/AgentSelectionAnnotationOverlay.tsx",
    );

    expect(projectEditor).toContain("activeAnnotationId");
    expect(projectEditor).toContain("openAgentAnnotation");
    expect(copilot).toContain("<AgentAnnotationInspector");
    expect(chatInput).toContain("onAnnotationOpen");
    expect(annotationBlock).toContain(
      "export function AgentAnnotationInspector",
    );
    expect(annotationBlock).toContain("AgentAnnotationActionsContextMenu");
    expect(canvasPins).toContain("AgentAnnotationActionsContextMenu");
    expect(domPins).toContain("AgentAnnotationActionsContextMenu");
    expect(selectionOverlay).toContain("AgentAnnotationActionsContextMenu");
  });

  it("opens Text assets in the document editor instead of treating them as Canvas locators", () => {
    const projectEditor = read(
      "packages/web-ui/src/components/ProjectEditor.tsx",
    );
    const openTextAsset = projectEditor.slice(
      projectEditor.indexOf("const openProjectTextAsset"),
      projectEditor.indexOf("const openCopilotClashEntity"),
    );

    expect(projectEditor).toContain("<TextNodeEditorProvider");
    expect(projectEditor).toContain("<TextDocumentEditorSurface");
    expect(openTextAsset).toContain('kind: "text-asset"');
    expect(openTextAsset).toContain("nodeId: asset.id");
    expect(openTextAsset).toContain("canvasId: asset.canvasId");
    expect(openTextAsset).not.toContain("setOpenTextNodeEditorId");
    expect(openTextAsset).not.toContain(
      "openAssetRelationCanvas(asset.canvasId, asset.id)",
    );
  });

  it("previews Canvas Text nodes locally before entering the full document editor", () => {
    const projectEditor = read(
      "packages/web-ui/src/components/ProjectEditor.tsx",
    );
    const previewDialog = read(
      "packages/web-ui/src/components/TextNodePreviewDialog.tsx",
    );

    expect(projectEditor).toContain("<TextNodePreviewDialog");
    expect(projectEditor).toContain("onOpenNode={openCanvasTextPreview}");
    expect(projectEditor).toContain("openCanvasTextEditor");
    expect(previewDialog).toContain("<Dialog");
    expect(previewDialog).toContain("unstyled");
    expect(previewDialog).toContain("<ReactMarkdown");
    expect(previewDialog).toContain("Open editor");
    expect(previewDialog).toContain("portalContainer={portalContainer}");
    expect(previewDialog).toContain("<AgentSelectionAnnotationOverlay");
    expect(previewDialog).toContain("handleSelectionAnnotationContextMenu");
    expect(previewDialog).toContain("onContextMenu");
    expect(previewDialog).not.toContain("onPointerUp");
    expect(projectEditor).toContain("annotations={pendingAgentAnnotations}");
    expect(projectEditor).toContain(
      "onCreateAnnotation={queueAgentAnnotation}",
    );
  });
});
