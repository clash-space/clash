// @vitest-environment jsdom
import { cleanup, render, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import GlobalAssetsClient from "./GlobalAssetsClient";
import BillingClient from "./BillingClient";
import HomePageClient from "./HomePageClient";
import MarketplaceClient from "./MarketplaceClient";
import ProjectsClient from "./ProjectsClient";

afterEach(cleanup);

describe("authenticated app page layout", () => {
  it.each([
    {
      name: "Home",
      heading: "Recently viewed",
      width: "standard",
      renderPage: () => <HomePageClient initialProjects={[]} />,
    },
    {
      name: "Projects",
      heading: "Projects",
      width: "wide",
      renderPage: () => <ProjectsClient projects={[]} />,
    },
    {
      name: "Assets",
      heading: "Assets",
      width: "wide",
      renderPage: () => <GlobalAssetsClient initialAssets={[]} />,
    },
    {
      name: "Marketplace",
      heading: "Marketplace",
      width: "narrow",
      renderPage: () => (
        <MarketplaceClient
          items={[]}
          installedActionIds={[]}
          installedSkillIds={[]}
        />
      ),
    },
  ])(
    "puts $name content on the shared page inset contract",
    ({ heading, width, renderPage }) => {
      const { container } = render(
        <MemoryRouter>{renderPage()}</MemoryRouter>,
      );
      const page = container.querySelector<HTMLElement>(
        '[data-slot="app-page"]',
      );

      expect(page).not.toBeNull();
      expect(page).toHaveAttribute("data-width", width);
      expect(page).toHaveClass(
        "px-[var(--app-page-inline-inset)]",
        "pt-[var(--app-page-block-start)]",
        "pb-[var(--app-page-block-end)]",
      );
      expect(within(page!).getByRole("heading", { name: heading })).toBeTruthy();
    },
  );

  it("keeps Billing on the same narrow page inset", () => {
    const { container } = render(
      <MemoryRouter>
        <BillingClient
          balance={null}
          plans={[]}
          packs={[]}
          ledger={[]}
          notEnabled={false}
        />
      </MemoryRouter>,
    );
    const page = container.querySelector('[data-slot="app-page"]');
    const headerInset = container.querySelector(
      '[data-slot="app-page-inset"]',
    );

    expect(page).toHaveAttribute("data-width", "narrow");
    expect(page).toHaveClass(
      "px-[var(--app-page-inline-inset)]",
      "pt-[var(--app-page-block-start)]",
      "pb-[var(--app-page-block-end)]",
    );
    expect(headerInset).toHaveAttribute("data-width", "narrow");
    expect(headerInset).toHaveClass("px-[var(--app-page-inline-inset)]");
  });

  it.each([
    {
      name: "Projects",
      heading: "Projects",
      description: "Open a canvas or start a new one.",
      renderPage: () => <ProjectsClient projects={[]} />,
    },
    {
      name: "Assets",
      heading: "Assets",
      description:
        "One library for source files you want to reuse across canvases.",
      action: "Add assets",
      renderPage: () => <GlobalAssetsClient initialAssets={[]} />,
    },
    {
      name: "Marketplace",
      heading: "Marketplace",
      description: "Install actions and skills for your workspace",
      renderPage: () => (
        <MarketplaceClient
          items={[]}
          installedActionIds={[]}
          installedSkillIds={[]}
        />
      ),
    },
  ])(
    "renders $name through the shared page-header contract",
    ({ heading, description, action, renderPage }) => {
      const { container } = render(
        <MemoryRouter>{renderPage()}</MemoryRouter>,
      );
      const header = container.querySelector<HTMLElement>(
        '[data-slot="app-page-header"]',
      );

      expect(header).not.toBeNull();
      expect(within(header!).getByRole("heading", { name: heading })).toBeTruthy();
      expect(within(header!).getByText(description)).toBeTruthy();
      if (action) {
        expect(within(header!).getByRole("button", { name: action })).toBeTruthy();
      }
    },
  );
});
