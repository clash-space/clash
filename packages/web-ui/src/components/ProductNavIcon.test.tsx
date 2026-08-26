// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  ProductNavIcon,
  type ProductNavIconKind,
} from "./ProductNavIcon";

afterEach(cleanup);

describe("ProductNavIcon", () => {
  it("renders every destination in the shared Clash open-stroke family", () => {
    const kinds: ProductNavIconKind[] = [
      "home",
      "projects",
      "assets",
      "store",
    ];
    const { container } = render(
      <>
        {kinds.map((kind) => (
          <ProductNavIcon key={kind} kind={kind} aria-label={kind} />
        ))}
      </>,
    );

    const icons = Array.from(
      container.querySelectorAll<SVGElement>('[data-slot="product-nav-icon"]'),
    );
    expect(icons).toHaveLength(4);

    for (const [index, icon] of icons.entries()) {
      expect(icon).toHaveAttribute("data-kind", kinds[index]);
      expect(icon).toHaveAttribute("data-icon-family", "clash-open");
      expect(icon).toHaveAttribute("fill", "none");
      expect(icon).toHaveAttribute("stroke", "currentColor");
      expect(icon).toHaveAttribute("stroke-linecap", "round");
      expect(icon).toHaveAttribute("stroke-linejoin", "round");
      expect(
        icon.querySelector('[data-slot="product-nav-signature"]'),
      ).toBeTruthy();
    }
  });
});
