// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tooltip } from "./tooltip";

describe("Tooltip transient focus", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes immediately when its pointer leaves an activated control", () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Actions">
        <button type="button">Open actions</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Open actions" });

    fireEvent.mouseEnter(button);
    fireEvent.mouseMove(button, { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("tooltip").textContent).toBe("Actions");

    fireEvent.click(button);
    fireEvent.mouseLeave(button);
    act(() => vi.runAllTimers());

    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("supports right-side placement for vertical toolbars", () => {
    vi.useFakeTimers();
    render(
      <Tooltip label="Assets" placement="right">
        <button type="button">Open assets</button>
      </Tooltip>,
    );
    const button = screen.getByRole("button", { name: "Open assets" });

    fireEvent.mouseEnter(button);
    fireEvent.mouseMove(button, { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(200));

    expect(screen.getByRole("tooltip").getAttribute("data-placement")).toBe(
      "right",
    );
  });
});
