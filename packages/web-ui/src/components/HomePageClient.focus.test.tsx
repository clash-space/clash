// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import HomePageClient from "./HomePageClient";
import {
  DashboardComposerProvider,
  useDashboardComposer,
} from "./DashboardComposerContext";
import { createProject } from "@clash/web-ui/lib/clientActions";

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  createProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./RecentProjects", () => ({
  default: ({
    onCreateProject,
    onAddProjectReference,
    composerProjectReferenceId,
  }: {
    onCreateProject?: (name: string) => void;
    onAddProjectReference?: (project: { id: string; name: string }) => void;
    composerProjectReferenceId?: string | null;
  }) => (
    <>
      <button
        type="button"
        onClick={() => onCreateProject?.("Homepage project")}
      >
        Create project
      </button>
      <button
        type="button"
        onClick={() =>
          onAddProjectReference?.({
            id: "project-1",
            name: "Referenced project",
          })
        }
      >
        Add project reference
      </button>
      <output data-testid="selected-project-reference">
        {composerProjectReferenceId ?? "none"}
      </output>
    </>
  ),
}));

function ReferenceProbe() {
  const { references } = useDashboardComposer();
  return (
    <output data-testid="project-reference-name">
      {references.project?.name}
    </output>
  );
}

describe("HomePageClient new project creation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("creates directly from Recent Projects without sending the user to the hero composer", async () => {
    render(
      <MemoryRouter>
        <HomePageClient initialProjects={[]} />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith("Homepage project", {
        startFromPrompt: false,
      });
    });
    expect(
      screen.queryByRole("heading", { name: "make some clash" }),
    ).toBeNull();
  });

  it("wires Recent Projects to the dashboard Composer reference state", () => {
    render(
      <MemoryRouter>
        <DashboardComposerProvider>
          <HomePageClient initialProjects={[]} />
          <ReferenceProbe />
        </DashboardComposerProvider>
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Add project reference" }),
    );

    expect(screen.getByTestId("project-reference-name")).toHaveTextContent(
      "Referenced project",
    );
    expect(screen.getByTestId("selected-project-reference")).toHaveTextContent(
      "project-1",
    );
  });
});
