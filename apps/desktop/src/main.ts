import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { app } from "electron";

import { configureDesktopHost } from "./controller/host";
import { createDesktopRuntimeController } from "./controller/runtime";
import { createDesktopWindowController } from "./controller/windows";
import { ownDesktopInstance } from "./single-instance";
import { createDesktopFileLogSink, createDesktopLogger } from "./stdio-logger";

const moduleDir = dirname(fileURLToPath(import.meta.url));
let recoverOwnedWindow = () => undefined;
const ownsDesktopInstance = ownDesktopInstance(app, () => recoverOwnedWindow());

if (ownsDesktopInstance) {
  const { dataDir } = configureDesktopHost();
  const fileSink = createDesktopFileLogSink({
    directory: app.getPath("logs"),
    maxBytes: 5 * 1024 * 1024,
    maxFiles: 5,
  });
  const desktopLog = createDesktopLogger(process.stdout, process.stderr, {
    fileSink,
  });
  app.on("will-quit", () => desktopLog.close());
  const runtimeController = createDesktopRuntimeController({
    moduleDir,
    log: desktopLog,
  });
  const windowController = createDesktopWindowController({
    moduleDir,
    dataDir,
    currentRuntime: runtimeController.current,
    refreshRuntime: () => runtimeController.initialize(dataDir),
    log: desktopLog,
  });
  recoverOwnedWindow = () => {
    void app
      .whenReady()
      .then(() => windowController.recoverWindow())
      .catch((error) =>
        desktopLog.error("[desktop] failed to recover window", error),
      );
  };

  app.whenReady().then(async () => {
    windowController.registerHostBindings();
    await runtimeController.initialize(dataDir);
    await windowController.createWindow();
    app.on("activate", windowController.activate);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
