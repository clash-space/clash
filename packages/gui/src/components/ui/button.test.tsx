// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  afterEach(() => {
    cleanup();
  });

  it("defaults to a non-submit button with the shared rounded shape", () => {
    render(<Button>Run</Button>);

    const button = screen.getByRole("button", { name: "Run" }) as HTMLButtonElement;
    expect(button.type).toBe("button");
    expect(button.className).toContain("rounded-xl");
  });

  it("renders icons as decorative slots without changing the accessible name", () => {
    render(
      <Button leftIcon={<span>+</span>} rightIcon={<span>{">"}</span>}>
        Add key
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Add key" });
    expect(button.querySelectorAll("[aria-hidden='true']")).toHaveLength(2);
  });
});
