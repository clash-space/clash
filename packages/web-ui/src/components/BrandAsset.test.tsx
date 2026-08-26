// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { BrandAsset } from "./BrandAsset";

afterEach(cleanup);

describe("BrandAsset", () => {
  it.each([
    ["mark", "identity"],
    ["assets", "feature"],
    ["emptySearch", "state"],
  ] as const)("exposes the %s asset role", (name, role) => {
    const { container } = render(<BrandAsset name={name} alt="" />);
    const image = container.querySelector('[data-ui="brand-asset"]');

    expect(image).toHaveAttribute("data-asset-name", name);
    expect(image).toHaveAttribute("data-asset-role", role);
  });

  it("keeps decorative artwork silent and non-draggable by default", () => {
    const { container } = render(<BrandAsset name="plugins" alt="" />);
    const image = container.querySelector("img");

    expect(image).toHaveAttribute("aria-hidden", "true");
    expect(image).toHaveAttribute("draggable", "false");
  });

  it("keeps meaningful state artwork available to assistive technology", () => {
    const { container } = render(
      <BrandAsset name="error" alt="Clash error avatar" />,
    );
    const image = container.querySelector("img");

    expect(image).toHaveAttribute("alt", "Clash error avatar");
    expect(image).not.toHaveAttribute("aria-hidden");
  });
});
