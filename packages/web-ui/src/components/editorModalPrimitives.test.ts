import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (path: string) =>
  readFileSync(join(process.cwd(), path), "utf8");

describe("editor modal primitives", () => {
  it("uses a shared Dialog-backed editor modal shell", () => {
    const shell = readSource(
      "packages/web-ui/src/components/EditorModalDialog.tsx",
    );

    expect(shell).toContain("./ui/dialog");
    expect(shell).toContain("Dialog");
    expect(shell).toContain("clash-editor-modal-backdrop");
    expect(shell).toContain("clash-editor-modal-surface");
  });

  it.each([
    "VideoEditorContext.tsx",
    "ImageEditorContext.tsx",
    "VideoClipperContext.tsx",
  ])("%s does not hand-roll editor dialog semantics", (file) => {
    const source = readSource(`packages/web-ui/src/components/${file}`);

    expect(source).toContain("./EditorModalDialog");
    expect(source).not.toContain('role="dialog"');
    expect(source).not.toContain('aria-modal="true"');
  });

  it("uses a mature gesture primitive for image crop dragging instead of window mouse listeners", () => {
    const source = readSource(
      "packages/web-ui/src/components/ImageEditorContext.tsx",
    );

    expect(source).toContain("@use-gesture/react");
    expect(source).toContain("useDrag");
    expect(source).toContain("cropDragBind(");
    expect(source).not.toContain("window.addEventListener('mousemove'");
    expect(source).not.toContain("window.addEventListener('mouseup'");
  });
});
