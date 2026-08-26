// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { join } from "node:path";

import { ConfirmDialogProvider } from "./ConfirmDialog";
import RecentProjects from "./RecentProjects";

describe("RecentProjects new project creation", () => {
  afterEach(cleanup);

  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("uses an explicit callback instead of querying the first textarea", () => {
    const source = fs.readFileSync(
      join(process.cwd(), "packages/web-ui/src/components/RecentProjects.tsx"),
      "utf8",
    );

    expect(source).not.toContain("document.querySelector('textarea')");
    expect(source).not.toContain('document.querySelector("textarea")');
  });

  it("delegates the entered project name to its owner", async () => {
    const onCreateProject = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <RecentProjects projects={[]} onCreateProject={onCreateProject} />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /start a new project/i }),
    );
    fireEvent.change(screen.getByRole("textbox", { name: /project name/i }), {
      target: { value: "Storyboard" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(onCreateProject).toHaveBeenCalledWith("Storyboard");
  });

  it("uses the create-project card as the empty rail state", () => {
    const { container } = render(
      <MemoryRouter>
        <RecentProjects projects={[]} onCreateProject={vi.fn()} />
      </MemoryRouter>,
    );

    const rail = container.querySelector(
      '[data-slot="recent-project-rail"]',
    );
    const createCard = screen.getByRole("button", {
      name: "Create a new project from the recent projects rail",
    });

    expect(rail).toContainElement(createCard);
    expect(createCard).toHaveTextContent("New Project");
    expect(container.querySelector('[data-slot="recent-projects-empty"]')).toBeNull();
    expect(screen.queryByText("No recent projects yet.")).toBeNull();
  });

  it("passes the single-project reference lock and add behavior to every card", () => {
    const onAddProjectReference = vi.fn();
    render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <RecentProjects
            projects={[
              {
                id: "project-1",
                name: "Storyboard",
                updatedAt: "2026-08-25T00:00:00.000Z",
              },
              {
                id: "project-2",
                name: "Campaign",
                updatedAt: "2026-08-24T00:00:00.000Z",
              },
            ]}
            onCreateProject={vi.fn()}
            composerProjectReferenceId="project-1"
            onAddProjectReference={onAddProjectReference}
          />
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", {
        name: "Add project Storyboard to composer",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Add project Campaign to composer",
      }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("button", {
        name: /Drag project .* to composer/,
      }),
    ).toBeNull();
  });

  it("keeps five recent projects and appends project creation to the rail", () => {
    const projects = Array.from({ length: 6 }, (_, index) => ({
      id: `project-${index + 1}`,
      name: `Recent ${index + 1}`,
      updatedAt: `2026-08-${String(25 - index).padStart(2, "0")}T00:00:00.000Z`,
    }));

    const { container } = render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <RecentProjects projects={projects} onCreateProject={vi.fn()} />
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );

    const rail = container.querySelector('[data-slot="recent-project-rail"]');
    expect(rail).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Start a new project" }),
    ).toHaveTextContent("Create project");
    const createCard = screen.getByRole("button", {
      name: "Create a new project from the recent projects rail",
    });
    expect(rail).toContainElement(createCard);
    expect(rail?.lastElementChild).toBe(createCard);
    expect(screen.getByText("Recent 1")).toBeTruthy();
    expect(screen.getByText("Recent 5")).toBeTruthy();
    expect(screen.queryByText("Recent 6")).toBeNull();

    const css = fs.readFileSync(
      join(process.cwd(), "apps/web/app/globals.css"),
      "utf8",
    );
    const railRule = css.match(
      /\.clash-recent-project-grid\s*\{[\s\S]*?\}/,
    )?.[0];
    expect(railRule).toMatch(/grid-auto-flow:\s*column/);
    expect(railRule).toMatch(/overflow-x:\s*auto/);
    expect(railRule).toMatch(/scroll-snap-type:\s*inline proximity/);
  });

  it("exposes edge fade cues only while more projects exist in that direction", () => {
    const { container } = render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <RecentProjects
            projects={[
              { id: "one", name: "One", updatedAt: "2026-08-25" },
              { id: "two", name: "Two", updatedAt: "2026-08-24" },
            ]}
            onCreateProject={vi.fn()}
          />
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );

    const shell = container.querySelector<HTMLElement>(
      '[data-slot="recent-project-rail-shell"]',
    )!;
    const rail = container.querySelector<HTMLElement>(
      '[data-slot="recent-project-rail"]',
    )!;
    Object.defineProperties(rail, {
      clientWidth: { configurable: true, value: 600 },
      scrollWidth: { configurable: true, value: 1200 },
      scrollLeft: { configurable: true, value: 0, writable: true },
    });

    fireEvent.scroll(rail);
    expect(shell.dataset.canScrollLeft).toBe("false");
    expect(shell.dataset.canScrollRight).toBe("true");

    rail.scrollLeft = 600;
    fireEvent.scroll(rail);
    expect(shell.dataset.canScrollLeft).toBe("true");
    expect(shell.dataset.canScrollRight).toBe("false");
  });
});
