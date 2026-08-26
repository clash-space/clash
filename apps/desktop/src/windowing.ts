import type { BrowserWindowConstructorOptions } from "electron";
import { desktopTrafficLightPosition } from "@clash/shared-runtime";

export interface TrackableWindow {
  id: number;
  on(event: "closed", listener: () => void): unknown;
}

export interface NativeWindowControls {
  setWindowButtonVisibility(visible: boolean): unknown;
}

export interface RecoverableDesktopWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  loadURL(url: string): Promise<unknown>;
  restore(): unknown;
  show(): unknown;
  focus(): unknown;
}

export interface WindowRegistry<TWindow extends TrackableWindow> {
  register(window: TWindow): void;
  count(): number;
  all(): TWindow[];
}

const windowOffset = 28;
const initialWindowPosition = { x: 96, y: 48 };

export function resolveDesktopWebPreferences(
  preload: string,
): NonNullable<BrowserWindowConstructorOptions["webPreferences"]> {
  return {
    preload,
    contextIsolation: true,
    nodeIntegration: false,
    backgroundThrottling: false,
    sandbox: false,
    webviewTag: true,
    additionalArguments: [],
  };
}

export function resolveDesktopWindowOptions(
  windowIndex: number,
  prefersDark = false,
): BrowserWindowConstructorOptions {
  const offset = windowIndex * windowOffset;

  return {
    width: 1440,
    height: 980,
    minWidth: 960,
    minHeight: 720,
    x: initialWindowPosition.x + offset,
    y: initialWindowPosition.y + offset,
    title: "Clash",
    frame: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: desktopTrafficLightPosition,
    backgroundColor: prefersDark ? "#151515" : "#f7f6f2",
    show: false,
  };
}

export function createWindowRegistry<
  TWindow extends TrackableWindow,
>(): WindowRegistry<TWindow> {
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

export async function recoverDesktopWindow(
  window: RecoverableDesktopWindow,
  url: string,
): Promise<void> {
  if (window.isDestroyed()) return;
  await window.loadURL(url);
  if (window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

export function ensureNativeWindowControlsVisible(
  window: NativeWindowControls,
  platform = process.platform,
): void {
  if (platform === "darwin") {
    window.setWindowButtonVisibility(true);
  }
}
