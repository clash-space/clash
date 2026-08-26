// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import HomeMarketplaceRecommendations from "./HomeMarketplaceRecommendations";

const items = Array.from({ length: 5 }, (_, index) => ({
  id: `skill-${index + 1}`,
  type: "skill" as const,
  name: `Skill ${index + 1}`,
  description: `Real registry skill ${index + 1}.`,
}));

describe("HomeMarketplaceRecommendations", () => {
  afterEach(() => {
    cleanup();
  });

  it("does not reserve homepage space when the feed has no featured plugins", () => {
    render(
      <MemoryRouter>
        <HomeMarketplaceRecommendations
          featuredPlugins={[]}
          installedActionIds={[]}
          installedSkillIds={[]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("region", { name: "From Marketplace" }),
    ).toBeNull();
  });

  it("renders every configured featured plugin and links to the full marketplace", () => {
    const { container } = render(
      <MemoryRouter>
        <HomeMarketplaceRecommendations
          featuredPlugins={items}
          installedActionIds={[]}
          installedSkillIds={[]}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("region", { name: "From Marketplace" }),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skill 1" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Skill 5" })).toBeTruthy();
    expect(
      container.querySelectorAll('[data-slot="home-marketplace-item"]'),
    ).toHaveLength(5);
    expect(
      screen
        .getByRole("link", { name: "View Marketplace" })
        .getAttribute("href"),
    ).toBe("/marketplace/manage");
    expect(
      screen.getByRole("link", { name: "View Skill 1 details" }),
    ).toHaveAttribute("href", "/marketplace/skill/skill-1");
  });

  it("keeps Home as a lightweight discovery preview without Marketplace operations", () => {
    render(
      <MemoryRouter>
        <HomeMarketplaceRecommendations
          featuredPlugins={[items[0]]}
          installedActionIds={[]}
          installedSkillIds={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Install" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Add to Composer" }),
    ).toBeNull();
    expect(screen.getByRole("link", { name: "View Marketplace" })).toBeTruthy();
  });

  it("shows installation state as quiet metadata", () => {
    render(
      <MemoryRouter>
        <HomeMarketplaceRecommendations
          featuredPlugins={[items[0]]}
          installedActionIds={[]}
          installedSkillIds={[items[0].id]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Installed")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
