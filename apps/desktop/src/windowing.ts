import type { BrowserWindowConstructorOptions } from "electron";
import { desktopTrafficLightPosition } from "@clash/shared-runtime";

export interface TrackableWindow {
  id: number;
  on(event: "closed", listener: () => void): unknown;
}

export interface NativeWindowControls {
  setWindowButtonVisibility(visible: boolean): unknown;
}

export interface WindowRegistry<TWindow extends TrackableWindow> {
  register(window: TWindow): void;
  count(): number;
  all(): TWindow[];
}

const windowOffset = 28;
const initialWindowPosition = { x: 96, y: 48 };

export interface DesktopRecordingViewport {
  width: number;
  height: number;
}

export function parseDesktopRecordingViewport(
  value: string | undefined,
): DesktopRecordingViewport | undefined {
  if (value === undefined) return undefined;
  const match = /^(\d+)x(\d+)$/u.exec(value.trim());
  const width = match ? Number(match[1]) : Number.NaN;
  const height = match ? Number(match[2]) : Number.NaN;
  if (
    !Number.isSafeInteger(width) ||
    width < 960 ||
    !Number.isSafeInteger(height) ||
    height < 720
  ) {
    throw new Error(
      "desktop recording viewport must be WIDTHxHEIGHT and satisfy the native window minimum",
    );
  }
  return { width, height };
}

export function resolveDesktopWindowOptions(
  windowIndex: number,
  prefersDark = false,
  recordingViewport?: DesktopRecordingViewport,
): BrowserWindowConstructorOptions {
  const offset = windowIndex * windowOffset;

  return {
    width: recordingViewport?.width ?? 1440,
    height: recordingViewport?.height ?? 980,
    ...(recordingViewport
      ? {
          useContentSize: true,
          frame: false,
          enableLargerThanScreen: true,
        }
      : {
          frame: true,
          titleBarStyle: "hiddenInset",
          trafficLightPosition: desktopTrafficLightPosition,
        }),
    minWidth: 960,
    minHeight: 720,
    ...(recordingViewport
      ? {}
      : {
          x: initialWindowPosition.x + offset,
          y: initialWindowPosition.y + offset,
        }),
    title: "Clash",
    backgroundColor: prefersDark ? "#151515" : "#f7f6f2",
    show: false,
  };
}

export function createWindowRegistry<TWindow extends TrackableWindow>(): WindowRegistry<TWindow> {
  const windows = new Set<TWindow>();

  return {
    register(window) {
      windows.add(window);
      window.on("closed", () => {
        windows.delete(window);
      });
    },
    count() {
      return windows.size;
    },
    all() {
      return [...windows];
    },
  };
}

export function shouldCreateWindowOnActivate(openWindowCount: number): boolean {
  return openWindowCount === 0;
}

export function ensureNativeWindowControlsVisible(
  window: NativeWindowControls,
  platform = process.platform,
): void {
  if (platform === "darwin") {
    window.setWindowButtonVisibility(true);
  }
}
