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
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
  });

  function renderCard(projectOverrides: Record<string, unknown> = {}) {
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
              ...projectOverrides,
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

  it("renders four decorative preview assets from signed URLs and storage keys", () => {
    const { container } = renderCard({
      assets: [
        {
          id: "video-cover",
          type: "video",
          srcR2Key: "projects/project-1/assets/clip.mp4",
          coverR2Key: "projects/project-1/assets/clip-cover.jpg",
          createdAt: "2026-06-03T00:04:00.000Z",
        },
        {
          id: "signed-image",
          type: "image",
          signedUrl: "https://cdn.clash.test/assets/projects/project-1/assets/signed.png?exp=1&sig=test",
          createdAt: "2026-06-03T00:03:00.000Z",
        },
        {
          id: "storage-image",
          type: "image",
          storageKey: "projects/project-1/assets/storage.png",
          createdAt: "2026-06-03T00:02:00.000Z",
        },
        {
          id: "legacy-src",
          type: "image",
          src: "/assets/projects/project-1/assets/legacy.png?signed=1",
          createdAt: "2026-06-03T00:01:00.000Z",
        },
      ],
    });

    const images = Array.from(container.querySelectorAll<HTMLImageElement>(".clash-project-card-preview-img"));

    expect(images).toHaveLength(4);
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "/assets/projects/project-1/assets/clip-cover.jpg",
      "https://cdn.clash.test/assets/projects/project-1/assets/signed.png?exp=1&sig=test",
      "/assets/projects/project-1/assets/storage.png",
      "/assets/projects/project-1/assets/legacy.png?signed=1",
    ]);
    expect(images.every((image) => image.getAttribute("alt") === "")).toBe(true);
  });

  it("resolves local runtime asset previews against the runtime API origin", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      apiBaseUrl: "http://127.0.0.1:49321",
    };

    const { container } = renderCard({
      assets: [
        {
          id: "local-api-asset",
          type: "image",
          url: "/assets/generated/local-gen-cqj1uit7.svg",
          storageKey: "generated/local-gen-cqj1uit7.svg",
          createdAt: "2026-06-21T00:00:00.000Z",
        },
      ],
    });

    const image = container.querySelector<HTMLImageElement>(".clash-project-card-preview-img");

    expect(image?.getAttribute("src")).toBe("http://127.0.0.1:49321/assets/generated/local-gen-cqj1uit7.svg");
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
