// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { handleSelectionAnnotationContextMenu } from "./selectionAnnotationContextMenu";

describe("handleSelectionAnnotationContextMenu", () => {
  it("opens the annotation draft and suppresses the native menu for a selected passage", () => {
    const root = document.createElement("div");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const captureSelection = vi.fn(() => true);

    expect(
      handleSelectionAnnotationContextMenu(
        {
          currentTarget: root,
          preventDefault,
          stopPropagation,
        },
        { current: { captureSelection } },
      ),
    ).toBe(true);

    expect(captureSelection).toHaveBeenCalledWith(root);
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
  });

  it("leaves the native context menu alone when there is no annotatable selection", () => {
    const root = document.createElement("div");
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    expect(
      handleSelectionAnnotationContextMenu(
        {
          currentTarget: root,
          preventDefault,
          stopPropagation,
        },
        { current: { captureSelection: () => false } },
      ),
    ).toBe(false);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
  });
});
