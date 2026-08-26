// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => localStorage.clear());

describe("project browser tabs", () => {
  it("opens, updates, and closes Backchat-style browser tabs", async () => {
    const modulePath = "./projectBrowserTabs";
    const module = await import(/* @vite-ignore */ modulePath).catch(
      () => null,
    );
    expect(module).not.toBeNull();
    if (!module) return;

    const opened = module.openProjectBrowserTab([], "browser-1");
    expect(opened.tab).toEqual({
      id: "browser-1",
      title: "New Browser",
      url: "about:blank",
    });

    const updated = module.updateProjectBrowserTab(opened.tabs, "browser-1", {
      title: "Clash docs",
      url: "https://clash.example/docs",
    });
    expect(updated[0]?.title).toBe("Clash docs");

    const second = module.openProjectBrowserTab(updated, "browser-2");
    expect(module.closeProjectBrowserTab(second.tabs, "browser-2")).toEqual({
      tabs: updated,
      nextBrowserId: "browser-1",
    });
    expect(module.closeProjectBrowserTab(updated, "browser-1")).toEqual({
      tabs: [],
      nextBrowserId: null,
    });

    expect(module.ensureProjectBrowserTab).toBeTypeOf("function");
    if (typeof module.ensureProjectBrowserTab !== "function") return;
    expect(
      module.ensureProjectBrowserTab(
        [],
        "browser-1",
        "Clash docs",
        "https://clash.example/docs",
      ),
    ).toEqual([
      {
        id: "browser-1",
        title: "Clash docs",
        url: "https://clash.example/docs",
      },
    ]);
  });

  it("persists each project's browser tabs and active browser locally", async () => {
    const modulePath = "./projectBrowserTabs";
    const module = await import(/* @vite-ignore */ modulePath).catch(
      () => null,
    );
    expect(module).not.toBeNull();
    if (!module) return;

    expect(module.saveProjectBrowserSession).toBeTypeOf("function");
    expect(module.loadProjectBrowserSession).toBeTypeOf("function");
    if (
      typeof module.saveProjectBrowserSession !== "function" ||
      typeof module.loadProjectBrowserSession !== "function"
    ) {
      return;
    }

    module.saveProjectBrowserSession(localStorage, "project-1", {
      tabs: [
        {
          id: "browser-1",
          title: "Search results",
          url: "https://www.baidu.com/s?wd=clash",
        },
      ],
      activeBrowserId: "browser-1",
    });

    expect(module.loadProjectBrowserSession(localStorage, "project-1")).toEqual(
      {
        tabs: [
          {
            id: "browser-1",
            title: "Search results",
            url: "https://www.baidu.com/s?wd=clash",
          },
        ],
        activeBrowserId: "browser-1",
      },
    );
    expect(module.loadProjectBrowserSession(localStorage, "project-2")).toBeNull();
  });
});
