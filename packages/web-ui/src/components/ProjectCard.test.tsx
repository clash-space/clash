// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deleteProject } from "@clash/web-ui/lib/clientActions";

import { ConfirmDialogProvider } from "./ConfirmDialog";
import ProjectCard from "./ProjectCard";

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  deleteProject: vi.fn(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({ children, whileHover: _whileHover, whileTap: _whileTap, transition: _transition, ...props }: { children?: ReactNode; [key: string]: unknown }) =>
            React.createElement(tag, props, children),
      },
    ),
  };
});

describe("ProjectCard", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(deleteProject).mockClear();
  });

  function renderCard() {
    return render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <ProjectCard
            project={{
              id: "project-1",
              name: "Storyboard draft",
              createdAt: "2026-06-03T00:00:00.000Z",
              updatedAt: "2026-06-03T00:00:00.000Z",
              assets: [],
            }}
          />
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );
  }

  it("keeps destructive controls outside the project link", () => {
    renderCard();

    const link = screen.getByRole("link", { name: /storyboard draft/i });
    const deleteButton = screen.getByRole("button", {
      name: /delete project storyboard draft/i,
    });

    expect(link.contains(deleteButton)).toBe(false);
  });

  it("uses the app confirm dialog for destructive deletion", async () => {
    renderCard();

    fireEvent.click(screen.getByRole("button", {
      name: /delete project storyboard draft/i,
    }));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete project?");
    expect(dialog.textContent).toContain("Storyboard draft will be removed from this workspace.");

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith("project-1");
    });
  });
});
