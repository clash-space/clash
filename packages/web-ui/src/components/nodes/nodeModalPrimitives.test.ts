import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const nodeSourceRoot = process.cwd().endsWith("packages/web-ui")
  ? join(process.cwd(), "src/components/nodes")
  : join(process.cwd(), "packages/web-ui/src/components/nodes");

const readNodeSource = (file: string) =>
  readFileSync(
    join(nodeSourceRoot, file),
    "utf8",
  );

describe("node modal primitives", () => {
  it("uses a shared Dialog-backed node modal shell for editable node dialogs", () => {
    const shell = readNodeSource("NodeModalDialog.tsx");

    expect(shell).toContain("../ui/dialog");
    expect(shell).toContain("Dialog");
  });

  it.each(["TextNode.tsx", "PromptNode.tsx", "AudioNode.tsx"])(
    "%s does not hand-roll its modal shell",
    (file) => {
      const source = readNodeSource(file);

      expect(source).toContain("./NodeModalDialog");
      expect(source).not.toContain("createPortal");
      expect(source).not.toContain("AnimatePresence");
      expect(source).not.toContain("<motion.div");
    },
  );

  it.each(["TextNode.tsx", "PromptNode.tsx"])(
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
    const textSource = readNodeSource("TextNode.tsx");
    const timelineSource = readNodeSource("VideoEditorNode.tsx");
    const badgeSource = readNodeSource("RevisionHistoryBadge.tsx");

    expect(textSource).toContain("@clash/web-ui/hooks/useRevisionHistory");
    expect(textSource).toContain("./RevisionHistoryBadge");
    expect(textSource).toContain("<RevisionHistoryBadge");
    expect(textSource).toContain("nodeId={id}");
    expect(textSource).toContain("history={revisionHistory}");

    expect(timelineSource).not.toContain("@clash/web-ui/hooks/useRevisionHistory");
    expect(timelineSource).not.toContain("./RevisionHistoryBadge");

    expect(badgeSource).toContain("Text revision history");
    expect(badgeSource).toContain("clash text content --revision");
    expect(badgeSource).toContain("clash text restore --node");
    expect(badgeSource).not.toContain("clash timeline");
    expect(badgeSource).not.toContain("timeline.yaml");
  });

  it("pins rendered video nodes to the source timeline revision when available", () => {
    const timelineSource = readNodeSource("VideoEditorNode.tsx");

    expect(timelineSource).toContain("listProjectTimelines");
    expect(timelineSource).toContain("sourceTimelineNodeId: id");
    expect(timelineSource).toContain("timelineRevision:");
    expect(timelineSource).toContain("revisionId: timeline.revisionId");
  });
});
