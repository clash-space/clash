// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@clash/web-ui/hooks/useRevisionHistory", () => ({
  useRevisionHistory: () => [],
}));

vi.mock("./MilkdownEditor", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef<
      unknown,
      { value: string; onChange: (value: string) => void }
    >(function MockMilkdownEditor({ value, onChange }, _ref) {
      return (
        <textarea
          aria-label="Document body"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    }),
  };
});

import { TextDocumentEditorSurface } from "./TextDocumentEditorSurface";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderEditor({
  onSave = vi.fn<(next: { label: string; content: string }) => void>(),
  onClose = vi.fn<() => void>(),
}: {
  onSave?: ReturnType<
    typeof vi.fn<(next: { label: string; content: string }) => void>
  >;
  onClose?: ReturnType<typeof vi.fn<() => void>>;
} = {}) {
  const result = render(
    <TextDocumentEditorSurface
      projectId="project-1"
      nodeId="text-1"
      label="Draft"
      content="Opening"
      annotationTarget={null}
      annotations={[]}
      onCreateAnnotation={vi.fn()}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  return { ...result, onSave, onClose };
}

describe("Text document autosave", () => {
  it("debounces edits and replaces the manual Save button with Saving/Saved status", () => {
    vi.useFakeTimers();
    const { onSave } = renderEditor();

    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByText("Saved")).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Document body" }), {
      target: { value: "Opening revised" },
    });

    expect(screen.getByText("Saving…")).toBeTruthy();
    expect(onSave).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(499));
    expect(onSave).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(onSave).toHaveBeenCalledWith({
      label: "Draft",
      content: "Opening revised",
    });
    expect(screen.getByText("Saved")).toBeTruthy();
  });

  it("flushes the latest draft before returning to Canvas", () => {
    vi.useFakeTimers();
    const { onSave, onClose } = renderEditor();

    fireEvent.change(screen.getByRole("textbox", { name: "Document body" }), {
      target: { value: "Last unsaved sentence" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back to Canvas" }));

    expect(onSave).toHaveBeenCalledWith({
      label: "Draft",
      content: "Last unsaved sentence",
    });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("flushes the latest draft when the editor unmounts", () => {
    vi.useFakeTimers();
    const { onSave, unmount } = renderEditor();

    fireEvent.change(screen.getByRole("textbox", { name: "Document body" }), {
      target: { value: "Persist on unmount" },
    });
    unmount();

    expect(onSave).toHaveBeenCalledWith({
      label: "Draft",
      content: "Persist on unmount",
    });
  });
});
