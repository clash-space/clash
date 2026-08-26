export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  on(event: "second-instance", listener: () => void): unknown;
  quit(): void;
}

export function ownDesktopInstance(
  app: SingleInstanceApp,
  recoverWindow: () => void,
): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return false;
  }
  app.on("second-instance", recoverWindow);
  return true;
}
