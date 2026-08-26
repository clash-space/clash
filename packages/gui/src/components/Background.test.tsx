// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import Background from "./Background";

describe("Background", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a neutral decorative page backdrop without visual texture", () => {
    const { container } = render(<Background />);
    const background = container.firstElementChild;

    expect(background?.getAttribute("aria-hidden")).toBe("true");
    expect(background?.className).toContain("bg-warm-page");
    expect(background?.children).toHaveLength(0);
    expect(background?.querySelector("svg")).toBeNull();
  });
});
