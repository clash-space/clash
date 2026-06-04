import { contextBridge, ipcRenderer } from "electron";
import type { DesktopRuntime } from "./runtime";

const runtimeConfig: DesktopRuntime = JSON.parse(
  process.env.CLASH_DESKTOP_RUNTIME ?? "{}",
) as DesktopRuntime;

contextBridge.exposeInMainWorld("__CLASH_RUNTIME_CONFIG__", {
  apiBaseUrl: runtimeConfig.apiBaseUrl,
  wsBaseUrl: runtimeConfig.wsBaseUrl,
});

contextBridge.exposeInMainWorld("__CLASH_DESKTOP__", {
  isDesktop: true,
  newWindow: () => ipcRenderer.invoke("clash:new-window"),
});
