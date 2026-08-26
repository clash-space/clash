// @vitest-environment jsdom
import { useEffect, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import LayoutContent from "./LayoutContent";

const dockLifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
  providerMounts: 0,
  providerUnmounts: 0,
}));

vi.mock("./TopNavigation", () => ({
  default: () => <div data-testid="desktop-chrome" />,
}));

vi.mock("./Background", () => ({
  default: () => <div data-testid="dashboard-background" />,
}));

vi.mock("./DashboardComposerDock", () => ({
  default: () => {
    useEffect(() => {
      dockLifecycle.mounts += 1;
      return () => {
        dockLifecycle.unmounts += 1;
      };
    }, []);
    return <div data-testid="dashboard-composer-dock" />;
  },
}));

vi.mock("./DashboardComposerContext", () => ({
  DashboardComposerProvider: ({ children }: { children: ReactNode }) => {
    useEffect(() => {
      dockLifecycle.providerMounts += 1;
      return () => {
        dockLifecycle.providerUnmounts += 1;
      };
    }, []);
    return <div data-testid="dashboard-composer-provider">{children}</div>;
  },
}));

function RouteControls({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/")}>
        Home route
      </button>
      <button type="button" onClick={() => navigate("/marketplace/manage")}>
        Marketplace route
      </button>
      <button type="button" onClick={() => navigate("/projects/project-1")}>
        Project route
      </button>
      {children}
    </>
  );
}

describe("persistent dashboard composer routing", () => {
  afterEach(() => {
    cleanup();
    dockLifecycle.mounts = 0;
    dockLifecycle.unmounts = 0;
    dockLifecycle.providerMounts = 0;
    dockLifecycle.providerUnmounts = 0;
    delete globalThis.__CLASH_DESKTOP__;
  });

  it("keeps the dashboard Composer on Home and removes it from Marketplace and Project", () => {
    globalThis.__CLASH_DESKTOP__ = { isDesktop: true, newWindow: vi.fn() };
    render(
      <MemoryRouter initialEntries={["/"]}>
        <LayoutContent isAuthenticated>
          <RouteControls>
            <div>Route content</div>
          </RouteControls>
        </LayoutContent>
      </MemoryRouter>,
    );

    const dock = screen.getByTestId("dashboard-composer-dock");
    expect(dockLifecycle.mounts).toBe(1);
    expect(dockLifecycle.providerMounts).toBe(1);
    expect(screen.getByRole("main").className).toContain(
      "clash-dashboard-has-composer",
    );

    fireEvent.click(screen.getByRole("button", { name: "Marketplace route" }));
    expect(screen.queryByTestId("dashboard-composer-dock")).toBeNull();
    expect(screen.queryByTestId("dashboard-composer-provider")).toBeNull();
    expect(dockLifecycle.mounts).toBe(1);
    expect(dockLifecycle.unmounts).toBe(1);
    expect(dockLifecycle.providerUnmounts).toBe(1);

    fireEvent.click(screen.getByRole("button", { name: "Project route" }));
    expect(screen.queryByTestId("dashboard-composer-dock")).toBeNull();
    expect(screen.queryByTestId("dashboard-composer-provider")).toBeNull();
    expect(dockLifecycle.unmounts).toBe(1);
    expect(dockLifecycle.providerUnmounts).toBe(1);
  });
});
