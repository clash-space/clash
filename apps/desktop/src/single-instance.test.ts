import { describe, expect, it, vi } from "vitest";

import { ownDesktopInstance } from "./single-instance";

describe("desktop single-instance ownership", () => {
  it("quits a duplicate process before it can open a stale renderer window", () => {
    const quit = vi.fn();
    const owned = ownDesktopInstance(
      {
        requestSingleInstanceLock: () => false,
        on: () => undefined,
        quit,
      },
      () => undefined,
    );

    expect(owned).toBe(false);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it("lets the owner recover its window when a second dev launch arrives", () => {
    let onSecondInstance: (() => void) | undefined;
    let recoverCount = 0;
    const owned = ownDesktopInstance(
      {
        requestSingleInstanceLock: () => true,
        on: (_event, listener) => {
          onSecondInstance = listener;
        },
        quit: () => undefined,
      },
      () => {
        recoverCount += 1;
      },
    );

    onSecondInstance?.();

    expect(owned).toBe(true);
    expect(recoverCount).toBe(1);
  });
});
