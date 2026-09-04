import { beforeEach, describe, expect, it, vi } from "vitest";

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: vi.fn(),
    on: electron.on,
    removeListener: electron.removeListener,
  },
}));

describe("desktop preload project browser events", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets the renderer subscribe and unsubscribe from site-requested tabs", async () => {
    await import("./preload");
    const desktopBridge = electron.exposeInMainWorld.mock.calls.find(
      ([name]) => name === "__CLASH_DESKTOP__",
    )?.[1] as
      | {
          onProjectBrowserOpenTab?: (
            listener: (request: { url: string; disposition: string }) => void,
          ) => () => void;
        }
      | undefined;
    const listener = vi.fn();

    const unsubscribe = desktopBridge?.onProjectBrowserOpenTab?.(listener);

    expect(unsubscribe).toBeTypeOf("function");
    const ipcListener = electron.on.mock.calls.find(
      ([channel]) => channel === "clash:project-browser-open-tab",
    )?.[1] as
      | ((
          event: unknown,
          request: { url: string; disposition: string },
        ) => void)
      | undefined;
    expect(ipcListener).toBeTypeOf("function");
    ipcListener?.(
      {},
      {
        url: "https://app.example/redirected",
        disposition: "foreground-tab",
      },
    );
    expect(listener).toHaveBeenCalledWith({
      url: "https://app.example/redirected",
      disposition: "foreground-tab",
    });

    unsubscribe?.();
    expect(electron.removeListener).toHaveBeenCalledWith(
      "clash:project-browser-open-tab",
      ipcListener,
    );
  });
});
