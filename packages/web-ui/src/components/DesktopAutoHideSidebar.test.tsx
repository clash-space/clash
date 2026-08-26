// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DesktopAutoHideSidebar,
  DesktopSidebarCollapseButton,
} from "./DesktopAutoHideSidebar";
import { DashboardComposerDockFrame } from "./DashboardComposerDock";

const label = "Project sidebar";

function getRegion(): HTMLElement {
  return screen.getByRole("complementary", { name: label });
}

function getRecoveryZone(): HTMLElement {
  return screen.getByRole("button", { name: /show project sidebar/i });
}

function getHoverRail(): HTMLElement {
  const rail = document.querySelector<HTMLElement>("[data-sidebar-hover-rail]");
  expect(rail).not.toBeNull();
  return rail!;
}

describe("DesktopAutoHideSidebar", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.classList.remove("is-resizing-sidebar");
    document.documentElement.style.removeProperty(
      "--clash-app-sidebar-expanded-width",
    );
    localStorage.removeItem("test-sidebar-width");
  });

  it("renders expanded in layout at the requested width", () => {
    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth={320}
        label={label}
      >
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const region = getRegion();
    expect(region).toHaveAttribute("data-state", "expanded");
    expect(region).toHaveStyle({ width: "320px" });
    const expandedPanel = region.querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    );
    expect(expandedPanel).not.toHaveAttribute("aria-hidden", "true");
    expect(expandedPanel).not.toHaveAttribute("inert");
    expect(
      screen.getByRole("button", { name: "Inner action" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /show project sidebar/i }),
    ).not.toBeInTheDocument();
  });

  it("collapses to zero layout width while keeping full children off canvas, hidden and inert", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const region = getRegion();
    expect(region).toHaveAttribute("data-state", "collapsed");
    expect(region).toHaveStyle({ width: "0px" });

    // Children still mounted at full width, translated off canvas, hidden + inert.
    const panel = region.querySelector<HTMLElement>("[data-sidebar-panel]");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("aria-hidden", "true");
    expect(panel).toHaveAttribute("inert");
    expect(panel).toHaveStyle({ width: "320px" });
    expect(screen.getByText("Inner action")).toBeInTheDocument();
  });

  it("previews over a scrim while the shared Linear rail is hovered, leaving collapsed state untouched", () => {
    const { rerender } = render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    fireEvent.pointerEnter(getRecoveryZone());

    let region = getRegion();
    expect(region).toHaveAttribute("data-state", "preview");
    const previewPanel = region.querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    );
    expect(previewPanel).not.toHaveAttribute("aria-hidden", "true");
    expect(previewPanel).not.toHaveAttribute("inert");
    expect(previewPanel?.className).toContain("fixed");
    const scrim = screen.getByTestId("desktop-auto-hide-sidebar-scrim");
    expect(scrim).toBeInTheDocument();
    expect(scrim.parentElement).toBe(document.body);

    fireEvent.pointerLeave(getHoverRail());
    region = getRegion();
    expect(region).toHaveAttribute("data-state", "collapsed");
    expect(region.querySelector("[data-sidebar-panel]")).toHaveAttribute(
      "inert",
    );
    expect(
      screen.queryByTestId("desktop-auto-hide-sidebar-scrim"),
    ).not.toBeInTheDocument();

    // The preview is transient: re-rendering with the same collapsed prop keeps
    // the sidebar collapsed, so nothing was persisted by previewing.
    rerender(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );
    expect(getRegion()).toHaveAttribute("data-state", "collapsed");
  });

  it("focuses the recovery zone with a neutral ring rather than a red or blue accent", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const className = getRecoveryZone().className;
    expect(className).not.toMatch(/ring-red/);
    expect(className).not.toMatch(/ring-blue/);
    expect(className).toMatch(/focus-visible:ring-2/);
    expect(className).toMatch(/focus-visible:ring-black/);
    expect(className).toMatch(/dark:focus-visible:ring-white/);
  });

  it("dims behind a restrained scrim without blurring the backdrop", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    fireEvent.pointerEnter(getRecoveryZone());

    const scrim = screen.getByTestId("desktop-auto-hide-sidebar-scrim");
    expect(scrim.className).toContain("bg-black/20");
    expect(scrim.className).not.toContain("backdrop-blur");
  });

  it("renders the panel as an opaque token surface with no translucency or backdrop blur", () => {
    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth={320}
        label={label}
      >
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const panel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;
    expect(panel.className).toContain("border-warm-border");
    expect(panel.className).toContain("bg-warm-muted");
    expect(panel.className).not.toContain("backdrop-blur");
    expect(panel.className).not.toMatch(/bg-white\//);
    expect(panel.className).not.toMatch(/bg-neutral-900\//);
  });

  it("lifts only the preview panel, using the floating shadow token instead of shadow-xl", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const collapsedPanel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;
    expect(collapsedPanel.className).not.toContain("clash-shadow-floating");

    fireEvent.pointerEnter(getRecoveryZone());

    const previewPanel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;
    expect(previewPanel.className).toContain(
      "[box-shadow:var(--clash-shadow-floating)]",
    );
    expect(previewPanel.className).not.toContain("shadow-xl");
  });

  it("keeps collapsed chrome empty and lets the preview header action pin it open", () => {
    const onCollapsedChange = vi.fn();
    render(
      <DesktopAutoHideSidebar
        collapsed
        expandedWidth={320}
        label={label}
        onCollapsedChange={onCollapsedChange}
      >
        <DesktopSidebarCollapseButton
          collapsed
          label={label}
          onCollapsedChange={onCollapsedChange}
        />
      </DesktopAutoHideSidebar>,
    );

    expect(document.querySelector("[data-sidebar-restore]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Keep Project sidebar open" }),
    ).toBeNull();

    fireEvent.pointerEnter(getRecoveryZone());
    fireEvent.click(
      screen.getByRole("button", { name: "Keep Project sidebar open" }),
    );
    expect(onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("keeps the same Linear rail and panel mounted while a preview is pinned open", () => {
    function StatefulSidebar() {
      const [collapsed, setCollapsed] = useState(true);
      return (
        <DesktopAutoHideSidebar
          collapsed={collapsed}
          expandedWidth={320}
          label={label}
          onCollapsedChange={setCollapsed}
        >
          <DesktopSidebarCollapseButton
            collapsed={collapsed}
            label={label}
            onCollapsedChange={setCollapsed}
          />
        </DesktopAutoHideSidebar>
      );
    }

    render(<StatefulSidebar />);

    const railBefore = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-rail]",
    );
    const panelBefore = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    );
    expect(railBefore).not.toBeNull();
    expect(panelBefore).not.toBeNull();

    fireEvent.pointerEnter(getRecoveryZone());
    fireEvent.click(
      screen.getByRole("button", { name: "Keep Project sidebar open" }),
    );

    const region = getRegion();
    expect(region).toHaveAttribute("data-state", "expanded");
    expect(region.querySelector("[data-sidebar-rail]")).toBe(railBefore);
    expect(region.querySelector("[data-sidebar-panel]")).toBe(panelBefore);
  });

  it("recovers the preview from keyboard focus and closes when focus leaves", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    fireEvent.focus(getRecoveryZone());
    expect(getRegion()).toHaveAttribute("data-state", "preview");

    fireEvent.blur(getRecoveryZone());
    expect(getRegion()).toHaveAttribute("data-state", "collapsed");
  });

  it("keeps the preview open when focus leaves the recovery button onto non-focusable panel space", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const zone = getRecoveryZone();
    fireEvent.focus(zone);
    const panel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;

    fireEvent.pointerEnter(panel);
    fireEvent.blur(zone, { relatedTarget: null });

    expect(getRegion()).toHaveAttribute("data-state", "preview");
  });

  it("reveals rather than resizes: the recovery zone carries no resize cursor or visible chrome", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const zone = getRecoveryZone();
    expect(zone.className).not.toContain("cursor-e-resize");
    expect(zone.className).not.toContain("resize");
    expect(zone.className).not.toMatch(/(^|\s)(bg-|border-)/);
  });

  it("re-enables pointer events on the recovery zone so edge hover fires under pointer-events-none chrome", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    expect(getRecoveryZone().className).toContain("pointer-events-auto");
  });

  it("covers the full remaining left edge below desktop chrome", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const rail = getHoverRail();
    expect(rail.className).toContain(
      "top-[var(--clash-desktop-chrome-height,0px)]",
    );
    expect(rail.className).toContain("bottom-0");
    expect(rail.className).not.toContain("bottom-2");
    expect(rail.className).not.toContain("inset-y-0");
  });

  it("uses the Linear hover-owner structure: one full-height 14px rail owns both the edge target and floated panel", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const rail = getHoverRail();
    const zone = getRecoveryZone();
    const panel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;

    expect(rail.className).toContain("fixed");
    expect(rail.className).toContain("bottom-0");
    expect(rail.className).toContain(
      "top-[var(--clash-desktop-chrome-height,0px)]",
    );
    expect(rail.className).toContain("w-[14px]");
    expect(rail).toContainElement(zone);
    expect(rail).toContainElement(panel);

    fireEvent.pointerEnter(rail);
    expect(getRegion()).toHaveAttribute("data-state", "preview");
  });

  it("keeps the edge-to-panel pointer bridge above the scrim while previewing", () => {
    vi.useFakeTimers();
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const zone = getRecoveryZone();
    fireEvent.pointerEnter(zone);

    const scrim = screen.getByTestId("desktop-auto-hide-sidebar-scrim");
    const panel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;
    expect(getRegion()).toHaveAttribute("data-state", "preview");
    expect(getHoverRail().className).toContain("w-[14px]");
    expect(panel.className).toContain("left-2");
    expect(Number(zone.style.zIndex)).toBeGreaterThan(
      Number(scrim.style.zIndex),
    );

    // Linear's scrim is visual only. It may never become a competing pointer
    // surface between the edge rail and its floated sidebar descendant.
    expect(scrim.className).toContain("pointer-events-none");

    fireEvent.pointerEnter(panel);
    expect(getRegion()).toHaveAttribute("data-state", "preview");
  });

  it("stacks a preview scrim above the dashboard task layer and the sidebar above both", () => {
    render(
      <>
        <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
          <button type="button">Inner action</button>
        </DesktopAutoHideSidebar>
        <DashboardComposerDockFrame>
          <div>Composer</div>
        </DashboardComposerDockFrame>
      </>,
    );

    fireEvent.pointerEnter(getRecoveryZone());

    const dock = screen.getByRole("region", { name: "Dashboard composer" });
    const scrim = screen.getByTestId("desktop-auto-hide-sidebar-scrim");
    const sidebar = getRegion();
    const dockLayer = Number(dock.style.zIndex);
    const scrimLayer = Number(scrim.style.zIndex);
    const sidebarLayer = Number(sidebar.style.zIndex);

    expect(dockLayer).toBeLessThan(scrimLayer);
    expect(scrimLayer).toBeLessThan(sidebarLayer);
  });

  it("places the recovery button before the panel so keyboard focus moves into the previewed sidebar", () => {
    render(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const region = getRegion();
    const zone = getRecoveryZone();
    const panel = region.querySelector<HTMLElement>("[data-sidebar-panel]")!;
    expect(
      zone.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.focus(zone);
    expect(region).toHaveAttribute("data-state", "preview");

    // Tabbing out of the recovery button and into the sidebar keeps it open.
    const inner = screen.getByRole("button", { name: "Inner action" });
    fireEvent.blur(zone, { relatedTarget: inner });
    expect(getRegion()).toHaveAttribute("data-state", "preview");

    fireEvent.focus(inner);
    expect(getRegion()).toHaveAttribute("data-state", "preview");

    // Only focus leaving the whole sidebar closes the preview.
    fireEvent.blur(inner, { relatedTarget: document.body });
    expect(getRegion()).toHaveAttribute("data-state", "collapsed");
  });

  it("accepts a CSS length for expandedWidth and slides the panel by its own width", () => {
    render(
      <DesktopAutoHideSidebar
        collapsed
        expandedWidth="var(--clash-app-sidebar-expanded-width)"
        label={label}
      >
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const region = getRegion();
    const panel = region.querySelector<HTMLElement>("[data-sidebar-panel]")!;
    expect(panel.style.width).toBe("var(--clash-app-sidebar-expanded-width)");
    expect(panel.style.transform).toBe("translateX(calc(-100% - 1.5rem))");
  });

  it("keeps the panel in place with a CSS-length width when expanded", () => {
    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth="var(--clash-app-sidebar-expanded-width)"
        label={label}
      >
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    const region = getRegion();
    expect(region.style.width).toBe("var(--clash-app-sidebar-expanded-width)");
    const panel = region.querySelector<HTMLElement>("[data-sidebar-panel]")!;
    expect(panel.style.transform).toBe("translateX(0)");
  });

  it("suppresses preview immediately after collapsing, then allows it again", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth={320}
        label={label}
      >
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    rerender(
      <DesktopAutoHideSidebar collapsed expandedWidth={320} label={label}>
        <button type="button">Inner action</button>
      </DesktopAutoHideSidebar>,
    );

    fireEvent.pointerEnter(getHoverRail());
    expect(getRegion()).toHaveAttribute("data-state", "collapsed");

    act(() => {
      vi.advanceTimersByTime(190);
    });

    // Linear's full-height rail remains the hover owner. Once the brief
    // post-collapse guard expires, it reveals the child panel without asking
    // the pointer to leave and re-enter the edge.
    expect(getRegion()).toHaveAttribute("data-state", "preview");
  });

  it("shows an explicit shared collapse control next to the resize handle", () => {
    const onCollapsedChange = vi.fn();
    render(
      <div className="flex h-14 items-center">
        <DesktopSidebarCollapseButton
          collapsed={false}
          label={label}
          onCollapsedChange={onCollapsedChange}
        />
      </div>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Collapse Project sidebar" }),
    );
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("persists a clamped 220-360px width and restores it on remount", () => {
    const onCollapsedChange = vi.fn();
    const { unmount } = render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth="var(--clash-app-sidebar-expanded-width)"
        label={label}
        onCollapsedChange={onCollapsedChange}
        widthStorageKey="test-sidebar-width"
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );
    const panel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      width: 256,
      height: 600,
      x: 0,
      y: 0,
      top: 0,
      right: 256,
      bottom: 600,
      left: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(
      screen.getByRole("separator", { name: "Resize Project sidebar" }),
      { clientX: 256 },
    );
    fireEvent.pointerUp(window, { clientX: 400 });

    expect(localStorage.getItem("test-sidebar-width")).toBe("360");
    expect(
      document.documentElement.style.getPropertyValue(
        "--clash-app-sidebar-expanded-width",
      ),
    ).toBe("360px");
    expect(getRegion()).toHaveStyle({ width: "360px" });

    unmount();
    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth="var(--clash-app-sidebar-expanded-width)"
        label={label}
        onCollapsedChange={onCollapsedChange}
        widthStorageKey="test-sidebar-width"
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );
    expect(getRegion()).toHaveStyle({ width: "360px" });
  });

  it("exposes an accessible separator and persists 8px keyboard resizing", () => {
    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth="var(--clash-app-sidebar-expanded-width)"
        label={label}
        onCollapsedChange={vi.fn()}
        widthStorageKey="test-sidebar-width"
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize Project sidebar",
    });
    expect(separator).toHaveAttribute("tabindex", "0");
    expect(separator).toHaveAttribute("aria-valuemin", "220");
    expect(separator).toHaveAttribute("aria-valuemax", "360");
    expect(separator).toHaveAttribute("aria-valuenow", "256");

    fireEvent.keyDown(separator, { key: "ArrowRight" });
    expect(separator).toHaveAttribute("aria-valuenow", "264");
    expect(localStorage.getItem("test-sidebar-width")).toBe("264");

    fireEvent.keyDown(separator, { key: "ArrowLeft" });
    expect(separator).toHaveAttribute("aria-valuenow", "256");

    fireEvent.keyDown(separator, { key: "End" });
    expect(separator).toHaveAttribute("aria-valuenow", "360");
    fireEvent.keyDown(separator, { key: "Home" });
    expect(separator).toHaveAttribute("aria-valuenow", "220");
    expect(localStorage.getItem("test-sidebar-width")).toBe("220");
  });

  it("uses a full-height resize hit target with a short Linear-style visual handle", () => {
    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth={320}
        label={label}
        onCollapsedChange={vi.fn()}
        className="pointer-events-none"
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );

    const separator = screen.getByRole("separator", {
      name: "Resize Project sidebar",
    });
    expect(separator.className).toContain("pointer-events-auto");
    expect(separator.className).toContain("inset-y-0");
    expect(separator.className).toContain("after:h-11");
    expect(separator.className).not.toContain("after:bottom-0");
  });

  it("reports the rendered CSS-length width when the separator can measure it", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const width = this.hasAttribute("data-sidebar-panel") ? 304 : 0;
        return {
          width,
          height: 600,
          x: 0,
          y: 0,
          top: 0,
          right: width,
          bottom: 600,
          left: 0,
          toJSON: () => ({}),
        };
      },
    );

    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth="var(--clash-app-sidebar-expanded-width)"
        label={label}
        onCollapsedChange={vi.fn()}
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );

    expect(
      screen.getByRole("separator", { name: "Resize Project sidebar" }),
    ).toHaveAttribute("aria-valuenow", "304");
  });

  it("toggles the persisted state with the Clash Cmd/Ctrl-backslash shortcut", () => {
    const onCollapsedChange = vi.fn();
    const { rerender } = render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth={320}
        label={label}
        onCollapsedChange={onCollapsedChange}
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );

    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(onCollapsedChange).toHaveBeenLastCalledWith(true);

    rerender(
      <DesktopAutoHideSidebar
        collapsed
        expandedWidth={320}
        label={label}
        onCollapsedChange={onCollapsedChange}
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(onCollapsedChange).toHaveBeenLastCalledWith(false);
  });

  it("collapses after the expanded divider is dragged below the collapse threshold", () => {
    const onCollapsedChange = vi.fn();
    render(
      <DesktopAutoHideSidebar
        collapsed={false}
        expandedWidth={320}
        label={label}
        onCollapsedChange={onCollapsedChange}
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );
    const panel = getRegion().querySelector<HTMLElement>(
      "[data-sidebar-panel]",
    )!;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
      width: 320,
      height: 600,
      x: 0,
      y: 0,
      top: 0,
      right: 320,
      bottom: 600,
      left: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(
      screen.getByRole("separator", { name: "Resize Project sidebar" }),
      { clientX: 320 },
    );
    fireEvent.pointerMove(window, { clientX: 150 });
    expect(onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("applies caller class names and a reduced-motion class", () => {
    render(
      <DesktopAutoHideSidebar
        collapsed
        expandedWidth={280}
        label={label}
        className="caller-root"
        panelClassName="caller-panel"
      >
        <span>Body</span>
      </DesktopAutoHideSidebar>,
    );

    const region = getRegion();
    expect(region.className).toContain("caller-root");
    expect(region.className).toContain("motion-reduce:transition-none");
    const panel = region.querySelector<HTMLElement>("[data-sidebar-panel]");
    expect(panel?.className).toContain("caller-panel");
    expect(panel?.className).toContain("motion-reduce:transition-none");
  });
});
