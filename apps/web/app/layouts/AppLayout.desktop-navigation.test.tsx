// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryRouter,
} from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import AppLayout from "./AppLayout";

vi.mock("@clash/web-ui/components/LayoutContent", () => ({
  default: ({
    children,
    pendingPathname,
  }: {
    children: React.ReactNode;
    pendingPathname?: string | null;
  }) => (
    <div data-testid="desktop-layout" data-pending-pathname={pendingPathname ?? ""}>
      {children}
    </div>
  ),
}));

vi.mock("@clash/web-ui/components/DevLogBridge", () => ({
  default: () => null,
}));

vi.mock("@clash/web-ui/components/ConfirmDialog", () => ({
  ConfirmDialogProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

function ProjectScreen() {
  return (
    <main>
      <Link to="/">Dashboard</Link>
      <p>Project canvas</p>
    </main>
  );
}

function DashboardScreen() {
  return (
    <main>
      <p>Dashboard ready</p>
      <Outlet />
    </main>
  );
}

function DashboardWithProjectLink() {
  return (
    <main>
      <Link to="/projects/project-2">Open project</Link>
      <p>Dashboard ready</p>
    </main>
  );
}

describe("desktop workspace navigation", () => {
  afterEach(() => {
    cleanup();
    delete globalThis.__CLASH_DESKTOP__;
    delete globalThis.__CLASH_RUNTIME_CONFIG__;
  });

  it("replaces a stale Project with an explicit Dashboard loading state", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    let finishDashboard!: () => void;
    const dashboardLoader = new Promise<void>((resolve) => {
      finishDashboard = resolve;
    });
    const router = createMemoryRouter(
      [
        {
          Component: AppLayout,
          loader: async () => ({ isAuthenticated: true }),
          children: [
            {
              index: true,
              loader: async () => dashboardLoader,
              Component: DashboardScreen,
            },
            { path: "projects/:id", Component: ProjectScreen },
          ],
        },
      ],
      { initialEntries: ["/projects/project-1"] },
    );

    render(<RouterProvider router={router} />);
    expect(await screen.findByText("Project canvas")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));

    expect(
      await screen.findByRole("status", { name: "Opening Dashboard" }),
    ).toBeTruthy();
    expect(screen.queryByText("Project canvas")).toBeNull();

    finishDashboard();
    expect(await screen.findByText("Dashboard ready")).toBeTruthy();
  });

  it("switches chrome and content to a Project skeleton before its loader finishes", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    let finishProject!: () => void;
    const projectLoader = new Promise<void>((resolve) => {
      finishProject = resolve;
    });
    const router = createMemoryRouter(
      [
        {
          Component: AppLayout,
          loader: async () => ({ isAuthenticated: true }),
          children: [
            { index: true, Component: DashboardWithProjectLink },
            {
              path: "projects/:id",
              loader: async () => projectLoader,
              Component: ProjectScreen,
            },
          ],
        },
      ],
      { initialEntries: ["/"] },
    );

    render(<RouterProvider router={router} />);
    expect(await screen.findByText("Dashboard ready")).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Open project" }));

    expect(
      await screen.findByRole("status", { name: "Opening Project" }),
    ).toBeTruthy();
    expect(screen.queryByText("Dashboard ready")).toBeNull();
    expect(screen.getByTestId("desktop-layout").dataset.pendingPathname).toBe(
      "/projects/project-2",
    );

    finishProject();
    expect(await screen.findByText("Project canvas")).toBeTruthy();
  });
});
