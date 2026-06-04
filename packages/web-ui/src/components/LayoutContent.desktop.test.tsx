// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import LayoutContent from "./LayoutContent";

vi.mock("./TopNavigation", () => ({
  default: () => <div data-testid="desktop-chrome" />,
}));

vi.mock("./Background", () => ({
  default: () => <div data-testid="dashboard-background" />,
}));

function renderAt(pathname: string, children: ReactNode = <div>Project canvas</div>) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <LayoutContent isAuthenticated>{children}</LayoutContent>
    </MemoryRouter>,
  );
}

describe("LayoutContent desktop chrome", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    document.documentElement.classList.remove("clash-desktop-route");
    document.documentElement.classList.remove("clash-desktop-project-route");
    document.documentElement.classList.remove("clash-is-scrolling");
    delete globalThis.__CLASH_DESKTOP__;
  });

  it("keeps desktop tabs visible on project detail pages in Electron", () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    renderAt("/projects/project-1");

    expect(screen.getByTestId("desktop-chrome")).toBeTruthy();
    expect(screen.queryByTestId("dashboard-background")).toBeNull();
    expect(screen.getByText("Project canvas")).toBeTruthy();
  });

  it("locks page-level scrolling for desktop project detail pages", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    const { unmount } = renderAt("/projects/project-1");

    await waitFor(() => {
      expect(document.documentElement.classList.contains("clash-desktop-project-route")).toBe(true);
    });

    unmount();

    await waitFor(() => {
      expect(document.documentElement.classList.contains("clash-desktop-project-route")).toBe(false);
    });
  });

  it("uses a main scroll container below the desktop tab header", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    renderAt("/projects", <div>Projects index</div>);

    const main = screen.getByRole("main");
    expect(main.className).toContain("clash-desktop-scroll-root");
    expect(main.className).toContain("mt-10");
    expect(main.className).toContain("h-[calc(100dvh-2.5rem)]");
    expect(main.className).toContain("overflow-y-auto");

    await waitFor(() => {
      expect(document.documentElement.classList.contains("clash-desktop-route")).toBe(true);
    });
  });

  it("marks scrollbars visible only while a scroll is active", async () => {
    vi.useFakeTimers();
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    renderAt("/projects", <div>Projects index</div>);

    expect(document.documentElement.classList.contains("clash-is-scrolling")).toBe(false);

    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });

    expect(document.documentElement.classList.contains("clash-is-scrolling")).toBe(true);

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(document.documentElement.classList.contains("clash-is-scrolling")).toBe(false);
  });
});
