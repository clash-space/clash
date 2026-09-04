import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRuntime } from "./runtime";
import {
  PROJECT_BROWSER_OPEN_TAB_CHANNEL,
  type ProjectBrowserOpenTabRequest,
} from "./project-browser-events";

const runtimeConfig: DesktopRuntime = JSON.parse(
  process.env.CLASH_DESKTOP_RUNTIME ?? "{}",
) as DesktopRuntime;

contextBridge.exposeInMainWorld("__CLASH_RUNTIME_CONFIG__", {
  mode: runtimeConfig.mode,
  apiBaseUrl: runtimeConfig.apiBaseUrl,
  wsBaseUrl: runtimeConfig.wsBaseUrl,
  capabilities: runtimeConfig.capabilities,
});

contextBridge.exposeInMainWorld("__CLASH_DESKTOP__", {
  isDesktop: true,
  newWindow: () => ipcRenderer.invoke("clash:new-window"),
  onProjectBrowserOpenTab: (
    listener: (request: ProjectBrowserOpenTabRequest) => void,
  ) => {
    const handleOpenTab = (
      _event: Electron.IpcRendererEvent,
      request: ProjectBrowserOpenTabRequest,
    ) => listener(request);
    ipcRenderer.on(PROJECT_BROWSER_OPEN_TAB_CHANNEL, handleOpenTab);
    return () =>
      ipcRenderer.removeListener(PROJECT_BROWSER_OPEN_TAB_CHANNEL, handleOpenTab);
  },
  refreshRuntime: () => ipcRenderer.invoke("clash:refresh-runtime"),
  openExternal: (url: string) => ipcRenderer.invoke("clash:open-external", url),
  authorizeProvider: (request: unknown) => ipcRenderer.invoke("clash:authorize-provider", request),
  getNleAvailability: () => ipcRenderer.invoke("clash:get-nle-availability"),
  exportDirectorVideo: (request: unknown) => ipcRenderer.invoke("clash:export-director-video", request),
  openInNle: (request: unknown) => ipcRenderer.invoke("clash:open-in-nle", request),
});
