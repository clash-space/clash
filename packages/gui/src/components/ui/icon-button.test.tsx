// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("composes the shared Button primitive instead of rendering its own native button", () => {
    const source = readFileSync(
      join(process.cwd(), "packages/gui/src/components/ui/icon-button.tsx"),
      "utf8",
    );
    const iconButtonStart = source.indexOf("export const IconButton");
    const iconButtonSource = source.slice(iconButtonStart);

    expect(source).toContain("./button");
    expect(iconButtonSource).toContain("<Button");
    expect(iconButtonSource).not.toContain("<button");
  });
});
