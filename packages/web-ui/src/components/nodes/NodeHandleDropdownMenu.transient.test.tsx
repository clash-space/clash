// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  CanvasTransientUiProvider,
  createCanvasTransientUiStore,
} from "../CanvasTransientUiContext";
import {
  NodeHandleDropdownMenu,
  NodeHandleDropdownMenuItem,
} from "./NodeHandleDropdownMenu";

vi.mock("@xyflow/react", () => ({
  Handle: (props: Record<string, unknown>) => <span {...props} />,
  Position: { Right: "right" },
}));

describe("NodeHandleDropdownMenu transient ownership", () => {
  it("opens downstream actions as soon as the source handle is hovered", () => {
    const onOpenChange = vi.fn();
    render(
      <CanvasTransientUiProvider>
        <NodeHandleDropdownMenu
          ariaLabel="Add next"
          ownerId="node-1:source-handle"
          triggerLabel="Open downstream actions"
          onOpenChange={onOpenChange}
        >
          <NodeHandleDropdownMenuItem>Add image</NodeHandleDropdownMenuItem>
        </NodeHandleDropdownMenu>
      </CanvasTransientUiProvider>,
    );

    fireEvent.mouseEnter(
      screen.getByRole("button", { name: "Open downstream actions" }),
    );

    expect(screen.getByRole("menu")).not.toBeNull();
    expect(screen.queryByText("Open downstream actions")).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(true);
  });

  it("replaces an open action panel when the node menu opens", () => {
    const store = createCanvasTransientUiStore();
    store.open("action-panel", "action-1");

    render(
      <CanvasTransientUiProvider store={store}>
        <NodeHandleDropdownMenu
          ariaLabel="Add next"
          ownerId="node-1:source-handle"
        >
          <NodeHandleDropdownMenuItem>Add image</NodeHandleDropdownMenuItem>
        </NodeHandleDropdownMenu>
      </CanvasTransientUiProvider>,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Add next" }), {
      button: 0,
      ctrlKey: false,
    });

    expect(store.isOpen("action-panel", "action-1")).toBe(false);
    expect(screen.getByRole("menu", { name: "Add next" })).not.toBeNull();
  });
});
