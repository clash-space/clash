import { describe, expect, it, vi } from "vitest";
import {
  createWindowRegistry,
  ensureNativeWindowControlsVisible,
  parseDesktopRecordingViewport,
  resolveDesktopWindowOptions,
  shouldCreateWindowOnActivate,
} from "./windowing";

describe("desktop windowing", () => {
  it("uses an inline title bar with traffic lights centered in the desktop tab strip", () => {
    const options = resolveDesktopWindowOptions(0);

    expect(options).toMatchObject({
      width: 1440,
      height: 980,
      minWidth: 960,
      minHeight: 720,
      title: "Clash",
      frame: true,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: {
        x: 12,
        y: 12,
      },
    });
    expect(options).not.toHaveProperty("titleBarOverlay");
  });

  it("uses an exact native content surface only for an explicit recording viewport", () => {
    const viewport = parseDesktopRecordingViewport("1440x900");
    const options = resolveDesktopWindowOptions(0, false, viewport);

    expect(viewport).toEqual({ width: 1440, height: 900 });
    expect(options).toMatchObject({
      width: 1440,
      height: 900,
      useContentSize: true,
      frame: false,
      enableLargerThanScreen: true,
    });
    expect(options).not.toHaveProperty("titleBarStyle");
    expect(options).not.toHaveProperty("trafficLightPosition");
    expect(options).not.toHaveProperty("x");
    expect(options).not.toHaveProperty("y");
    expect(() => parseDesktopRecordingViewport("1440-by-900")).toThrow(
      /recording viewport/iu,
    );
  });

  it("offsets additional windows so multiple windows are visible", () => {
    const first = resolveDesktopWindowOptions(0);
    const second = resolveDesktopWindowOptions(1);

    expect(second.x).toBe((first.x ?? 0) + 28);
    expect(second.y).toBe((first.y ?? 0) + 28);
  });

  it("uses the operating-system theme for the hidden window background", () => {
    expect(resolveDesktopWindowOptions(0, false).backgroundColor).toBe("#f7f6f2");
    expect(resolveDesktopWindowOptions(0, true).backgroundColor).toBe("#151515");
  });

  it("tracks registered windows and removes them when closed", () => {
    const registry = createWindowRegistry();
    const listeners = new Map<string, () => void>();
    const window = {
      id: 7,
      on: vi.fn((event: string, listener: () => void) => {
        listeners.set(event, listener);
      }),
    };

    registry.register(window);

    expect(registry.count()).toBe(1);
    expect(registry.all()).toEqual([window]);

    listeners.get("closed")?.();

    expect(registry.count()).toBe(0);
    expect(registry.all()).toEqual([]);
  });

  it("creates a window on macOS activation only when no windows remain", () => {
    expect(shouldCreateWindowOnActivate(0)).toBe(true);
    expect(shouldCreateWindowOnActivate(2)).toBe(false);
  });

  it("keeps native macOS window controls visible in hidden title bar mode", () => {
    const window = {
      setWindowButtonVisibility: vi.fn(),
    };

    ensureNativeWindowControlsVisible(window, "darwin");

    expect(window.setWindowButtonVisibility).toHaveBeenCalledWith(true);
  });

  it("does not call macOS window control APIs on other platforms", () => {
    const window = {
      setWindowButtonVisibility: vi.fn(),
    };

    ensureNativeWindowControlsVisible(window, "linux");

    expect(window.setWindowButtonVisibility).not.toHaveBeenCalled();
  });
});
