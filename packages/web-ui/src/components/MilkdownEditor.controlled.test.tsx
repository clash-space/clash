// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import MilkdownEditor, { type MilkdownEditorHandle } from "./MilkdownEditor";

describe("MilkdownEditor controlled value", () => {
  afterEach(cleanup);

  it("writes an externally selected slash command into the visible editor", async () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <MilkdownEditor value="/" onChange={onChange} />,
    );

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")?.textContent).toBe("/");
    });

    rerender(<MilkdownEditor value="/review " onChange={onChange} />);

    await waitFor(() => {
      expect(container.querySelector(".ProseMirror")?.textContent).toBe("/review");
    });
  });

  it("reopens mentions when an existing at-sign regains focus", async () => {
    const rect = { left: 10, right: 10, top: 10, bottom: 20, width: 0, height: 10, x: 10, y: 10, toJSON: () => ({}) };
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => ({ 0: rect, length: 1, item: () => rect }),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => rect,
    });
    const ref = createRef<MilkdownEditorHandle>();
    const { container } = render(
      <MilkdownEditor
        ref={ref}
        value=""
        onChange={() => undefined}
        promptModalities={["text", "image", "video", "audio"]}
        mentionableNodes={[{ id: "audio-one", type: "audio", label: "Narration" }]}
      />,
    );

    const editor = await waitFor(() => {
      const element = container.querySelector(".ProseMirror");
      expect(element).toBeTruthy();
      return element as HTMLElement;
    });

    act(() => ref.current?.insertAtCursor("@"));
    expect(await screen.findByRole("listbox", { name: "Mention matches" })).toBeTruthy();
    expect(document.querySelector("[data-mention-anchor]")?.parentElement).toBe(document.body);

    fireEvent.keyDown(editor, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("listbox", { name: "Mention matches" })).toBeNull();
    });

    fireEvent.click(editor);

    expect(await screen.findByRole("listbox", { name: "Mention matches" })).toBeTruthy();
    expect(screen.getByText("Narration")).toBeTruthy();
  });

  it("groups project-wide references and does not connect nodes from another canvas", async () => {
    const rect = { left: 20, right: 20, top: 40, bottom: 52, width: 0, height: 12, x: 20, y: 40, toJSON: () => ({}) };
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value: () => ({ 0: rect, length: 1, item: () => rect }),
    });
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value: () => rect,
    });
    const onMentionAdded = vi.fn();
    const ref = createRef<MilkdownEditorHandle>();
    render(
      <MilkdownEditor
        ref={ref}
        value=""
        onChange={() => undefined}
        promptModalities={["image"]}
        onMentionAdded={onMentionAdded}
        mentionableNodes={[
          { id: "action-1", type: "action", label: "Render variants", kind: "node", scope: "current-canvas", description: "Action node · Main" },
          { id: "asset-1", type: "image", label: "Logo master", kind: "asset", scope: "project-assets", description: "Image · Project asset" },
          { id: "timeline-1", type: "timeline", label: "Social cut", kind: "timeline", scope: "timelines", description: "Timeline · Project" },
          { id: "note-2", type: "text", label: "Legal note", kind: "node", scope: "other-canvases", description: "Text node · Review" },
        ]}
      />,
    );

    await screen.findByRole("textbox");
    act(() => ref.current?.insertAtCursor("@"));
    const list = await screen.findByRole("listbox", { name: "Mention matches" });
    expect(list.textContent).toContain("Current canvas");
    expect(list.textContent).toContain("Render variants");
    expect(list.textContent).toContain("Project assets");
    expect(list.textContent).toContain("Timelines");
    expect(list.textContent).toContain("Other canvases");

    fireEvent.click(screen.getByText("Legal note"));
    expect(onMentionAdded).not.toHaveBeenCalled();
  });

  it("exposes real document formatting commands to editor toolbars", async () => {
    const onChange = vi.fn();
    const ref = createRef<MilkdownEditorHandle>();
    render(
      <MilkdownEditor
        ref={ref}
        value=""
        onChange={onChange}
      />,
    );

    await screen.findByRole("textbox");

    act(() => {
      expect(ref.current?.formatSelection("bold")).toBe(true);
      ref.current?.insertAtCursor("Important");
    });

    await waitFor(() => {
      expect(
        onChange.mock.calls.some(
          ([markdown]) =>
            typeof markdown === "string" && markdown.includes("**Important**"),
        ),
      ).toBe(true);
    });
  });
});
