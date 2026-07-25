// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnnotationNoteEditor } from "./AnnotationDomPinLayer";

afterEach(() => {
  cleanup();
});

describe("AnnotationNoteEditor", () => {
  it("places the caret after the existing note when the editor opens", () => {
    const note = "不太好";

    render(
      <AnnotationNoteEditor
        number={1}
        note={note}
        onChangeNote={vi.fn()}
        onRemove={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const editor = screen.getByRole("textbox", {
      name: "Annotation 1 note",
    }) as HTMLTextAreaElement;

    expect(document.activeElement).toBe(editor);
    expect(editor.selectionStart).toBe(note.length);
    expect(editor.selectionEnd).toBe(note.length);
  });
});
