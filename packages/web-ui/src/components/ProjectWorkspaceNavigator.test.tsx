// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspaceNavigator from './ProjectWorkspaceNavigator';

afterEach(cleanup);

describe('ProjectWorkspaceNavigator', () => {
    it("collapses completely and lets the workspace own the expand control", () => {
      function CollapsibleNavigator() {
        const [collapsed, setCollapsed] = useState(false);
        return (
          <>
            <button
              type="button"
              onClick={() => setCollapsed((current) => !current)}
            >
              {collapsed ? "Expand from workspace" : "Collapse from workspace"}
            </button>
            <ProjectWorkspaceNavigator
              collapsed={collapsed}
              canvases={[
                { id: "main", name: "Main", position: 0 },
                { id: "shots", name: "Shots", position: 1 },
              ]}
              timelines={[]}
              assets={[]}
              footer={<button type="button">Project settings</button>}
              surface={{ kind: "canvas", canvasId: "main" }}
              onSelectCanvas={vi.fn()}
              onSelectTimeline={vi.fn()}
              onSelectAsset={vi.fn()}
              onCreateCanvas={vi.fn()}
              onRenameCanvas={vi.fn()}
              onDeleteCanvas={vi.fn()}
              onCreateTimeline={vi.fn()}
              onAttachTimeline={vi.fn()}
              onAddAsset={vi.fn()}
            />
          </>
        );
      }

      render(<CollapsibleNavigator />);

      const navigator = screen.getByRole("complementary", {
        name: "Project navigator",
      });
      expect(navigator.getAttribute("data-collapsed")).toBe("false");
      expect(
        screen.getByRole("button", { name: "Project settings" }),
      ).toBeTruthy();

      fireEvent.click(
        screen.getByRole("button", { name: "Collapse from workspace" }),
      );

      expect(navigator.getAttribute("data-collapsed")).toBe("true");
      expect(navigator.getAttribute("aria-hidden")).toBe("true");
      expect(navigator.className).toContain("invisible");
      expect(screen.queryByRole("button", { name: "Expand project sidebar" })).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Project settings" }),
      ).toBeNull();
      expect(screen.queryByRole("tab", { name: "Main" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Search project" })).toBeNull();

      fireEvent.click(
        screen.getByRole("button", { name: "Expand from workspace" }),
      );
      expect(navigator.getAttribute("data-collapsed")).toBe("false");
      expect(navigator.getAttribute("aria-hidden")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Project settings" }),
      ).toBeTruthy();
    });

    it("exposes concrete Canvas, Timeline editor documents, and Asset surfaces", () => {
      const onSelectCanvas = vi.fn();
      const onSelectTimeline = vi.fn();
      const onSelectAsset = vi.fn();
      render(
        <ProjectWorkspaceNavigator
          canvases={[
            { id: "main", name: "Main", position: 0 },
            { id: "shots", name: "Shots", position: 1 },
          ]}
          timelines={[
            {
              id: "timeline-1",
              name: "Episode 1",
              owner: { kind: "project" },
              revisionId: "timeline-revision-v1:test",
              state: { tracks: [] },
            },
            {
              id: "timeline-2",
              name: "Trailer Cut",
              owner: {
                kind: "canvas-action",
                canvasId: "main",
                actionNodeId: "timeline-action-2",
              },
              revisionId: "timeline-revision-v1:attached",
              state: { tracks: [] },
            },
          ]}
          assets={[
            {
              id: "asset-1",
              url: "/asset-1.png",
              type: "image",
              storageKey: "asset-1.png",
              createdAt: null,
            },
          ]}
          footer={<button type="button">Project settings</button>}
          surface={{ kind: "canvas", canvasId: "main" }}
          onSelectCanvas={onSelectCanvas}
          onSelectTimeline={onSelectTimeline}
          onSelectAsset={onSelectAsset}
          onCreateCanvas={vi.fn()}
          onRenameCanvas={vi.fn()}
          onDeleteCanvas={vi.fn()}
          onCreateTimeline={vi.fn()}
          onAttachTimeline={vi.fn()}
          onAddAsset={vi.fn()}
        />,
      );

      expect(
        screen.getByRole("tablist", { name: "Project surfaces" }),
      ).toBeTruthy();
      const mainTab = screen.getByRole("tab", { name: "Main" });
      expect(mainTab.getAttribute("aria-selected")).toBe("true");
      expect(mainTab.className).toContain("w-full");
      expect(mainTab.className).not.toContain("flex-1");
      expect(
        screen.getByRole("button", { name: "Canvas actions for Main" }).className,
      ).toContain("absolute");
      expect(screen.queryByRole("heading", { name: "Library" })).toBeNull();
      const projectControls = screen.getByRole("group", {
        name: "Project controls",
      });
      expect(
        projectControls.contains(
          screen.getByRole("button", { name: "Project settings" }),
        ),
      ).toBe(true);

      fireEvent.click(screen.getByRole("tab", { name: "Shots" }));
      fireEvent.click(screen.getByRole("tab", { name: "Episode 1" }));
      fireEvent.click(screen.getByRole("tab", { name: "Trailer Cut" }));
      fireEvent.click(screen.getByRole("tab", { name: "asset-1.png" }));

      expect(onSelectCanvas).toHaveBeenCalledWith("shots");
      expect(onSelectTimeline).toHaveBeenCalledWith("timeline-1");
      expect(onSelectTimeline).toHaveBeenCalledWith("timeline-2");
      expect(onSelectAsset).toHaveBeenCalledWith("asset-1");
    });

    it("uses the same collapsible folder contract for Canvases, Timelines, and Assets", () => {
      const onCreateCanvas = vi.fn();
      const onCreateTimeline = vi.fn();
      const onAddAsset = vi.fn();
      render(
        <ProjectWorkspaceNavigator
          canvases={[{ id: "main", name: "Main", position: 0 }]}
          timelines={[
            {
              id: "timeline-1",
              name: "Episode 1",
              owner: { kind: "project" },
              revisionId: "timeline-revision-v1:test",
              state: { tracks: [] },
            },
          ]}
          assets={[
            {
              id: "asset-1",
              url: "/asset-1.png",
              type: "image",
              storageKey: "asset-1.png",
              createdAt: null,
            },
          ]}
          surface={{ kind: "asset", assetId: "asset-1" }}
          onSelectCanvas={vi.fn()}
          onSelectTimeline={vi.fn()}
          onSelectAsset={vi.fn()}
          onCreateCanvas={onCreateCanvas}
          onRenameCanvas={vi.fn()}
          onDeleteCanvas={vi.fn()}
          onCreateTimeline={onCreateTimeline}
          onAttachTimeline={vi.fn()}
          onAddAsset={onAddAsset}
        />,
      );

      expect(screen.queryByRole("heading", { name: "Library" })).toBeNull();
      const folders = ["Canvases", "Timelines", "Assets"].map((name) =>
        screen.getByRole("button", { name }),
      );
      expect(
        folders.map((folder) => folder.getAttribute("aria-expanded")),
      ).toEqual(["true", "true", "true"]);
      expect(new Set(folders.map((folder) => folder.className)).size).toBe(1);
      expect(folders.every((folder) => folder.className.includes("justify-start"))).toBe(true);
      expect(
        new Set(
          folders.map(
            (folder) => folder.closest("[data-project-folder-header]")?.className,
          ),
        ).size,
      ).toBe(1);
      expect(
        screen.queryByText("1", {
          selector: '[data-sidebar-action-slot="asset-count"]',
        }),
      ).toBeNull();
      expect(
        screen
          .getByRole("tab", { name: "asset-1.png" })
          .getAttribute("aria-selected"),
      ).toBe("true");

      fireEvent.click(screen.getByRole("button", { name: "New Canvas" }));
      fireEvent.click(screen.getByRole("button", { name: "New Timeline" }));
      fireEvent.click(screen.getByRole("button", { name: "Add Asset" }));
      expect(onCreateCanvas).toHaveBeenCalledOnce();
      expect(onCreateTimeline).toHaveBeenCalledOnce();
      expect(onAddAsset).toHaveBeenCalledOnce();
      expect(
        folders.map((folder) => folder.getAttribute("aria-expanded")),
      ).toEqual(["true", "true", "true"]);

      fireEvent.click(folders[0]);
      expect(folders[0].getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("tab", { name: "Main" })).toBeNull();
      expect(screen.getByRole("tab", { name: "Episode 1" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "asset-1.png" })).toBeTruthy();

      fireEvent.click(folders[1]);
      expect(folders[1].getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("tab", { name: "Episode 1" })).toBeNull();
      expect(screen.getByRole("tab", { name: "asset-1.png" })).toBeTruthy();

      fireEvent.click(folders[2]);
      expect(folders[2].getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByRole("tab", { name: "asset-1.png" })).toBeNull();
    });

    it("lists every project asset beneath Assets and makes each item selectable and draggable", () => {
      const onSelectAsset = vi.fn();
      const assets = [
        {
          id: "asset-image",
          url: "/hero-frame.png",
          type: "image" as const,
          storageKey: "shots/hero-frame.png",
          createdAt: null,
        },
        {
          id: "asset-video",
          url: "/teaser.mp4",
          type: "video" as const,
          storageKey: "cuts/teaser.mp4",
          createdAt: null,
        },
      ];
      const props = {
        canvases: [{ id: "main", name: "Main", position: 0 }],
        timelines: [],
        assets,
        surface: { kind: "canvas" as const, canvasId: "main" },
        onSelectCanvas: vi.fn(),
        onSelectTimeline: vi.fn(),
        onSelectAsset,
        onCreateCanvas: vi.fn(),
        onRenameCanvas: vi.fn(),
        onDeleteCanvas: vi.fn(),
        onCreateTimeline: vi.fn(),
        onAttachTimeline: vi.fn(),
        onAddAsset: vi.fn(),
      };
      const { rerender } = render(<ProjectWorkspaceNavigator {...props} />);

      expect(screen.getByRole("list", { name: "Project assets" })).toBeTruthy();
      expect(screen.getByText("hero-frame.png")).toBeTruthy();
      expect(screen.getByText("teaser.mp4")).toBeTruthy();

      const teaser = screen.getByRole("tab", { name: "teaser.mp4" });
      expect(teaser.getAttribute("draggable")).toBe("true");
      fireEvent.click(teaser);
      expect(onSelectAsset).toHaveBeenCalledWith("asset-video");

      const dragData = new Map<string, string>();
      const dataTransfer = {
        effectAllowed: "none",
        setData: vi.fn((type: string, value: string) =>
          dragData.set(type, value),
        ),
      };
      fireEvent.dragStart(teaser, { dataTransfer });
      expect(dataTransfer.effectAllowed).toBe("copy");
      expect(dragData.get("assetId")).toBe("asset-video");
      expect(dragData.get("text/plain")).toBe("asset-video");
      expect(JSON.parse(dragData.get("asset") ?? "{}")).toMatchObject({
        id: "asset-video",
        backingAssetId: "asset-video",
        src: "/teaser.mp4",
        type: "video",
      });

      rerender(<ProjectWorkspaceNavigator {...props} collapsed />);
      expect(screen.queryByRole("list", { name: "Project assets" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "hero-frame.png" })).toBeNull();

      rerender(<ProjectWorkspaceNavigator {...props} />);
      expect(screen.getByRole("list", { name: "Project assets" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "hero-frame.png" })).toBeTruthy();
    });

    it("keeps an empty Timeline section quiet instead of spending space on a redundant message", () => {
      render(
        <ProjectWorkspaceNavigator
          canvases={[{ id: "main", name: "Main", position: 0 }]}
          timelines={[]}
          assets={[]}
          surface={{ kind: "canvas", canvasId: "main" }}
          onSelectCanvas={vi.fn()}
          onSelectTimeline={vi.fn()}
          onSelectAsset={vi.fn()}
          onCreateCanvas={vi.fn()}
          onRenameCanvas={vi.fn()}
          onDeleteCanvas={vi.fn()}
          onCreateTimeline={vi.fn()}
          onAttachTimeline={vi.fn()}
          onAddAsset={vi.fn()}
        />,
      );

      expect(screen.getByRole("heading", { name: "Timelines" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "New Timeline" })).toBeTruthy();
      expect(screen.queryByText("No standalone timelines")).toBeNull();
    });

    it("opens project navigation from a Cmd-K command palette without filtering the sidebar itself", () => {
      const onSelectCanvas = vi.fn();
      render(
        <ProjectWorkspaceNavigator
          canvases={[
            { id: "main", name: "Main", position: 0 },
            { id: "shots", name: "Shots", position: 1 },
          ]}
          timelines={[
            {
              id: "timeline-1",
              name: "Episode 1",
              owner: { kind: "project" },
              revisionId: "timeline-revision-v1:test",
              state: { tracks: [] },
            },
          ]}
          assets={[]}
          surface={{ kind: "canvas", canvasId: "main" }}
          onSelectCanvas={onSelectCanvas}
          onSelectTimeline={vi.fn()}
          onSelectAsset={vi.fn()}
          onCreateCanvas={vi.fn()}
          onRenameCanvas={vi.fn()}
          onDeleteCanvas={vi.fn()}
          onCreateTimeline={vi.fn()}
          onAttachTimeline={vi.fn()}
          onAddAsset={vi.fn()}
        />,
      );

      const trigger = screen.getByRole("button", { name: "Search project" });
      expect(trigger.className).toContain("h-8");
      expect(screen.getByText("⌘K")).toBeTruthy();
      expect(
        screen.queryByRole("combobox", { name: "Search project" }),
      ).toBeNull();

      fireEvent.keyDown(window, { key: "k", metaKey: true });

      const search = screen.getByRole("combobox", { name: "Search project" });
      fireEvent.change(search, { target: { value: "shots" } });

      expect(document.getElementById("project-canvas-main")).toBeTruthy();
      expect(document.getElementById("project-timeline-timeline-1")).toBeTruthy();
      expect(screen.getByRole("option", { name: "Shots Canvas" })).toBeTruthy();
      expect(screen.queryByRole("option", { name: "Main Canvas" })).toBeNull();

      fireEvent.click(screen.getByRole("option", { name: "Shots Canvas" }));
      expect(onSelectCanvas).toHaveBeenCalledWith("shots");
      expect(
        screen.queryByRole("combobox", { name: "Search project" }),
      ).toBeNull();
    });
});
