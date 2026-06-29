// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import UserControls from "./UserControls";

const authClientMock = vi.hoisted(() => ({
  useSession: vi.fn(),
  signOut: vi.fn(),
  signInSocial: vi.fn(),
}));

vi.mock("@clash/web-ui/lib/betterAuthClient", () => ({
  default: {
    useSession: authClientMock.useSession,
    signOut: authClientMock.signOut,
    signIn: {
      social: authClientMock.signInSocial,
    },
  },
}));

vi.mock("@clash/web-ui/hooks/useBillingBalance", () => ({
  useBillingBalance: () => ({ status: "unavailable" }),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({ children, ...props }: { children?: ReactNode }) =>
            React.createElement(tag, props, children),
      },
    ),
  };
});

function renderUserControls() {
  return render(
    <MemoryRouter>
      <UserControls />
    </MemoryRouter>,
  );
}

describe("UserControls", () => {
  afterEach(() => {
    cleanup();
    delete globalThis.__CLASH_RUNTIME_CONFIG__;
    authClientMock.useSession.mockReset();
    authClientMock.signOut.mockReset();
    authClientMock.signInSocial.mockReset();
  });

  it("renders only a Settings entry in the local desktop runtime", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = { mode: "desktop" };
    authClientMock.useSession.mockReturnValue({
      data: {
        user: {
          name: "Local User",
          image: null,
        },
      },
    });

    renderUserControls();

    const settings = screen.getByRole("link", { name: "Settings" });
    expect(settings.getAttribute("href")).toBe("/settings");
    expect(screen.queryByText("Local User")).toBeNull();
    expect(screen.queryByRole("button", { name: /Account menu/i })).toBeNull();
    expect(authClientMock.useSession).not.toHaveBeenCalled();
  });

  it("keeps the account menu in hosted mode", () => {
    authClientMock.useSession.mockReturnValue({
      data: {
        user: {
          name: "Local User",
          image: null,
        },
      },
    });

    renderUserControls();

    expect(screen.getByText("Local User")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Account menu.*Local User/i })).toBeTruthy();
    expect(authClientMock.useSession).toHaveBeenCalled();
  });
});
