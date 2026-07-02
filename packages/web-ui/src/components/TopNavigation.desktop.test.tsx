// @vitest-environment jsdom
import type { ReactNode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import TopNavigation from "./TopNavigation";

vi.mock("./UserControls", () => ({
  default: () => <button type="button">Account</button>,
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({ children, ...props }: { children?: ReactNode }) =>
            React.createElement(tag, props, children),
      },
    ),
  };
});

function LocationEcho() {
  const location = useLocation();
  return <output aria-label="location">{location.pathname}</output>;
}

describe("TopNavigation desktop chrome", () => {
  afterEach(() => {
    cleanup();
    delete globalThis.__CLASH_DESKTOP__;
  });

  it("uses Ariakit tab primitives instead of handwritten desktop tab semantics", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/web-ui/src/components/TopNavigation.tsx"),
      "utf8",
    );

    expect(source).toContain("@ariakit/react");
    expect(source).toContain("TabProvider");
    expect(source).toContain("TabList");
    expect(source).toContain("<Tab");
    expect(source).not.toContain('role="tablist"');
    expect(source).not.toContain('role="tab"');
    expect(source).not.toContain("aria-selected={active}");
  });

  it("uses the shared tooltip primitive for desktop icon controls instead of browser title attributes", () => {
    const source = readFileSync(
      resolve(process.cwd(), "packages/web-ui/src/components/TopNavigation.tsx"),
      "utf8",
    );
    const tooltipSource = readFileSync(
      resolve(process.cwd(), "packages/web-ui/src/components/ui/tooltip.tsx"),
      "utf8",
    );
    const start = source.indexOf('data-desktop-toolbar="true"');
    const end = source.indexOf("</TabProvider>", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const desktopToolbarSource = source.slice(start, end);

    expect(tooltipSource).toContain("@ariakit/react");
    expect(tooltipSource).toContain("TooltipProvider");
    expect(tooltipSource).toContain("TooltipAnchor");
    expect(tooltipSource).toContain("Tooltip");
    expect(source).toContain("./ui/tooltip");
    expect(source).toContain("./ui/icon-button");
    expect(desktopToolbarSource).toContain("<Tooltip label=");
    expect(desktopToolbarSource).toContain("<IconButton");
    expect(source).not.toContain("DesktopChromeTooltip");
    expect(source).not.toContain("TooltipProvider");
    expect(source).not.toContain("TooltipAnchor");
    expect(desktopToolbarSource).not.toContain("title=");
    expect(desktopToolbarSource).not.toContain("<button");
  });

  it("moves app shortcuts and account controls below the desktop tab strip", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <TopNavigation />
      </MemoryRouter>,
    );

    const desktopChrome = container.querySelector('[data-desktop-chrome="true"]');
    const shortcuts = await screen.findByRole("navigation", { name: "Primary" });
    const tablist = await screen.findByRole("tablist", { name: "Open tabs" });
    const account = await screen.findByRole("button", { name: "Account" });
    await waitFor(() => expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open Home" })).toBeNull();

    expect(desktopChrome?.contains(tablist)).toBe(true);
    expect(desktopChrome?.contains(shortcuts)).toBe(false);
    expect(desktopChrome?.contains(account)).toBe(false);
    expect(tablist.compareDocumentPosition(shortcuts) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelectorAll('[role="tablist"]')).toHaveLength(1);
  });

  it("opens internal links as the active desktop tab", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <TopNavigation />
        <Link to="/projects/project-1">Open Project</Link>
        <LocationEcho />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open Home" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Open Project" }));

    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/projects/project-1");
      expect(screen.getByRole("tab", { name: "Project" }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("uses project titles for project detail tabs", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/projects/project-1"]}>
        <TopNavigation />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "Project" })).toBeTruthy());

    window.dispatchEvent(
      new CustomEvent("clash:desktop-tab-title", {
        detail: {
          path: "/projects/project-1",
          title: "Storyboard draft",
        },
      }),
    );

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Storyboard draft" })).toBeTruthy();
    });
  });

  it("prevents text selection from desktop chrome clicks", () => {
    const globalCss = readFileSync(
      resolve(process.cwd(), "apps/web/app/globals.css"),
      "utf8",
    );

    expect(globalCss).toMatch(/\.desktop-drag-region[\s\S]*-webkit-user-select:\s*none;/);
    expect(globalCss).toMatch(/\.desktop-no-drag,\s*\.desktop-no-drag \*[\s\S]*user-select:\s*none;/);
  });

  it("keeps the empty tab strip area draggable with fixed desktop navigation controls", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <TopNavigation />
      </MemoryRouter>,
    );

    const tablist = await screen.findByRole("tablist", { name: "Open tabs" });
    const backButton = screen.getByRole("button", { name: "Back" }) as HTMLButtonElement;
    const forwardButton = screen.getByRole("button", { name: "Forward" }) as HTMLButtonElement;
    const homeTab = await screen.findByRole("tab", { name: "Home" });

    expect(tablist.className).toContain("desktop-drag-region");
    expect(tablist.className).not.toContain("desktop-no-drag");
    expect(homeTab.closest("[data-desktop-tab]")?.className).toContain("desktop-no-drag");
    expect(backButton.disabled).toBe(true);
    expect(forwardButton.disabled).toBe(true);
    expect(backButton.parentElement?.className).not.toContain("rounded-full");
    expect(backButton.parentElement?.className).not.toContain("border");
    expect(backButton.compareDocumentPosition(forwardButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(forwardButton.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tablist.contains(homeTab)).toBe(true);
    expect(screen.queryByRole("button", { name: "Reload" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New Tab" })).toBeNull();
  });

  it("keeps the desktop tab strip on settings without the product toolbar", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <TopNavigation />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tablist", { name: "Open tabs" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("tab", { name: "Settings" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
  });

  it("keeps Home as a normal desktop tab even when another route is active", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <TopNavigation />
        <LocationEcho />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tab", { name: "Settings" })).toBeTruthy();
    const homeTab = screen.getByRole("tab", { name: "Home" });
    expect(homeTab.closest('[role="tablist"]')).toBeTruthy();
    expect(homeTab.getAttribute("aria-selected")).toBe("false");
    expect(screen.queryByRole("button", { name: "Open Home" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Close Home" })).toBeNull();

    fireEvent.click(homeTab);

    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/");
      expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "Settings" })).toBeTruthy();
    });
  });

  it("keeps Home inside the retained tab sequence when Home is active", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/settings"]}>
        <TopNavigation />
        <LocationEcho />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("tab", { name: "Settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Home" }));

    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/");
      expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("tab", { name: "Settings" })).toBeTruthy();
    });

    const boundary = container.querySelector('[data-desktop-tab-boundary-separator="true"]');
    const tablist = screen.getByRole("tablist", { name: "Open tabs" });
    const homeTab = screen.getByRole("tab", { name: "Home" });

    expect(boundary).toBeNull();
    expect(tablist.contains(homeTab)).toBe(true);
    expect(homeTab.compareDocumentPosition(screen.getByRole("tab", { name: "Settings" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("uses desktop back and forward controls for route history while retaining Home as a tab", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    render(
      <MemoryRouter initialEntries={["/"]}>
        <TopNavigation />
        <Link to="/projects">Projects route</Link>
        <Link to="/projects/project-1">Project route</Link>
        <LocationEcho />
      </MemoryRouter>,
    );

    const back = await screen.findByRole("button", { name: "Back" }) as HTMLButtonElement;
    const forward = screen.getByRole("button", { name: "Forward" }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    expect(forward.disabled).toBe(true);
    expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.click(screen.getByRole("link", { name: "Projects route" }));
    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/projects");
      expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe("true");
      expect(back.disabled).toBe(false);
    });

    fireEvent.click(screen.getByRole("link", { name: "Project route" }));
    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/projects/project-1");
      expect(screen.getByRole("tab", { name: "Project" }).getAttribute("aria-selected")).toBe("true");
    });

    fireEvent.click(back);
    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/projects");
      expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe("true");
      expect(forward.disabled).toBe(false);
    });

    fireEvent.click(back);
    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/");
      expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
    });

    fireEvent.click(forward);
    await waitFor(() => {
      expect(screen.getByLabelText("location").textContent).toBe("/projects");
      expect(screen.getByRole("tab", { name: "Projects" }).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("uses shared desktop chrome metrics to align toolbar icons with macOS traffic lights", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <TopNavigation />
      </MemoryRouter>,
    );

    const desktopChrome = container.querySelector<HTMLElement>('[data-desktop-chrome="true"]');
    const toolbar = container.querySelector<HTMLElement>('[data-desktop-toolbar="true"]');
    await waitFor(() => expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open Home" })).toBeNull();

    expect(desktopChrome?.style.getPropertyValue("--clash-desktop-chrome-height")).toBe("40px");
    expect(desktopChrome?.style.getPropertyValue("--clash-desktop-toolbar-left-inset")).toBe("92px");
    expect(desktopChrome?.className).toContain("h-[var(--clash-desktop-chrome-height)]");
    expect(toolbar?.className).toContain(
      "pl-[max(var(--clash-desktop-toolbar-left-inset),env(safe-area-inset-left))]",
    );
  });

  it("adds dividers between adjacent inactive desktop tabs", async () => {
    globalThis.__CLASH_DESKTOP__ = {
      isDesktop: true,
      newWindow: vi.fn(),
    };

    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <TopNavigation />
        <Link to="/projects">Projects route</Link>
        <Link to="/projects/project-1">Project route</Link>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole("tab", { name: "Home" })).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Open Home" })).toBeNull();

    fireEvent.click(screen.getByRole("link", { name: "Projects route" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Projects" })).toBeTruthy());

    fireEvent.click(screen.getByRole("link", { name: "Project route" }));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Project" })).toBeTruthy());

    fireEvent.click(screen.getByRole("tab", { name: "Home" }));

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Home" }).getAttribute("aria-selected")).toBe("true");
    });

    const inactiveSeparators = container.querySelectorAll('[data-desktop-tab-separator="true"]');
    expect(inactiveSeparators).toHaveLength(1);
    expect(screen.getByRole("tab", { name: "Projects" }).closest("[data-desktop-tab]")?.contains(inactiveSeparators[0])).toBe(
      true,
    );
  });
});
