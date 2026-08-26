// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { HomeSectionActionLink, HomeSectionHeader } from "./HomeSectionHeader";

const componentDir = __dirname;
const workspaceRoot = resolve(componentDir, "../../../..");

describe("HomeSectionHeader", () => {
  it("owns one compact title and action row", () => {
    const { container } = render(
      <HomeSectionHeader
        id="section-title"
        title="Recently viewed"
        action={<a href="/projects">See all</a>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Recently viewed" }).id).toBe(
      "section-title",
    );
    expect(screen.getByRole("link", { name: "See all" })).toBeTruthy();
    expect(
      container.querySelector('[data-slot="home-section-header"]'),
    ).toBeTruthy();
  });

  it("can align the first Home section with the shared desktop chrome row", () => {
    const { container } = render(
      <HomeSectionHeader
        id="page-start-title"
        title="Recently viewed"
        alignWithChrome
      />,
    );

    expect(
      container.querySelector('[data-slot="home-section-header"]'),
    ).toHaveAttribute("data-align", "app-chrome");

    const recentProjectsSource = readFileSync(
      resolve(componentDir, "RecentProjects.tsx"),
      "utf8",
    );
    expect(recentProjectsSource).toMatch(
      /<HomeSectionHeader[\s\S]*?alignWithChrome[\s\S]*?\/>/,
    );
  });

  it("sticks each section title to the top of the Home scrollport", () => {
    const { container } = render(
      <HomeSectionHeader id="sticky-title" title="Explore Clash" />,
    );

    const header = container.querySelector<HTMLElement>(
      '[data-slot="home-section-header"]',
    );
    expect(header).toHaveClass("sticky", "top-0", "z-[2]", "bg-warm-page");
  });

  it("uses one compact trailing action control across Home sections", () => {
    const { container } = render(
      <MemoryRouter>
        <HomeSectionActionLink to="/projects">See all</HomeSectionActionLink>
        <HomeSectionActionLink to="/marketplace/manage">
          View Marketplace
        </HomeSectionActionLink>
      </MemoryRouter>,
    );

    for (const name of ["See all", "View Marketplace"]) {
      const link = within(container).getByRole("link", { name });
      expect(link).toHaveAttribute("data-slot", "home-section-action-link");
      expect(link).toHaveClass("app-control", "h-7", "px-2", "text-xs");
      expect(link.querySelector("svg")).toBeTruthy();
    }

    for (const file of [
      "RecentProjects.tsx",
      "HomeMarketplaceRecommendations.tsx",
    ]) {
      const source = readFileSync(resolve(componentDir, file), "utf8");
      expect(source).toContain("<HomeSectionActionLink");
    }
  });

  it("is the shared header primitive for every Home section without wrapper spacing", () => {
    for (const file of [
      "RecentProjects.tsx",
      "HomeOperations.tsx",
      "HomeMarketplaceRecommendations.tsx",
    ]) {
      const source = readFileSync(resolve(componentDir, file), "utf8");
      expect(source).toContain('from "./HomeSectionHeader"');
      expect(source).toContain("<HomeSectionHeader");
      expect(source).not.toMatch(
        /<section[^>]*className="[^"]*(?:mt-|mb-|py-|pt-|pb-)/,
      );
    }

    const css = readFileSync(
      resolve(workspaceRoot, "apps/web/app/globals.css"),
      "utf8",
    );
    const headerRule = css.match(
      /\.clash-home-section-header\s*\{[\s\S]*?\}/,
    )?.[0];
    expect(headerRule).toBeTruthy();
    expect(headerRule).not.toMatch(/(?:min-)?height\s*:/);
    expect(headerRule).not.toMatch(/(?:margin|padding)(?:-[a-z]+)?\s*:/);

    const alignedHeaderRule = css.match(
      /\.clash-home-section-header\[data-align="app-chrome"\]\s*\{[\s\S]*?\}/,
    )?.[0];
    expect(alignedHeaderRule).toMatch(
      /min-height:\s*var\(--clash-project-sidebar-header-height\)/,
    );

    const titleRule = css.match(
      /\.clash-home-section-title\s*\{[\s\S]*?\}/,
    )?.[0];
    expect(titleRule).toMatch(/font-size:\s*var\(--clash-project-title-size\)/);
    expect(titleRule).toMatch(
      /font-weight:\s*var\(--clash-project-title-weight\)/,
    );

    const sectionRule = css.match(/\.clash-home-section\s*\{[\s\S]*?\}/)?.[0];
    expect(sectionRule).toMatch(/display:\s*flex/);
    expect(sectionRule).toMatch(/flex-direction:\s*column/);
    expect(sectionRule).toMatch(/gap:\s*var\(--clash-home-section-card-gap\)/);
    expect(sectionRule).not.toMatch(/(?:margin|padding)(?:-[a-z]+)?\s*:/);
    expect(css).toMatch(
      /--clash-home-section-card-gap:\s*var\(--clash-project-chrome-gutter\)/,
    );

    const stackRule = css.match(
      /\.clash-home-section-stack\s*\{[\s\S]*?\}/,
    )?.[0];
    expect(stackRule).toMatch(/gap:\s*var\(--clash-home-section-stack-gap\)/);
    expect(stackRule).not.toMatch(/padding(?:-[a-z]+)?\s*:/);
    expect(css).toMatch(
      /--clash-app-sidebar-first-control-offset:\s*calc\([\s\S]*?var\(--clash-app-sidebar-header-height\)[\s\S]*?var\(--clash-app-sidebar-section-gap\)[\s\S]*?\)/,
    );
    const topNavigationSource = readFileSync(
      resolve(componentDir, "TopNavigation.tsx"),
      "utf8",
    );
    expect(topNavigationSource).toContain(
      "h-[var(--clash-app-sidebar-search-height)]",
    );
    const homePageSource = readFileSync(
      resolve(componentDir, "HomePageClient.tsx"),
      "utf8",
    );
    expect(homePageSource).toContain(
      '<AppPage className="clash-home-section-stack">',
    );
    for (const file of [
      "RecentProjects.tsx",
      "HomeOperations.tsx",
      "HomeMarketplaceRecommendations.tsx",
    ]) {
      const source = readFileSync(resolve(componentDir, file), "utf8");
      expect(source).not.toMatch(
        /clash-home-section-(?:inline|block)-inset|clash-home-content-width/,
      );
      expect(source).not.toMatch(
        /<section[^>]*className="[^"]*(?:mx-auto|max-w-|\bpx-)/,
      );
    }
  });
});
