// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    AnimatePresence: ({ children }: { children?: ReactNode }) => (
      <>{children}</>
    ),
    motion: new Proxy(
      {},
      {
        get:
          (_target, tag: string) =>
          ({
            children,
            whileHover: _whileHover,
            whileTap: _whileTap,
            transition: _transition,
            ...props
          }: {
            children?: ReactNode;
            [key: string]: unknown;
          }) =>
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

  it("renders only the explicitly selected Project Asset cover", () => {
    const { container } = renderCard({
      coverAssetId: "video-cover",
      assets: [
        {
          id: "newer-but-not-cover",
          kind: "image",
          url: "https://media.clash.test/assets/newer",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
        {
          id: "video-cover",
          kind: "video",
          url: "https://media.clash.test/assets/video-cover",
          thumbnailUrl: "https://media.clash.test/thumbnails/video-cover",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
      ],
    });

    const images = Array.from(
      container.querySelectorAll<HTMLImageElement>(
        ".clash-project-card-preview-img",
      ),
    );

    expect(images).toHaveLength(1);
    expect(images.map((image) => image.getAttribute("src"))).toEqual([
      "https://media.clash.test/thumbnails/video-cover",
    ]);
    expect(images.every((image) => image.getAttribute("alt") === "")).toBe(
      true,
    );
  });

  it("does not infer a cover from available Project Assets", () => {
    const { container } = renderCard({
      assets: [
        {
          id: "available-image",
          kind: "image",
          url: "https://media.clash.test/assets/available-image",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
      ],
    });

    expect(
      container.querySelector(".clash-project-card-preview-img"),
    ).toBeNull();
    expect(
      container.querySelector(".clash-project-card-empty-mark"),
    ).not.toBeNull();
  });

  it("does not rewrite a Host-projected preview against the runtime API origin", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = {
      apiBaseUrl: "http://127.0.0.1:49321",
    };

    const { container } = renderCard({
      coverAssetId: "local-api-asset",
      assets: [
        {
          id: "local-api-asset",
          kind: "image",
          url: "https://media.clash.test/assets/local-api-asset",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
      ],
    });

    const image = container.querySelector<HTMLImageElement>(
      ".clash-project-card-preview-img",
    );

    expect(image?.getAttribute("src")).toBe(
      "https://media.clash.test/assets/local-api-asset",
    );
  });

  it("does not try to render audio assets as project-cover images", () => {
    const { container } = renderCard({
      coverAssetId: "voice",
      assets: [
        {
          id: "voice",
          kind: "audio",
          url: "https://media.clash.test/assets/voice",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
        {
          id: "music",
          kind: "audio",
          url: "https://media.clash.test/assets/music",
          metadata: {},
          lifecycle: { state: "active" },
          status: "ready",
        },
      ],
    });

    expect(
      container.querySelectorAll(".clash-project-card-preview-img"),
    ).toHaveLength(0);
    expect(
      container.querySelector(".clash-project-card-preview-grid"),
    ).toBeNull();
    expect(
      container.querySelector(".clash-project-card-empty-mark"),
    ).not.toBeNull();
  });

  it("uses the app confirm dialog for destructive deletion", async () => {
    renderCard();

    fireEvent.click(
      screen.getByRole("button", {
        name: /delete project storyboard draft/i,
      }),
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("data-state")).toBe("open");
    expect(dialog.textContent).toContain("Delete project?");
    expect(dialog.textContent).toContain(
      "Storyboard draft will be removed from this workspace.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(deleteProject).toHaveBeenCalledWith("project-1");
    });
  });
});
