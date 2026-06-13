// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatbotCopilot from "./ChatbotCopilot";
import type { Runtime, UseClashRuntimeReturn } from "@clash/web-ui/hooks/useClashRuntime";

const mocks = vi.hoisted(() => ({
  useClashRuntime: vi.fn(),
  useAgentCopilot: vi.fn(),
}));

vi.mock("@clash/web-ui/hooks/useClashRuntime", () => ({
  useClashRuntime: mocks.useClashRuntime,
}));

vi.mock("@clash/web-ui/hooks/useAgentCopilot", () => ({
  useAgentCopilot: mocks.useAgentCopilot,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "copilot.panel.label") return "AI Copilot";
      if (key === "copilot.panel.collapse") return "Collapse AI Copilot";
      if (key === "copilot.header.newSession") return "New session";
      if (key === "copilot.header.history") return "Session history";
      if (key === "copilot.header.runOn") return "Run on (Cloud / local runtime)";
      if (key === "copilot.runtime.menuTitle") return "Run on";
      if (key === "copilot.runtime.cloud.label") return "Cloud Agent";
      if (key === "copilot.runtime.cloud.sub") return "Coming soon";
      if (key === "copilot.runtime.machinesHeader") return "My machines";
      if (key === "copilot.runtime.machineSub_online") return `online · ${values?.count ?? 0} agent`;
      if (key === "copilot.runtime.addMachine.label") return "Connect daemon...";
      if (key === "copilot.runtime.addMachine.sub") return "Install or reconnect a persistent local runtime";
      if (key === "copilot.status.connecting") return "Connecting to runtime...";
      if (key === "copilot.status.streaming") return "Streaming";
      if (key === "copilot.status.thinking") return "Thinking";
      if (key === "copilot.status.desktopLocalStarting") return "Connecting to the local agent on this Mac...";
      if (key === "copilot.status.desktopLocalRequired") return "Start the local agent on this Mac.";
      if (key === "copilot.status.localAgentReady") return "Local agent connected. Send a message to start.";
      if (key === "copilot.status.localRuntimeRequired") return "Select or connect a local runtime to chat. Cloud Agent is coming soon.";
      if (key === "copilot.status.desktopLocalSetupRequired") return "Local agent needs setup on this Mac.";
      if (key === "copilot.errors.warningPrefix") return "Warning";
      return key;
    },
  }),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const filteredMotionProps = new Set([
    "animate",
    "exit",
    "initial",
    "layoutId",
    "transition",
    "whileHover",
    "whileTap",
  ]);
  const createMotionComponent = (tag: string) =>
    React.forwardRef<HTMLElement, { children?: ReactNode } & Record<string, unknown>>(
      ({ children, ...props }, ref) => {
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(props)) {
          if (!filteredMotionProps.has(key)) next[key] = value;
        }
        return React.createElement(tag, { ...next, ref }, children);
      },
    );
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    MotionConfig: ({ children }: { children?: ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) => createMotionComponent(tag),
      },
    ),
  };
});

vi.mock("@clash/web-ui/lib/hooks/useMediaQuery", () => ({
  useIsBelowLg: () => false,
}));

vi.mock("./copilot/ChatInput", () => ({
  ChatInput: ({ error, disabled }: { error?: string | null; disabled?: boolean }) => (
    <div data-testid="chat-input" data-disabled={disabled ? "true" : "false"}>
      {error ? <div role="alert">{error}</div> : null}
    </div>
  ),
}));

const desktopLocalRuntime: Runtime = {
  id: "desktop-local",
  machine_id: "desktop-local",
  hostname: "BoAi's MacBook",
  os: "darwin",
  agents: [{ id: "codex-cli", binary: "codex" }],
  version: "desktop",
  status: "online",
  last_heartbeat: 1,
  created_at: 1,
};

function runtimeState(overrides: Partial<UseClashRuntimeReturn> = {}): UseClashRuntimeReturn {
  return {
    runtimes: [desktopLocalRuntime],
    selectedRuntimeId: null,
    selectedAgentId: null,
    sessionId: null,
    status: "idle",
    errorMessage: null,
    messages: [],
    availableCommands: [],
    ready: false,
    refresh: vi.fn(),
    select: vi.fn().mockResolvedValue(undefined),
    loadResumeOptions: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    cancel: vi.fn(),
    shutdown: vi.fn(),
    ...overrides,
  };
}

function cloudState(overrides: Record<string, unknown> = {}) {
  return {
    messages: [],
    sendMessage: vi.fn(),
    stop: vi.fn(),
    status: "ready",
    clearHistory: vi.fn(),
    connected: false,
    connectionError: null,
    lastFailedMessage: null,
    clearConnectionError: vi.fn(),
    customEvents: [],
    clearCustomEvents: vi.fn(),
    queueMessageOnOpen: vi.fn(),
    ...overrides,
  };
}

function renderDesktopCopilot() {
  return render(
    <ChatbotCopilot
      projectId="project-one"
      threadId="thread-one"
      initialMessages={[]}
      width={420}
      onWidthChange={() => undefined}
      isCollapsed={false}
      onCollapseChange={() => undefined}
    />,
  );
}

describe("ChatbotCopilot desktop local mode", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
  });

  it("auto-starts the current desktop runtime and keeps web/cloud routing out of the header", async () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = { mode: "desktop" };
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserver() {
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
        };
      }),
    );
    Element.prototype.scrollIntoView = vi.fn();
    const select = vi.fn().mockResolvedValue(undefined);
    mocks.useClashRuntime.mockReturnValue(runtimeState({ select }));
    mocks.useAgentCopilot.mockReturnValue(cloudState({ connectionError: "Authentication required" }));

    renderDesktopCopilot();

    await waitFor(() => {
      expect(select).toHaveBeenCalledWith("desktop-local", "director", {
        projectId: "project-one",
        agentId: "codex-cli",
      });
    });

    expect(mocks.useAgentCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(screen.queryByRole("button", { name: "Run on (Cloud / local runtime)" })).toBeNull();
    expect(screen.queryByText("Cloud Agent")).toBeNull();
    expect(screen.queryByText("Authentication required")).toBeNull();
  });

  it("does not render local ACP authentication failures as red Clash auth errors", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = { mode: "desktop" };
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserver() {
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
        };
      }),
    );
    Element.prototype.scrollIntoView = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-cli",
      status: "error",
      errorMessage: "Authentication required",
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.queryByText(/Authentication required/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Local agent needs setup on this Mac.")).toBeTruthy();
  });

  it("keeps desktop local startup to one icon-only loading state", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = { mode: "desktop" };
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserver() {
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
        };
      }),
    );
    Element.prototype.scrollIntoView = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-cli",
      status: "connecting",
      ready: false,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState({ status: "streaming" }));

    const { container } = renderDesktopCopilot();

    expect(screen.getByRole("status", { name: "Connecting to the local agent on this Mac..." })).toBeTruthy();
    expect(container.textContent).not.toContain("Connecting to runtime...");
    expect(container.textContent).not.toContain("Connecting to the local agent on this Mac...");
    expect(container.textContent).not.toContain("Streaming");
  });
});
