// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import HomeOperations from "./HomeOperations";

describe("HomeOperations", () => {
  afterEach(() => cleanup());

  it("uses real product destinations for homepage operation slots", () => {
    render(
      <MemoryRouter>
        <HomeOperations />
      </MemoryRouter>,
    );

    expect(screen.getByRole("region", { name: "Explore Clash" })).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /organize your media/i })
        .getAttribute("href"),
    ).toBe("/assets");
    expect(
      screen
        .getByRole("link", { name: /extend your workflow/i })
        .getAttribute("href"),
    ).toBe("/marketplace/manage");
  });

  it("uses the Clash artwork family for Explore destinations", () => {
    render(
      <MemoryRouter>
        <HomeOperations />
      </MemoryRouter>,
    );

    const assets = screen.getByRole("link", { name: /organize your media/i });
    const marketplace = screen.getByRole("link", {
      name: /extend your workflow/i,
    });

    const assetsArtwork = assets.querySelector("img");
    const marketplaceArtwork = marketplace.querySelector("img");

    expect(assets).toHaveAttribute("data-ui", "card");
    expect(marketplace).toHaveAttribute("data-ui", "card");
    expect(
      assets.querySelector('[data-slot="artwork-slot"]'),
    ).toBeTruthy();
    expect(
      marketplace.querySelector('[data-slot="artwork-slot"]'),
    ).toBeTruthy();
    expect(assetsArtwork).toHaveAttribute("src", "/brand/avatar-assets.png");
    expect(assetsArtwork).toHaveAttribute("data-ui", "brand-asset");
    expect(assetsArtwork).toHaveAttribute("data-asset-role", "feature");
    expect(assetsArtwork?.parentElement).toHaveAttribute(
      "data-slot",
      "artwork-slot",
    );
    expect(screen.getByText("Assets")).toHaveAttribute(
      "data-slot",
      "operation-label",
    );
    expect(screen.getByText("Assets")).not.toHaveAttribute("data-tone");
    expect(marketplaceArtwork).toHaveAttribute(
      "src",
      "/brand/avatar-plugins.png",
    );
    expect(marketplaceArtwork).toHaveAttribute("data-ui", "brand-asset");
    expect(marketplaceArtwork).toHaveAttribute("data-asset-role", "feature");
    expect(marketplaceArtwork?.parentElement).toHaveAttribute(
      "data-slot",
      "artwork-slot",
    );
    expect(screen.getByText("Store")).toHaveAttribute(
      "data-slot",
      "operation-label",
    );
    expect(screen.getByText("Store")).not.toHaveAttribute("data-tone");
    expect(assets.className).not.toContain("bg-warm-surface");
    expect(marketplace.className).not.toContain("bg-warm-surface");
  });
});
