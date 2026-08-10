import { describe, expect, it, vi } from "vitest";

import {
  authorizeProviderInWindow,
  isProviderOAuthCallbackUrl,
  type ProviderOAuthBrowserWindow,
} from "./provider-oauth-window";

function oauthWindowHarness() {
  const navigationListeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
  let closedListener: (() => void) | undefined;
  const window: ProviderOAuthBrowserWindow = {
    webContents: {
      on: vi.fn((event, listener) => {
        navigationListeners.set(event, listener);
      }),
      off: vi.fn((event) => {
        navigationListeners.delete(event);
      }),
    },
    once: vi.fn((_event, listener) => {
      closedListener = listener;
    }),
    loadURL: vi.fn(async () => undefined),
    isDestroyed: vi.fn(() => false),
    destroy: vi.fn(),
  };
  return { window, navigationListeners, close: () => closedListener?.() };
}

describe("desktop plugin Provider OAuth window", () => {
  it("captures the declared custom-scheme callback and returns its complete URL", async () => {
    const harness = oauthWindowHarness();
    const authorization = authorizeProviderInWindow(harness.window, {
      verificationUri: "https://hub.minimax.io/login",
      callbackScheme: "minimax-hub",
    });
    const preventDefault = vi.fn();

    harness.navigationListeners.get("will-redirect")?.(
      { preventDefault },
      "minimax-hub://auth-callback?accessToken=hub-token&account=primary",
    );

    await expect(authorization).resolves.toEqual({
      cancelled: false,
      callbackUrl: "minimax-hub://auth-callback?accessToken=hub-token&account=primary",
    });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(harness.window.destroy).toHaveBeenCalledOnce();
  });

  it("matches only the exact declared callback scheme", () => {
    expect(isProviderOAuthCallbackUrl("minimax-hub://auth-callback?accessToken=ok", "minimax-hub")).toBe(true);
    expect(isProviderOAuthCallbackUrl("minimax-hub.evil://auth-callback?accessToken=no", "minimax-hub")).toBe(false);
    expect(isProviderOAuthCallbackUrl("not a URL", "minimax-hub")).toBe(false);
  });

  it("returns a cancelled result when the user closes the authorization window", async () => {
    const harness = oauthWindowHarness();
    const authorization = authorizeProviderInWindow(harness.window, {
      verificationUri: "https://hub.minimax.io/login",
      callbackScheme: "minimax-hub",
    });

    harness.close();

    await expect(authorization).resolves.toEqual({ cancelled: true });
  });
});
