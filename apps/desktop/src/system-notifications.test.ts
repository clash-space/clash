import { describe, expect, it, vi } from "vitest";

import {
  showDesktopSystemNotification,
  type DesktopNotificationAdapter,
} from "./system-notifications";

describe("showDesktopSystemNotification", () => {
  it("shows a native notification and focuses its source window when clicked", () => {
    let click: (() => void) | undefined;
    const show = vi.fn();
    const adapter: DesktopNotificationAdapter = {
      isSupported: () => true,
      create: (options) => {
        expect(options).toEqual({
          title: "Agent needs approval",
          body: "Run deployment command",
        });
        return {
          onClick: (listener) => {
            click = listener;
          },
          show,
        };
      },
    };
    const restore = vi.fn();
    const focus = vi.fn();

    expect(
      showDesktopSystemNotification(
        { title: "Agent needs approval", body: "Run deployment command" },
        {
          isDestroyed: () => false,
          isMinimized: () => true,
          restore,
          show: vi.fn(),
          focus,
        },
        adapter,
      ),
    ).toBe(true);

    expect(show).toHaveBeenCalledOnce();
    click?.();
    expect(restore).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });

  it("rejects malformed renderer payloads instead of passing them to Electron", () => {
    const create = vi.fn();
    const adapter: DesktopNotificationAdapter = {
      isSupported: () => true,
      create,
    };

    expect(
      showDesktopSystemNotification(
        { title: "", body: "missing title" },
        undefined,
        adapter,
      ),
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });
});
