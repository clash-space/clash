// @vitest-environment jsdom
import type { ReactNode } from "react";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";

import { AppFeedbackProvider } from "./AppFeedback";
import SettingsClient from "./SettingsClient";

vi.mock("@clash/web-ui/hooks/useClashRuntime", () => ({
  useClashRuntime: () => ({
    runtimes: [],
    refresh: vi.fn(),
    promptQueueEnabled: true,
    setPromptQueueEnabled: vi.fn(),
  }),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    motion: new Proxy({}, {
      get: (_target, tag: string) => ({ children, ...props }: any) =>
        React.createElement(tag, props, children),
    }),
  };
});

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("configures BYOS and hides managed storage until the Host offers it", async () => {
  // Regression caught: showing the future free-storage mode in an unauthenticated build creates
  // an orphan control, while keeping configuration only in React state cannot help CLI or MCP.
  const publicConfig = {
    capability: "public-asset-storage",
    mode: "disabled",
    available: false,
    provider: null,
    account_id: null,
    endpoint: null,
    bucket: null,
    region: null,
    key_prefix: "clash-temporary",
    force_path_style: false,
    has_access_key_id: false,
    has_secret_access_key: false,
    has_session_token: false,
    managed: { available: false, authenticated: false },
  };
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/v1/local/public-storage/test")) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/api/v1/local/public-storage") && init?.method === "PATCH") {
      expect(JSON.parse(String(init.body))).toEqual({
        mode: "byos",
        provider: "r2",
        account_id: "account-123",
        endpoint: null,
        bucket: "clash-assets",
        region: "auto",
        key_prefix: "clash-temporary",
        force_path_style: false,
        access_key_id: "R2_ACCESS_KEY",
        secret_access_key: "R2_SECRET_KEY",
      });
      return new Response(JSON.stringify({
        ...publicConfig,
        mode: "byos",
        available: true,
        provider: "r2",
        account_id: "account-123",
        bucket: "clash-assets",
        region: "auto",
        has_access_key_id: true,
        has_secret_access_key: true,
      }), { headers: { "content-type": "application/json" } });
    }
    if (url.includes("/api/v1/local/public-storage")) {
      return new Response(JSON.stringify(publicConfig), {
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);

  render(
    <MemoryRouter>
      <AppFeedbackProvider>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"public-storage" as never}
          embedded
        />
      </AppFeedbackProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "Public storage" })).toBeTruthy();
  expect(screen.queryByRole("radio", { name: /Clash managed/i })).toBeNull();
  fireEvent.click(screen.getByRole("radio", { name: /Use my storage/i }));

  expect(screen.getByRole("combobox", { name: "Storage provider" }).textContent)
    .toContain("Cloudflare R2");
  fireEvent.change(screen.getByRole("textbox", { name: "Account ID" }), {
    target: { value: "account-123" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "Bucket" }), {
    target: { value: "clash-assets" },
  });
  fireEvent.change(screen.getByLabelText("Access key ID"), {
    target: { value: "R2_ACCESS_KEY" },
  });
  fireEvent.change(screen.getByLabelText("Secret access key"), {
    target: { value: "R2_SECRET_KEY" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save public storage" }));

  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(true);
  });
  fireEvent.click(screen.getByRole("button", { name: "Test public storage" }));
  await waitFor(() => {
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/test"))).toBe(true);
  });
});
