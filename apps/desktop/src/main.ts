import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "electron";

import { configureDesktopHost } from "./controller/host";
import { createDesktopRuntimeController } from "./controller/runtime";
import { createDesktopWindowController } from "./controller/windows";
import { createDesktopLogger } from "./stdio-logger";

const moduleDir = dirname(fileURLToPath(import.meta.url));
const desktopLog = createDesktopLogger();
const { dataDir } = configureDesktopHost();
const runtimeController = createDesktopRuntimeController({
  moduleDir,
  log: desktopLog,
});
const windowController = createDesktopWindowController({
  moduleDir,
  dataDir,
  currentRuntime: runtimeController.current,
  log: desktopLog,
});

app.whenReady().then(async () => {
  windowController.registerHostBindings();
  await runtimeController.initialize(dataDir);
  await windowController.createWindow();
  app.on("activate", windowController.activate);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
