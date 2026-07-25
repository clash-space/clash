import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRuntime } from "./runtime";

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
  getNleAvailability: () => ipcRenderer.invoke("clash:get-nle-availability"),
  exportDirectorVideo: (request: unknown) => ipcRenderer.invoke("clash:export-director-video", request),
  openInNle: (request: unknown) => ipcRenderer.invoke("clash:open-in-nle", request),
});
