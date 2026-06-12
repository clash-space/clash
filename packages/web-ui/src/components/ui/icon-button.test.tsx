// @vitest-environment jsdom
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IconButton } from "./icon-button";

describe("IconButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("uses the squared Clash button shape by default", () => {
    render(<IconButton label="Add" icon={<span>+</span>} />);

    expect(screen.getByRole("button", { name: "Add" }).className).toContain("rounded-lg");
  });

  it("still supports explicit circular buttons for true status affordances", () => {
    render(<IconButton label="Status" shape="circle" icon={<span>•</span>} />);

    expect(screen.getByRole("button", { name: "Status" }).className).toContain("rounded-full");
  });
});
