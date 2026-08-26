import { describe, expect, it } from "vitest";
import {
  activateOrAppendDesktopTab,
  appendDesktopTab,
  closeDesktopTab,
  createDesktopTab,
  titleForDesktopPath,
  updateDesktopTabPath,
  updateDesktopTabConnection,
  updateDesktopTabTitle,
} from "./desktopTabs";

describe("desktop tabs", () => {
  it("derives compact titles from app routes", () => {
    expect(titleForDesktopPath("/")).toBe("Home");
    expect(titleForDesktopPath("/projects")).toBe("Projects");
    expect(titleForDesktopPath("/marketplace")).toBe("Store");
    expect(titleForDesktopPath("/projects/abc")).toBe("Project");
  });

  it("appends a home tab with a supplied id", () => {
    expect(appendDesktopTab([], "/", "tab-1")).toEqual({
      tabs: [{ id: "tab-1", title: "Home", path: "/" }],
      activeTabId: "tab-1",
    });
  });

  it("reuses singleton route tabs once opened", () => {
    const tabs = [
      createDesktopTab("/", "tab-home"),
      createDesktopTab("/projects", "tab-projects"),
    ];
    expect(activateOrAppendDesktopTab(tabs, "/projects", "unused")).toEqual({
      tabs,
      activeTabId: "tab-projects",
    });
  });

  it("cold-creates project tabs only when their route opens", () => {
    const tabs = [createDesktopTab("/projects/a", "tab-project-a")];
    expect(
      activateOrAppendDesktopTab(tabs, "/projects/b", "tab-project-b"),
    ).toEqual({
      tabs: [
        createDesktopTab("/projects/a", "tab-project-a"),
        createDesktopTab("/projects/b", "tab-project-b"),
      ],
      activeTabId: "tab-project-b",
    });
  });

  it("updates only the active tab path and title", () => {
    const tabs = [
      createDesktopTab("/", "tab-1"),
      createDesktopTab("/projects", "tab-2"),
    ];
    expect(updateDesktopTabPath(tabs, "tab-2", "/marketplace")).toEqual([
      createDesktopTab("/", "tab-1"),
      createDesktopTab("/marketplace", "tab-2"),
    ]);
  });

  it("updates tab titles by path", () => {
    const tabs = [
      createDesktopTab("/", "tab-1"),
      createDesktopTab("/projects/project-1", "tab-2"),
      createDesktopTab("/projects/project-2", "tab-3"),
    ];
    expect(
      updateDesktopTabTitle(tabs, "/projects/project-1", "Storyboard draft"),
    ).toEqual([
      createDesktopTab("/", "tab-1"),
      {
        ...createDesktopTab("/projects/project-1", "tab-2"),
        title: "Storyboard draft",
      },
      createDesktopTab("/projects/project-2", "tab-3"),
    ]);
    expect(
      updateDesktopTabTitle(tabs, "/projects/project-1", "   ")[1].title,
    ).toBe("Untitled");
  });

  it("tracks the live Project connection on its tab without changing the title", () => {
    const tabs = [
      createDesktopTab("/", "tab-home"),
      createDesktopTab("/projects/project-1", "tab-project"),
    ];

    expect(
      updateDesktopTabConnection(
        tabs,
        "/projects/project-1",
        "disconnected",
      ),
    ).toEqual([
      tabs[0],
      { ...tabs[1], connection: "disconnected" },
    ]);
    expect(
      updateDesktopTabConnection(
        [{ ...tabs[1], connection: "connected" }],
        "/projects/project-1",
        undefined,
      ),
    ).toEqual([tabs[1]]);
  });

  it("activates the neighboring tab when closing the active tab", () => {
    const tabs = [
      createDesktopTab("/", "tab-1"),
      createDesktopTab("/projects", "tab-2"),
      createDesktopTab("/marketplace", "tab-3"),
    ];
    expect(closeDesktopTab(tabs, "tab-2", "tab-2")).toEqual({
      tabs: [
        createDesktopTab("/", "tab-1"),
        createDesktopTab("/marketplace", "tab-3"),
      ],
      activeTabId: "tab-3",
      nextPath: "/marketplace",
    });
  });

  it("keeps one home tab when closing the last tab", () => {
    expect(
      closeDesktopTab(
        [createDesktopTab("/projects", "tab-1")],
        "tab-1",
        "tab-1",
        "tab-home",
      ),
    ).toEqual({
      tabs: [createDesktopTab("/", "tab-home")],
      activeTabId: "tab-home",
      nextPath: "/",
    });
  });
});
