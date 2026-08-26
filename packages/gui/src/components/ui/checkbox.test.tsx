// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("uses Radix checkbox semantics and reports boolean state", () => {
    const onCheckedChange = vi.fn();

    render(
      <Checkbox
        aria-label="Scenes and shots"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Scenes and shots" });
    expect(checkbox.getAttribute("data-slot")).toBe("checkbox");
    expect(checkbox.getAttribute("data-state")).toBe("unchecked");

    fireEvent.click(checkbox);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});
