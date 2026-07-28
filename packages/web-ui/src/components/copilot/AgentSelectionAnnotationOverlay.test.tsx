// @vitest-environment jsdom
import { createRef } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentAnnotationTarget } from "@clash/shared-types";

import {
  AgentSelectionAnnotationOverlay,
  type AgentSelectionAnnotationOverlayHandle,
} from "./AgentSelectionAnnotationOverlay";

const target: AgentAnnotationTarget = {
  projectId: "project-1",
  surface: "canvas",
  surfaceId: "main",
  surfaceLabel: "Main",
  objectId: "main",
  objectType: "canvas",
  objectLabel: "Main",
  objectPath: "canvases/main",
  capabilities: ["read", "modify"],
};

describe("AgentSelectionAnnotationOverlay", () => {
  afterEach(cleanup);

  it("keeps an editor-owned text selection out of the workspace overlay", () => {
    const workspaceOverlayRef =
      createRef<AgentSelectionAnnotationOverlayHandle>();
    const editorOverlayRef =
      createRef<AgentSelectionAnnotationOverlayHandle>();
    const onCreate = vi.fn();
    const { getByTestId } = render(
      <div data-testid="workspace">
        <div
          data-testid="editor"
          data-agent-annotation-selection-root=""
          data-agent-annotation-object-id="text-1"
          data-agent-annotation-object-type="canvas-text"
          data-agent-annotation-object-label="Draft"
          contentEditable
          suppressContentEditableWarning
        >
          Select this sentence
          <AgentSelectionAnnotationOverlay
            ref={editorOverlayRef}
            target={target}
            annotations={[]}
            onCreate={onCreate}
            objectId="text-1"
          />
        </div>
        <AgentSelectionAnnotationOverlay
          ref={workspaceOverlayRef}
          target={target}
          annotations={[]}
          onCreate={onCreate}
          excludedObjectTypes={["canvas-text"]}
        />
      </div>,
    );

    const workspace = getByTestId("workspace");
    const editor = getByTestId("editor");
    const textNode = editor.firstChild;
    expect(textNode).toBeTruthy();

    const rect = {
      left: 20,
      right: 180,
      top: 30,
      bottom: 54,
      width: 160,
      height: 24,
      x: 20,
      y: 30,
      toJSON: () => ({}),
    };
    workspace.getBoundingClientRect = () =>
      ({ ...rect, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }) as DOMRect;
    editor.getBoundingClientRect = () =>
      ({ ...rect, left: 0, top: 0, right: 600, bottom: 500, width: 600, height: 500 }) as DOMRect;
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    Object.defineProperty(range, "getClientRects", {
      configurable: true,
      value: () => ({ 0: rect, length: 1, item: () => rect }),
    });
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => rect,
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    expect(
      workspaceOverlayRef.current?.captureSelection(workspace),
    ).toBe(false);
    expect(selection?.toString()).toBe("Select this sentence");

    act(() => {
      expect(editorOverlayRef.current?.captureSelection(editor)).toBe(true);
    });

    expect(
      screen.getByRole("textbox", { name: "Selection annotation comment" }),
    ).toBeTruthy();
  });
});
