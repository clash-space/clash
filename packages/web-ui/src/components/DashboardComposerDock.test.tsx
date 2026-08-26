// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn().mockResolvedValue([
    { id: "project-1", name: "Launch film" },
    { id: "project-2", name: "Second cut" },
  ]),
}));

vi.mock("@clash/web-ui/lib/clientActions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@clash/web-ui/lib/clientActions")>()),
  listProjects: mocks.listProjects,
}));

vi.mock("./HeroSection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./HeroSection")>();
  return {
    ...actual,
    DashboardComposerRuntime: () => (
      <div
        data-testid="shared-dashboard-runtime"
        className="clash-chat-input-surface"
      >
        runtime
      </div>
    ),
  };
});

import DashboardComposerDock, {
  DashboardComposerDockFrame,
} from "./DashboardComposerDock";
import { DashboardComposerSkillReferences } from "./HeroSection";
import {
  DashboardComposerProvider,
  useDashboardComposer,
} from "./DashboardComposerContext";

function AddReferenceControls() {
  const { addProjectReference, addSkillReference } = useDashboardComposer();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          addProjectReference({ id: "project-1", name: "Launch film" })
        }
      >
        Add Project
      </button>
      <button
        type="button"
        onClick={() => addSkillReference({ id: "skill-1", name: "storyboard" })}
      >
        Add Skill
      </button>
    </>
  );
}

describe("DashboardComposerDock", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      vi.fn(function ResizeObserver() {
        return {
          disconnect: vi.fn(),
          observe: vi.fn(),
          unobserve: vi.fn(),
        };
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("provides one compact persistent shell without a second outer Project layer", () => {
    render(
      <DashboardComposerDockFrame>
        <div data-testid="shared-composer">composer</div>
      </DashboardComposerDockFrame>,
    );

    const dock = screen.getByRole("region", { name: "Dashboard composer" });
    expect(dock.dataset.slot).toBe("dashboard-composer-dock");
    expect(dock.dataset.density).toBe("compact");
    expect(dock.dataset.size).toBe("lg");
    expect(screen.getByTestId("shared-composer").closest("[data-slot]")).toBe(
      dock,
    );
    expect(
      dock.querySelector(".clash-dashboard-composer-project-context"),
    ).toBeNull();
  });

  it("keeps the compact Project tag outside the one shared Composer surface", () => {
    render(
      <DashboardComposerProvider>
        <DashboardComposerDock />
      </DashboardComposerProvider>,
    );

    const surface = screen.getByTestId("shared-dashboard-runtime");
    const projectContext = screen.getByRole("group", {
      name: "Project context",
    });
    expect(surface.contains(projectContext)).toBe(false);
    expect(
      screen
        .getByRole("region", { name: "Dashboard composer" })
        .contains(projectContext),
    ).toBe(true);
    expect(projectContext).toHaveTextContent("Create new project");
    expect(
      screen
        .getByRole("combobox", { name: "Choose a project" })
        .querySelector(".clash-dashboard-composer-project-selector-label svg"),
    ).not.toBeNull();
  });

  it("uses the shared cmdk project selector to switch among Create new project and existing Projects", async () => {
    render(
      <DashboardComposerProvider>
        <DashboardComposerDock />
      </DashboardComposerProvider>,
    );

    expect(screen.getByTestId("shared-dashboard-runtime")).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "make some clash" }),
    ).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Choose a project" }),
    ).toHaveTextContent("Create new project");

    fireEvent.click(screen.getByRole("combobox", { name: "Choose a project" }));
    fireEvent.click(await screen.findByRole("option", { name: "Launch film" }));
    expect(screen.getByText("Launch film")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Choose a project" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("combobox", { name: "Choose a project" }));
    fireEvent.click(await screen.findByRole("option", { name: "Second cut" }));
    expect(
      screen.getByRole("combobox", { name: "Choose a project" }),
    ).toHaveTextContent("Second cut");

    fireEvent.click(screen.getByRole("combobox", { name: "Choose a project" }));
    fireEvent.click(
      await screen.findByRole("option", { name: /Create new project/ }),
    );
    expect(
      screen.getByRole("combobox", { name: "Choose a project" }),
    ).toHaveTextContent("Create new project");
  });

  it("keeps Skill references inside the shared composer instead of the Project scope row", () => {
    render(
      <DashboardComposerProvider>
        <AddReferenceControls />
        <div data-testid="composer-surface">
          <DashboardComposerSkillReferences />
        </div>
      </DashboardComposerProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add Skill" }));
    const references = screen.getByRole("list", { name: "Skill references" });
    expect(screen.getByTestId("composer-surface").contains(references)).toBe(
      true,
    );
    expect(screen.getByText("$storyboard")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove storyboard" }));
    expect(screen.queryByRole("list", { name: "Skill references" })).toBeNull();
  });
});
