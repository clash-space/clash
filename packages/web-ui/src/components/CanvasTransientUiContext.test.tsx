// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  CanvasTransientUiProvider,
  createCanvasTransientUiStore,
  useCanvasTransientUiOwner,
} from "./CanvasTransientUiContext";

describe("Canvas transient UI ownership", () => {
  it("allows only one action panel to own the canvas overlay", () => {
    const store = createCanvasTransientUiStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CanvasTransientUiProvider store={store}>
        {children}
      </CanvasTransientUiProvider>
    );
    const first = renderHook(
      () => useCanvasTransientUiOwner("action-panel", "first"),
      { wrapper },
    );
    const second = renderHook(
      () => useCanvasTransientUiOwner("action-panel", "second"),
      { wrapper },
    );

    act(() => first.result.current.open());
    expect(first.result.current.isOpen).toBe(true);
    expect(second.result.current.isOpen).toBe(false);

    act(() => second.result.current.open());
    expect(first.result.current.isOpen).toBe(false);
    expect(second.result.current.isOpen).toBe(true);
  });

  it("dismisses the current owner from canvas-level interactions", () => {
    const store = createCanvasTransientUiStore();
    store.open("action-panel", "first");

    store.dismiss();

    expect(store.isOpen("action-panel", "first")).toBe(false);
  });

  it("releases ownership when the owning surface unmounts", () => {
    const store = createCanvasTransientUiStore();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CanvasTransientUiProvider store={store}>
        {children}
      </CanvasTransientUiProvider>
    );
    const owner = renderHook(
      () => useCanvasTransientUiOwner("action-panel", "first"),
      { wrapper },
    );

    act(() => owner.result.current.open());
    owner.unmount();

    expect(store.isOpen("action-panel", "first")).toBe(false);
  });
});
