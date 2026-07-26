// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import LandingHero from "@clash/web-ui/components/landing/LandingHero";
import LandingNav from "@clash/web-ui/components/landing/LandingNav";
import DownloadRoute from "./download";
import LandingRoute from "./landing";

vi.mock("react-router", () => ({
  Link: ({
    to,
    className,
    children,
  }: {
    to: string;
    className?: string;
    children: ReactNode;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));

vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

describe("desktop-first public landing", () => {
  afterEach(() => {
    cleanup();
  });

  it("leads with the product philosophy and presents desktop as its home", () => {
    render(<LandingHero />);

    expect(
      screen.getByRole("heading", {
        name: /where agents co-create, humans are welcome too/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByText(/a creative platform for agents, on your desktop/i),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("img", {
          name: /clash desktop with creative tools agents can use/i,
        })
        .getAttribute("src"),
    ).toBe(
      "https://raw.githubusercontent.com/clash-space/clash/master/.github/social-preview.png",
    );
    expect(
      screen
        .getByRole("link", { name: /download clash desktop/i })
        .getAttribute("href"),
    ).toBe("/download");
    expect(screen.queryByText(/\bweb\b/i)).toBeNull();
  });

  it("keeps the public header focused on desktop download, docs, and source", () => {
    render(<LandingNav />);

    expect(
      screen.getByRole("link", { name: /download/i }).getAttribute("href"),
    ).toBe("/download");
    expect(
      screen.getByRole("link", { name: /github/i }).getAttribute("href"),
    ).toBe("https://github.com/clash-space/clash");
    expect(screen.queryByRole("link", { name: /marketplace/i })).toBeNull();
  });

  it("keeps the full public story about agent creation, with editors framed as tools", () => {
    render(<LandingRoute />);

    expect(
      screen.getByRole("heading", {
        name: /a creative platform, not another ai feature/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: /tools agents can see, use, and change/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        name: /humans bring taste, judgment, and permission/i,
      }),
    ).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bweb\b/i);
    expect(document.body.textContent).not.toMatch(/\bcloud\b/i);
    expect(
      screen
        .queryAllByRole("link")
        .some((link) => link.getAttribute("href") === "/login"),
    ).toBe(false);
  });

  it("provides architecture-specific macOS installers plus Windows and Linux", () => {
    render(<DownloadRoute />);

    expect(
      screen.getByRole("heading", { name: /download clash desktop/i }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", { name: /download for macos apple silicon/i })
        .getAttribute("href"),
    ).toBe(
      "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-macOS-arm64.dmg",
    );
    expect(
      screen
        .getByRole("link", { name: /download for macos intel/i })
        .getAttribute("href"),
    ).toBe(
      "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-macOS-x64.dmg",
    );
    expect(
      screen
        .getByRole("link", { name: /download for windows/i })
        .getAttribute("href"),
    ).toBe(
      "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-Windows-x64.exe",
    );
    expect(
      screen
        .getByRole("link", { name: /download for linux/i })
        .getAttribute("href"),
    ).toBe(
      "https://github.com/clash-space/clash/releases/download/desktop-preview/Clash-Desktop-Linux-x64.AppImage",
    );
    expect(
      screen.getByRole("link", { name: /release notes/i }).getAttribute("href"),
    ).toBe("https://github.com/clash-space/clash/releases/tag/desktop-preview");
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });
});
