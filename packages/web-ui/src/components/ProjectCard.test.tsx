// @vitest-environment jsdom
import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
} from "@dnd-kit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { archiveProject } from "@clash/web-ui/lib/clientActions";

import { ConfirmDialogProvider } from "./ConfirmDialog";
import ProjectCard from "./ProjectCard";
import type { ProjectReference } from "./dashboardComposerReferences";

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  archiveProject: vi.fn(),
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

function DragHarness({
  children,
  onDragStart,
}: {
  children: ReactNode;
  onDragStart?: (event: DragStartEvent) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart}>
      {children}
    </DndContext>
  );
}

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current location">{location.pathname}</output>;
}

describe("ProjectCard", () => {
  afterEach(() => {
    cleanup();
    vi.mocked(archiveProject).mockClear();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
  });

  function renderCard(
    projectOverrides: Record<string, unknown> = {},
    referenceProps: {
      composerProjectReferenceId?: string | null;
      onAddProjectReference?: (project: ProjectReference) => void;
    } = {},
    onDragStart?: (event: DragStartEvent) => void,
  ) {
    return render(
      <MemoryRouter>
        <ConfirmDialogProvider>
          <DragHarness onDragStart={onDragStart}>
            <ProjectCard
              project={{
                id: "project-1",
                name: "Storyboard draft",
                createdAt: "2026-06-03T00:00:00.000Z",
                updatedAt: "2026-06-03T00:00:00.000Z",
                assets: [],
                ...projectOverrides,
              }}
              {...referenceProps}
            />
          </DragHarness>
          <LocationProbe />
        </ConfirmDialogProvider>
      </MemoryRouter>,
    );
  }

  it("keeps archive controls outside the project link", () => {
    renderCard();

    const link = screen.getByRole("link", { name: /storyboard draft/i });
    const archiveButton = screen.getByRole("button", {
      name: /archive project storyboard draft/i,
    });

    expect(link.contains(archiveButton)).toBe(false);
  });

  it("keeps preview actions as unframed icon controls", () => {
    renderCard({}, { onAddProjectReference: vi.fn() });

    const addButton = screen.getByRole("button", {
      name: "Add project Storyboard draft to composer",
    });
    const archiveButton = screen.getByRole("button", {
      name: "Archive project Storyboard draft",
    });

    expect(addButton).not.toHaveClass(
      "bg-warm-surface/90",
      "shadow-sm",
      "backdrop-blur-sm",
    );
    expect(archiveButton).not.toHaveClass(
      "clash-project-card-delete",
      "backdrop-blur-sm",
    );
  });

  it("adds only the stable project reference and keeps its control outside the link", () => {
    const onAddProjectReference = vi.fn();
    renderCard({ assets: [{ id: "asset-1" }] }, { onAddProjectReference });

    const link = screen.getByRole("link", { name: /storyboard draft/i });
    const addButton = screen.getByRole("button", {
      name: "Add project Storyboard draft to composer",
    });

    fireEvent.click(addButton);
    expect(onAddProjectReference).toHaveBeenCalledWith({
      id: "project-1",
      name: "Storyboard draft",
    });
    expect(link.contains(addButton)).toBe(false);
    expect(
      screen.queryByRole("button", {
        name: "Drag project Storyboard draft to composer",
      }),
    ).toBeNull();
  });

  it("keeps normal project navigation and delete outside pointer dragging", () => {
    const onDragStart = vi.fn();
    renderCard({}, { onAddProjectReference: vi.fn() }, onDragStart);

    fireEvent.click(screen.getByRole("link", { name: /storyboard draft/i }));
    expect(screen.getByLabelText("Current location").textContent).toBe(
      "/projects/project-1",
    );
    expect(onDragStart).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: /archive project storyboard draft/i,
      }),
    );
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it("locks other project reference controls without disabling navigation or archive", () => {
    const onDragStart = vi.fn();
    renderCard(
      {},
      {
        composerProjectReferenceId: "project-2",
        onAddProjectReference: vi.fn(),
      },
      onDragStart,
    );

    expect(
      screen.getByRole("button", {
        name: "Add project Storyboard draft to composer",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("link", { name: /storyboard draft/i }),
    ).not.toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", {
        name: /archive project storyboard draft/i,
      }),
    ).not.toBeDisabled();

    const preview = screen
      .getByRole("link", { name: /storyboard draft/i })
      .querySelector<HTMLElement>(".clash-project-card-frame");
    if (!preview) throw new Error("Missing project preview");
    fireEvent.pointerDown(preview, {
      button: 0,
      pointerId: 2,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      pointerId: 2,
      clientX: 30,
      clientY: 10,
      isPrimary: true,
    });
    expect(onDragStart).not.toHaveBeenCalled();
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
      container.querySelector('[data-slot="project-empty-copy"]'),
    ).toHaveTextContent("Nothing to see. Yet.");
  });

  it("uses a quiet text-only empty state when no cover exists", () => {
    const { container } = renderCard();

    expect(
      container.querySelector('[data-slot="project-empty-artwork"]'),
    ).toBeNull();
    expect(
      container.querySelector('[data-slot="project-empty-copy"]'),
    ).toHaveTextContent("Nothing to see. Yet.");
    expect(
      container.querySelector('[data-slot="project-placeholder-avatar"]'),
    ).toBeNull();
    expect(
      container.querySelector(".clash-project-card-empty-mark"),
    ).toBeNull();
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
      container.querySelector('[data-slot="project-empty-copy"]'),
    ).toHaveTextContent("Nothing to see. Yet.");
  });

  it("archives projects through a recoverable confirmation", async () => {
    renderCard();

    fireEvent.click(
      screen.getByRole("button", {
        name: /archive project storyboard draft/i,
      }),
    );

    const dialog = screen.getByRole("alertdialog");
    expect(dialog.getAttribute("data-state")).toBe("open");
    expect(dialog.textContent).toContain("Archive project?");
    expect(dialog.textContent).toContain(
      "Storyboard draft will be hidden from the project browser.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(archiveProject).toHaveBeenCalledWith("project-1");
    });
  });

  it("drags the stable project reference from the whole preview after the pointer threshold", () => {
    const onDragStart = vi.fn();
    const { container } = renderCard(
      {},
      { onAddProjectReference: vi.fn() },
      onDragStart,
    );
    const preview = container.querySelector<HTMLElement>(
      ".clash-project-card-frame",
    );
    if (!preview) throw new Error("Missing project preview");
    expect(preview).toHaveAttribute("data-ui", "card");

    fireEvent.pointerDown(preview, {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      isPrimary: true,
    });
    fireEvent.pointerMove(document, {
      pointerId: 1,
      clientX: 16,
      clientY: 10,
      isPrimary: true,
    });
    expect(onDragStart).not.toHaveBeenCalled();
    fireEvent.pointerMove(document, {
      pointerId: 1,
      clientX: 19,
      clientY: 10,
      isPrimary: true,
    });

    expect(onDragStart).toHaveBeenCalledOnce();
    expect(onDragStart.mock.calls[0]?.[0].active.data.current).toEqual({
      type: "dashboard-project-reference",
      reference: { id: "project-1", name: "Storyboard draft" },
    });
  });
});
