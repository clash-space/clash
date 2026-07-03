// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { replaceContentEditableHtmlPreservingFocus } from "./contentEditableSync";

describe("replaceContentEditableHtmlPreservingFocus", () => {
  it("replaces contentEditable HTML and keeps the caret at the end when focused", () => {
    const editor = document.createElement("div");
    editor.contentEditable = "true";
    editor.tabIndex = -1;
    editor.textContent = "old";
    document.body.append(editor);
    editor.focus();

    replaceContentEditableHtmlPreservingFocus(editor, "<span>new</span>");

    expect(editor.innerHTML).toBe("<span>new</span>");
    expect(document.activeElement).toBe(editor);
    const selection = document.getSelection();
    expect(selection?.rangeCount).toBe(1);
    expect(selection?.getRangeAt(0).collapsed).toBe(true);

    editor.remove();
  });
});
