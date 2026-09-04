// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentAnnotationDraft } from "@clash/shared-types";

import { AgentAnnotationEditor } from "./AgentAnnotationBlock";

const annotation: AgentAnnotationDraft = {
  id: "annotation-1",
  kind: "agent-annotation",
  note: "Make this promise more concrete.",
  target: {
    projectId: "project-1",
    surface: "canvas",
    surfaceId: "main",
    surfaceLabel: "Main",
    objectId: "text-1",
    objectType: "canvas-text",
    objectLabel: "Launch script",
    objectPath: "canvases/main/nodes/text-1",
    capabilities: ["read", "modify"],
    selection: {
      kind: "text-quote",
      exact: "Ship the first cut tomorrow.",
    },
  },
};

describe("AgentAnnotationEditor", () => {
  afterEach(() => {
    cleanup();
    document
      .querySelectorAll("[data-agent-annotation-anchor]")
      .forEach((element) => element.remove());
  });

  function appendAnnotationAnchor() {
    const anchor = document.createElement("button");
    anchor.dataset.agentAnnotationAnchor = annotation.id;
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: 220,
      top: 160,
      right: 244,
      bottom: 184,
      width: 24,
      height: 24,
      x: 220,
      y: 160,
      toJSON: () => ({}),
    });
    document.body.append(anchor);
    return anchor;
  }

  it("opens beside the annotation marker as a non-modal Backchat editor", () => {
    appendAnnotationAnchor();
    const onClose = vi.fn();

    render(
      <AgentAnnotationEditor
        annotations={[annotation]}
        activeId={annotation.id}
        onClose={onClose}
      />,
    );

    const editor = screen.getByRole("dialog", {
      name: "Annotation for Launch script",
    });
    expect(editor.getAttribute("aria-modal")).toBeNull();
    expect(screen.getByTestId("agent-annotation-editor")).toBe(editor);
    expect(screen.getByPlaceholderText("Add an optional comment…")).toBeTruthy();
    expect(screen.queryByTestId("agent-annotation-dialog")).toBeNull();
    expect(screen.queryByText("Instruction for agent")).toBeNull();
  });

  it("waits for a canvas marker that mounts after the annotation becomes active", async () => {
    render(
      <AgentAnnotationEditor
        annotations={[annotation]}
        activeId={annotation.id}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("agent-annotation-editor")).toBeNull();
    appendAnnotationAnchor();

    await waitFor(() =>
      expect(screen.getByTestId("agent-annotation-editor")).toBeTruthy(),
    );
  });

  it("keeps edits local until Save and lets Cancel discard the draft", () => {
    appendAnnotationAnchor();
    const onChange = vi.fn();
    const onClose = vi.fn();

    render(
      <AgentAnnotationEditor
        annotations={[annotation]}
        activeId={annotation.id}
        onClose={onClose}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Annotation for Launch script" }),
      { target: { value: "Use a measurable launch date." } },
    );

    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves the expanded editor and exposes real locate and remove actions", () => {
    appendAnnotationAnchor();
    const onChange = vi.fn();
    const onLocate = vi.fn();
    const onRemove = vi.fn();

    render(
      <AgentAnnotationEditor
        annotations={[annotation]}
        activeId={annotation.id}
        onClose={vi.fn()}
        onChange={onChange}
        onLocate={onLocate}
        onRemove={onRemove}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Annotation for Launch script" }),
      { target: { value: "Use a measurable launch date." } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Locate annotation" }));
    expect(onLocate).toHaveBeenCalledWith(annotation.id);
    expect(
      screen.getByRole("button", { name: "Remove annotation" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onChange).toHaveBeenCalledWith(
      annotation.id,
      "Use a measurable launch date.",
    );
  });
});
