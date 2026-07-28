import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nodeSourceRoot = process.cwd().endsWith("packages/web-ui")
  ? join(process.cwd(), "src/components/nodes")
  : join(process.cwd(), "packages/web-ui/src/components/nodes");

const readNodeSource = (file: string) =>
  readFileSync(join(nodeSourceRoot, file), "utf8");

describe("node modal primitives", () => {
  it("uses a shared Dialog-backed node modal shell for editable node dialogs", () => {
    const shell = readNodeSource("NodeModalDialog.tsx");

    expect(shell).toContain("../ui/dialog");
    expect(shell).toContain("Dialog");
  });

  it.each(["PromptNode.tsx", "AudioNode.tsx"])(
    "%s does not hand-roll its modal shell",
    (file) => {
      const source = readNodeSource(file);

      expect(source).toContain("./NodeModalDialog");
      expect(source).not.toContain("createPortal");
      expect(source).not.toContain("AnimatePresence");
      expect(source).not.toContain("<motion.div");
    },
  );

  it.each(["PromptNode.tsx"])(
    "%s uses shared primitives for modal actions",
    (file) => {
      const source = readNodeSource(file);

      expect(source).toContain("../ui/button");
      expect(source).toContain("../ui/icon-button");
      expect(source).toMatch(/<Button[\s\S]*onClick=\{handleSave\}/);
      expect(source).toMatch(/<IconButton[\s\S]*onClick=\{handleCancel\}/);
      expect(source).not.toMatch(/<button[\s\S]*onClick=\{handleSave\}/);
      expect(source).not.toMatch(/<button[\s\S]*onClick=\{handleCancel\}/);
    },
  );

  it("surfaces host-indexed text revisions without duplicating Loro timeline history", () => {
    const textSource = readNodeSource("../TextDocumentEditorSurface.tsx");
    const timelineSource = readNodeSource("VideoEditorNode.tsx");
    const badgeSource = readNodeSource("RevisionHistoryBadge.tsx");

    expect(textSource).toContain("@clash/web-ui/hooks/useRevisionHistory");
    expect(textSource).toContain("./nodes/RevisionHistoryBadge");
    expect(textSource).toContain("<RevisionHistoryBadge");
    expect(textSource).toContain("nodeId={nodeId}");
    expect(textSource).toContain("history={revisionHistory}");

    expect(timelineSource).not.toContain(
      "@clash/web-ui/hooks/useRevisionHistory",
    );
    expect(timelineSource).not.toContain("./RevisionHistoryBadge");

    expect(badgeSource).toContain("Text revision history");
    expect(badgeSource).toContain("clash text content --revision");
    expect(badgeSource).toContain("clash text restore --node");
    expect(badgeSource).not.toContain("clash timeline");
    expect(badgeSource).not.toContain("timeline.yaml");
  });

  it("keeps the Text title inside the editable page instead of boxing it into the modal chrome", () => {
    const textSource = readNodeSource("../TextDocumentEditorSurface.tsx");
    const modalSource = readNodeSource("NodeModalDialog.tsx");

    expect(textSource).toContain("clash-text-node-editor");
    expect(textSource).toContain("clash-text-node-title-shell");
    expect(textSource).toContain("clash-text-node-title-input");
    expect(textSource).not.toContain("border-b border-warm-border");
    expect(modalSource).toContain("portalContainer");
    expect(textSource).not.toContain("max-w-[24rem]");
  });

  it("keeps Text editing WYSIWYG with one document surface, real formatting, and local annotations", () => {
    const textSource = readNodeSource("../TextDocumentEditorSurface.tsx");

    expect(textSource).toContain('aria-label="Bold"');
    expect(textSource).toContain('aria-label="Italic"');
    expect(textSource).toContain('aria-label="Heading 2"');
    expect(textSource).toContain('aria-label="Block quote"');
    expect(textSource).toContain("Saving…");
    expect(textSource).toContain("Saved");
    expect(textSource).not.toContain('label="Save"');
    expect(textSource).toContain("characters");
    expect(textSource.match(/<RevisionHistoryBadge/g)?.length).toBe(1);
    expect(textSource).toContain('className="shrink-0"');
    expect(textSource).toContain("showWhenEmpty");
    expect(textSource).toContain('variant="toolbar"');
    expect(textSource).not.toContain('aria-label="Text document mode"');
    expect(textSource).not.toContain("setEditorMode");
    expect(textSource).toContain(
      'aria-label={`${label || "Untitled"} text editor`}',
    );
    expect(textSource).toContain("absolute inset-0");
    expect(textSource).not.toContain("NodeModalDialog");
    expect(textSource).toContain("<AgentSelectionAnnotationOverlay");
    expect(textSource).toContain("captureSelection");
  });

  it("keeps the remaining node dialogs as framed overlays", () => {
    const modalSource = readNodeSource("NodeModalDialog.tsx");

    expect(modalSource).not.toContain("fullScreen?: boolean");
    expect(modalSource).not.toContain('"!p-0"');
    expect(modalSource).not.toContain("!rounded-none");
  });

  it("keeps Canvas Text nodes lightweight and routes editing through the workspace", () => {
    const textNodeSource = readNodeSource("TextNode.tsx");

    expect(textNodeSource).toContain("editorController?.openEditor(id)");
    expect(textNodeSource).not.toContain("NodeModalDialog");
    expect(textNodeSource).not.toContain("MilkdownEditor");
    expect(textNodeSource).not.toContain("AgentSelectionAnnotationOverlay");
  });

  it("pins rendered video nodes to the source timeline revision when available", () => {
    const timelineSource = readNodeSource("VideoEditorNode.tsx");

    expect(timelineSource).toContain("listProjectTimelines");
    expect(timelineSource).toContain("sourceTimelineNodeId: id");
    expect(timelineSource).toContain("timelineRevision:");
    expect(timelineSource).toContain("revisionId: timeline.revisionId");
  });
});
