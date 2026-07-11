// @vitest-environment jsdom
import type { ComponentProps, ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import ChatbotCopilot from "./ChatbotCopilot";
import { AppFeedbackProvider } from "./AppFeedback";
import type { Runtime, UseClashRuntimeReturn } from "@clash/web-ui/hooks/useClashRuntime";
import type { ByoMessage } from "@clash/web-ui/lib/acpEvents";

const mocks = vi.hoisted(() => ({
  useClashRuntime: vi.fn(),
  useAgentCopilot: vi.fn(),
  AcpMessageList: vi.fn(),
}));

vi.mock("@clash/web-ui/hooks/useClashRuntime", () => ({
  useClashRuntime: mocks.useClashRuntime,
}));

vi.mock("@clash/web-ui/hooks/useAgentCopilot", () => ({
  useAgentCopilot: mocks.useAgentCopilot,
}));

vi.mock("./copilot/AcpMessageList", () => ({
  AcpProgressPanel: ({ className }: { className?: string }) => (
    <div data-testid="acp-progress-panel" className={className} />
  ),
  AcpMessageList: (props: { messages: unknown[] }) => {
    mocks.AcpMessageList(props);
    return <div data-testid="acp-message-list">ACP messages: {props.messages.length}</div>;
  },
  getAcpGlobalState: () => ({ planEntries: [] }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === "copilot.panel.label") return "AI Copilot";
      if (key === "copilot.panel.collapse") return "Collapse AI Copilot";
      if (key === "copilot.header.newSession") return "New session";
      if (key === "copilot.header.newChat") return "New chat";
      if (key === "copilot.header.history") return "Session history";
      if (key === "copilot.history.title") return "Session history";
      if (key === "copilot.history.empty") return "No history yet";
      if (key === "copilot.history.delete") return "Delete session";
      if (key === "copilot.history.fallbackTitle") return `Session ${values?.index ?? ""}`;
      if (key === "copilot.header.runOn") return "Run on (Cloud / local runtime)";
      if (key === "copilot.sessionConfig.label") return "Session runtime, harness, and model";
      if (key === "copilot.sessionConfig.runtime") return "Runtime";
      if (key === "copilot.sessionConfig.harness") return "Harness";
      if (key === "copilot.sessionConfig.model") return "Model";
      if (key === "copilot.sessionConfig.local") return "Local";
      if (key === "copilot.sessionConfig.cloud") return "Cloud";
      if (key === "copilot.sessionConfig.cloudSoon") return "Coming soon";
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
      if (key === "copilot.status.reconnecting") return `Reconnecting ${values?.attempt ?? 0}/${values?.maxAttempts ?? 0}`;
      if (key === "copilot.status.switchingTransport") return "Switching transport";
      if (key === "copilot.status.workedForSeconds") return `Worked for ${values?.count ?? 0}s`;
      if (key === "copilot.status.workedForMinutes") return `Worked for ${values?.count ?? 0}m`;
      if (key === "copilot.status.creativeThinking") return ["Letting it simmer"];
      if (key === "copilot.status.creativeStreaming") return ["Putting it into words"];
      if (key === "copilot.status.readyWhenYouAre") return "Ready when you are";
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
        return React.createElement(tag, { ...next, ref } as React.HTMLAttributes<HTMLElement>, children as ReactNode);
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
  ChatInput: ({ input, onInputChange, error, disabled, isProcessing, onSubmit, toolbarAccessory, rightToolbarAccessory }: { input: string; onInputChange?: (value: string) => void; error?: string | null; disabled?: boolean; isProcessing?: boolean; onSubmit?: (text: string, attachments: []) => void; toolbarAccessory?: ReactNode; rightToolbarAccessory?: ReactNode }) => (
    <div data-testid="chat-input" data-disabled={disabled ? "true" : "false"} data-processing={isProcessing ? "true" : "false"}>
      {toolbarAccessory}
      {rightToolbarAccessory}
      <input
        aria-label="chat draft"
        value={input}
        onChange={(event) => onInputChange?.(event.currentTarget.value)}
      />
      <button type="button" data-testid="submit-chat-input" onClick={() => onSubmit?.(input || "这个是?", [])}>submit</button>
      {error ? <div role="alert">{error}</div> : null}
    </div>
  ),
}));

const codexSessionModes = {
  currentModeId: "codex:review",
  availableModes: [
    { id: "codex:review", name: "Review", description: "Ask before applying changes" },
    { id: "codex:full-access", name: "Full access", description: "Codex can edit and run tools" },
  ],
};

const desktopLocalRuntime: Runtime = {
  id: "desktop-local",
  machine_id: "desktop-local",
  hostname: "BoAi's MacBook",
  os: "darwin",
  agents: [{ id: "codex-acp", binary: "codex-acp", session_modes: codexSessionModes }],
  version: "desktop",
  status: "online",
  last_heartbeat: 1,
  created_at: 1,
};

const codexAcpConfigOptions = [
  {
    id: "model",
    name: "Model",
    type: "select",
    category: "model",
    currentValue: "gpt-5.5",
    options: [
      { value: "gpt-5.5", name: "GPT-5.5", description: "Codex conversational model" },
      { value: "gpt-5.4", name: "GPT-5.4", description: "Compatibility profile" },
    ],
  },
  {
    id: "thought_level",
    name: "Thinking effort",
    type: "select",
    category: "thought_level",
    currentValue: "low",
    options: [
      { value: "low", name: "Low" },
      { value: "medium", name: "Medium" },
      { value: "high", name: "High" },
    ],
  },
] as const;

function runtimeState(overrides: Partial<UseClashRuntimeReturn> = {}): UseClashRuntimeReturn {
  return {
    runtimes: [desktopLocalRuntime],
    selectedRuntimeId: null,
    selectedAgentId: null,
    sessionId: null,
    currentSession: null,
    status: "idle",
    errorMessage: null,
    messages: [],
    availableCommands: [],
    sessionConfigOptions: [],
    transientStatus: null,
    diagnostics: [],
    ready: false,
    sessionModes: null,
    refresh: vi.fn(),
    startDraft: vi.fn(),
    select: vi.fn().mockResolvedValue(undefined),
    attachSession: vi.fn().mockResolvedValue(undefined),
    loadResumeOptions: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    promptQueue: [],
    promptQueueEnabled: true,
    promptQueueMode: "single",
    setPromptQueueEnabled: vi.fn(),
    setPromptQueueMode: vi.fn(),
    steerQueuedPrompt: vi.fn(),
    updateQueuedPrompt: vi.fn(),
    removeQueuedPrompt: vi.fn(),
    reorderPromptQueue: vi.fn(),
    clearPromptQueue: vi.fn(),
    setConfigOption: vi.fn(),
    setSessionMode: vi.fn(),
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

function renderDesktopCopilot(props: Partial<ComponentProps<typeof ChatbotCopilot>> = {}) {
  return render(
    <ChatbotCopilot
      projectId="project-one"
      threadId="thread-one"
      initialMessages={[]}
      width={420}
      onWidthChange={() => undefined}
      isCollapsed={false}
      onCollapseChange={() => undefined}
      {...props}
    />,
  );
}

function renderDesktopCopilotWithFeedback(props: Partial<ComponentProps<typeof ChatbotCopilot>> = {}) {
  return render(
    <MemoryRouter>
      <AppFeedbackProvider>
        <ChatbotCopilot
          projectId="project-one"
          threadId="thread-one"
          initialMessages={[]}
          width={420}
          onWidthChange={() => undefined}
          isCollapsed={false}
          onCollapseChange={() => undefined}
          {...props}
        />
      </AppFeedbackProvider>
    </MemoryRouter>,
  );
}

function openSessionHistoryMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Session history" }));
}

describe("ChatbotCopilot desktop local mode", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
    window.sessionStorage.clear();
  });

  it("prepares the current desktop runtime as a draft and keeps web/cloud routing out of the header", async () => {
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
    const startDraft = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({ select, startDraft }));
    mocks.useAgentCopilot.mockReturnValue(cloudState({ connectionError: "Authentication required" }));

    const { container } = renderDesktopCopilot();

    await waitFor(() => {
      expect(startDraft).toHaveBeenCalledWith("desktop-local", undefined, {
        projectId: "project-one",
        agentId: "codex-acp",
        permissionModeId: "codex:review",
      });
    });
    expect(select).not.toHaveBeenCalled();

    expect(mocks.useAgentCopilot).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
    expect(screen.queryByRole("button", { name: "Run on (Cloud / local runtime)" })).toBeNull();
    expect(screen.queryByText("Cloud Agent")).toBeNull();
    expect(screen.queryByText("Authentication required")).toBeNull();
  });

  it("renders the composer midpoint fade without blocking the composer", () => {
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
    const sendMessage = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
      sendMessage,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilotWithFeedback();

    const fade = screen.getByTestId("composer-bottom-fade");
    expect(fade.getAttribute("aria-hidden")).toBe("true");
    expect(fade.className).toContain("clash-copilot-composer-bottom-fade");

    fireEvent.click(screen.getByTestId("submit-chat-input"));

    expect(sendMessage).toHaveBeenCalledWith("这个是?");
  });

  it("blocks chat submission when the selected harness needs auth and exposes auth actions", async () => {
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
    const startDraft = vi.fn();
    const sendMessage = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ harnesses: [] }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [{
          id: "gemini",
          binary: "gemini",
          auth: {
            status: "needs-auth",
            message: "Gemini has old accounts but no active auth method for ACP.",
            command: "gemini",
          },
        }],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "gemini",
      status: "idle",
      ready: false,
      startDraft,
      sendMessage,
      refresh,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilotWithFeedback();

    expect(screen.getByText("Sign in to Gemini")).toBeTruthy();
    expect(screen.getByText("Gemini has old accounts but no active auth method for ACP.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();

    fireEvent.click(screen.getByTestId("submit-chat-input"));

    expect(startDraft).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledWith({ probe: "config", refresh: true }));

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/gemini/authenticate"),
      expect.objectContaining({ method: "POST" }),
    ));
  });

  it("shows local harness sign-in launch failures as non-blocking global feedback", async () => {
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
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    HTMLElement.prototype.setPointerCapture = vi.fn();
    HTMLElement.prototype.releasePointerCapture = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/harnesses/gemini/authenticate") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "Login canceled" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ harnesses: [] }), {
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [{
          id: "gemini",
          label: "Gemini",
          binary: "gemini",
          auth: {
            status: "needs-auth",
            message: "Gemini has old accounts but no active auth method for ACP.",
            command: "gemini",
          },
        }],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "gemini",
      status: "idle",
      ready: false,
      refresh,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilotWithFeedback();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/gemini/authenticate"),
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.getByText("Could not start Gemini sign in")).toBeTruthy());
    expect(screen.getByText("Could not start Gemini sign in")).toBeTruthy();
    expect(screen.getByText("Login canceled")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Could not start Gemini sign in" })).toBeNull();
  });

  it("does not start a session when selecting a Devin harness that still needs auth before a session exists", async () => {
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
    const startDraft = vi.fn();
    const refresh = vi.fn().mockResolvedValue(undefined);
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          { id: "cursor", label: "Cursor", binary: "clash-acp-cursor" },
          {
            id: "devin",
            label: "Devin",
            binary: "clash-acp-devin",
            auth: {
              status: "needs-auth",
              message: "Devin is not signed in for ACP.",
              command: "clash-acp-devin auth login",
            },
          },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "cursor",
      status: "draft",
      ready: false,
      select,
      startDraft,
      refresh,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilotWithFeedback();

    const trigger = screen.getByRole("combobox", { name: "Session runtime, harness, and model" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Devin/ }));

    await waitFor(() => expect(screen.getByText("Sign in to Devin")).toBeTruthy());
    expect(screen.getByText("Devin is not signed in for ACP.")).toBeTruthy();
    expect(select).not.toHaveBeenCalled();
    expect(startDraft).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });
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
      selectedAgentId: "codex-acp",
      status: "error",
      errorMessage: "Authentication required",
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    expect(screen.queryByText(/Authentication required/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Local agent needs setup on this Mac.")).toBeNull();
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
      selectedAgentId: "codex-acp",
      status: "connecting",
      ready: false,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState({ status: "streaming" }));

    const { container } = renderDesktopCopilot();

    expect(screen.getByRole("status", { name: "Connecting to the local agent on this Mac..." })).toBeTruthy();
    expect(screen.getByTestId("chat-input").getAttribute("data-processing")).toBe("false");
    expect(container.textContent).not.toContain("Connecting to runtime...");
    expect(container.textContent).not.toContain("Connecting to the local agent on this Mac...");
    expect(container.textContent).not.toContain("Streaming");
  });

  it("does not flash a missing-agent sentence before desktop runtimes load", () => {
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
      runtimes: [],
      selectedRuntimeId: null,
      selectedAgentId: null,
      status: "idle",
      ready: false,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    expect(screen.getByRole("status", { name: "Connecting to the local agent on this Mac..." })).toBeTruthy();
    expect(container.textContent).not.toContain("Start the local agent on this Mac.");
  });

  it("does not show a desktop local ready empty-state sentence", () => {
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
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    expect(container.textContent).not.toContain("Local agent connected. Send a message to start.");
  });

  it("shows runtime retry diagnostics beside the agent avatar instead of an empty state", () => {
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
      selectedAgentId: "codex-acp",
      status: "sending",
      ready: true,
      transientStatus: {
        kind: "reconnecting",
        message: "Reconnecting... 2/5",
        detail: "request timed out",
        attempt: 2,
        maxAttempts: 5,
      },
      diagnostics: [{
        stream: "stderr",
        severity: "warning",
        raw: "Falling back from WebSockets to HTTPS transport. request timed out",
        message: "Reconnecting... 2/5",
        transientStatus: {
          status: "reconnecting",
          message: "Reconnecting... 2/5",
          detail: "request timed out",
          attempt: 2,
          maxAttempts: 5,
        },
      }],
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    expect(screen.getByRole("status", { name: "Reconnecting 2/5 · request timed out" })).toBeTruthy();
    expect(container.textContent).not.toContain("Local agent connected. Send a message to start.");
  });

  it("keeps the runtime composer sendable while a turn is running so messages can enter the prompt queue", () => {
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
    const sendMessage = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "sending",
      ready: true,
      sendMessage,
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hi" }] },
      ],
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilotWithFeedback();

    expect(screen.getByTestId("chat-input").getAttribute("data-processing")).toBe("true");
    fireEvent.click(screen.getByTestId("submit-chat-input"));

    expect(sendMessage).toHaveBeenCalledWith("这个是?");
  });

  it("does not render per-message steer actions in the transcript", () => {
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
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "try this angle" }] },
      ],
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.queryByRole("button", { name: "Steer this message" })).toBeNull();
    expect(screen.queryByText("Steer")).toBeNull();
  });

  it("shows the floating runtime prompt queue without a separate header row", () => {
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
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      promptQueue: [
        { id: "q1", turnId: "t1", text: "one", createdAt: 1 },
        { id: "q2", turnId: "t2", text: "two", createdAt: 2 },
      ],
      promptQueueMode: "single",
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.getByText("one")).toBeTruthy();
    expect(screen.getByText("two")).toBeTruthy();
    expect(screen.queryByText("2 queued")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send one after this turn" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear queued messages" })).toBeNull();
  });

  it("renders queued prompt items with per-item steer controls in the queue bar", () => {
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
    const steerQueuedPrompt = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      promptQueue: [
        { id: "q1", turnId: "t1", text: "try this angle", createdAt: 1 },
        { id: "q2", turnId: "t2", text: "tighten the ending", createdAt: 2 },
      ],
      promptQueueMode: "single",
      steerQueuedPrompt,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.getByText("try this angle")).toBeTruthy();
    expect(screen.getByText("tighten the ending")).toBeTruthy();
    const steerButtons = screen.getAllByRole("button", { name: /^Steer queued message/ });
    expect(steerButtons).toHaveLength(2);
    fireEvent.click(steerButtons[0]);

    expect(steerQueuedPrompt).toHaveBeenCalledWith("t1");
  });

  it("does not render a queued prompt again after its user message is already visible", () => {
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
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [
        { id: "user-t1", role: "user", parts: [{ type: "text", text: "already sent" }] },
      ],
      promptQueue: [
        { id: "q1", turnId: "t1", text: "already sent", createdAt: 1 },
        { id: "q2", turnId: "t2", text: "still queued", createdAt: 2 },
      ],
      promptQueueMode: "single",
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.getAllByText("already sent")).toHaveLength(1);
    expect(screen.getByText("still queued")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Steer queued message/ })).toHaveLength(1);
  });

  it("edits and removes queued prompt items from the floating queue card", () => {
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
    const updateQueuedPrompt = vi.fn();
    const removeQueuedPrompt = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      promptQueue: [
        { id: "q1", turnId: "t1", text: "draft this line", createdAt: 1 },
      ],
      updateQueuedPrompt,
      removeQueuedPrompt,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    fireEvent.pointerDown(screen.getByRole("button", { name: "Queued message options 1" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Edit message" }));
    expect((screen.getByLabelText("chat draft") as HTMLInputElement).value).toBe("draft this line");

    fireEvent.change(screen.getByLabelText("chat draft"), { target: { value: "updated line" } });
    fireEvent.click(screen.getByTestId("submit-chat-input"));
    expect(updateQueuedPrompt).toHaveBeenCalledWith("t1", "updated line");

    fireEvent.click(screen.getByRole("button", { name: "Remove queued message 1" }));
    expect(removeQueuedPrompt).toHaveBeenCalledWith("t1");
  });

  it("hides the runtime prompt queue bar when queueing is disabled", () => {
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
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      promptQueueEnabled: false,
      promptQueue: [
        { id: "q1", turnId: "t1", text: "hidden pending input", createdAt: 1 },
      ],
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.queryByText("1 queued")).toBeNull();
    expect(screen.queryByText("hidden pending input")).toBeNull();
  });

  it("uses the active session title in the desktop header", () => {
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
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot({
      sessionHistory: [{ threadId: "thread-one", title: "Storyboard beat pass", type: "cloud" }],
    });

    const headerTitle = container.querySelector(".clash-copilot-panel-header .font-display");
    expect(headerTitle?.textContent).toBe("Storyboard beat pass");
  });

  it("labels an empty desktop draft as a new chat", () => {
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
      selectedAgentId: "codex-acp",
      status: "draft",
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot({ sessionHistory: [] });

    const headerTitle = container.querySelector(".clash-copilot-panel-header .font-display");
    expect(headerTitle?.textContent).toBe("New chat");
  });

  it("allows runtime sessions to be deleted from history", () => {
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
    const onDeleteSession = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot({
      onDeleteSession,
      sessionHistory: [{
        threadId: "runtime-session-one",
        title: "Run pwd",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
      }],
    });

    openSessionHistoryMenu();
    const historyItem = screen.getByRole("menuitem", { name: /Run pwd/ });
    expect(historyItem.querySelector("svg")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete session" }));

    expect(onDeleteSession).toHaveBeenCalledWith("runtime-session-one");
  });

  it("renders session history through the shared dropdown menu", () => {
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
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot({
      sessionHistory: [{
        threadId: "runtime-session-one",
        title: "Run pwd",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
      }],
    });

    openSessionHistoryMenu();

    const historyMenu = screen.getByRole("menu", { name: "Session history" });
    expect(historyMenu.getAttribute("data-side")).toBe("bottom");
    expect(historyMenu.getAttribute("data-align")).toBe("end");
    expect(screen.getByRole("menuitem", { name: /Run pwd/ })).toBeTruthy();
  });

  it("surfaces restored desktop runtime messages in session history", () => {
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
    const restoredMessages: ByoMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "Run pwd" }] },
      { id: "asst-1", role: "assistant", parts: [{ type: "text", text: "Done." }] },
    ];
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "local-session-restored",
      currentSession: {
        id: "local-session-restored",
        threadId: "local-session-restored",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        status: "active",
      },
      status: "connected",
      ready: true,
      messages: restoredMessages,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot({ sessionHistory: [] });

    const headerTitle = container.querySelector(".clash-copilot-panel-header .font-display");
    expect(headerTitle?.textContent).toBe("Run pwd");

    openSessionHistoryMenu();

    const historyMenu = screen.getByRole("menu", { name: "Session history" });
    expect(within(historyMenu).queryByText("Session history")).toBeNull();
    expect(screen.queryByText("No history yet")).toBeNull();
    expect(screen.getAllByText("Run pwd").length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Delete session" })).toBeNull();
  });

  it("attaches a runtime history item and syncs the visible harness", () => {
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
    const attachSession = vi.fn().mockResolvedValue(undefined);
    const onSwitchSession = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          { id: "codex-acp", binary: "codex-acp" },
          { id: "cursor", label: "Cursor", binary: "clash-acp-cursor" },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
      attachSession,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot({
      onSwitchSession,
      sessionHistory: [{
        threadId: "local-session-old",
        type: "runtime",
        title: "Run pwd",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "cursor",
        status: "active",
      }],
    });

    openSessionHistoryMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Run pwd/ }));

    expect(onSwitchSession).not.toHaveBeenCalled();
    expect(attachSession).toHaveBeenCalledWith({
      id: "local-session-old",
      threadId: "local-session-old",
      type: "runtime",
      title: "Run pwd",
      projectId: "project-one",
      runtimeId: "desktop-local",
      agentId: "cursor",
      status: "active",
    });
    expect(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }).textContent).toContain("Cursor");
  });

  it("keeps ACP progress in the top-right header toolbar", () => {
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
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    const progress = screen.getByTestId("acp-progress-panel");
    const toolbar = progress.closest('[role="toolbar"]');
    const newSession = screen.getByRole("button", { name: "New session" });
    expect(progress.closest(".clash-copilot-panel-header")).toBeTruthy();
    expect(toolbar?.className).toContain("translate-x-1");
    expect(progress.compareDocumentPosition(newSession) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(progress.className).toContain("shrink-0");
    expect(progress.className).not.toContain("sticky");
    expect(progress.className).not.toContain("top-0");
  });

  it("aligns header and activity rail icons on the same shifted rail", () => {
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
      selectedAgentId: "codex-acp",
      status: "sending",
      ready: true,
      messages: [
        {
          id: "runtime-message-one",
          role: "user",
          parts: [{ type: "text", text: "hello desktop runtime helper" }],
        },
      ] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    const headerRail = container.querySelector(".clash-copilot-panel-header [data-copilot-rail-slot]");
    const activityRail = container.querySelector(".clash-copilot-agent-activity-row [data-copilot-rail-slot]");
    expect(headerRail?.className).toContain("-translate-x-1");
    expect(activityRail?.className).toContain("-translate-x-1");
  });

  it("resets to a desktop runtime draft from the header plus button", () => {
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
    const startDraft = vi.fn();
    const onNewSession = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
      select,
      startDraft,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot({ onNewSession });
    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(startDraft).toHaveBeenCalledWith("desktop-local", undefined, {
      projectId: "project-one",
      agentId: "codex-acp",
      permissionModeId: "codex:review",
      freshSession: true,
    });
    expect(select).not.toHaveBeenCalled();
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("keeps the completed runtime session in history before opening a fresh draft", () => {
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
    const startDraft = vi.fn();
    const onUpsertSession = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      currentSession: {
        id: "runtime-session-one",
        threadId: "runtime-session-one",
        type: "runtime",
        title: "New session",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        status: "active",
      },
      status: "connected",
      ready: true,
      startDraft,
      messages: [
        {
          id: "runtime-user-one",
          role: "user",
          parts: [{ type: "text", text: "Run pwd" }],
        },
      ] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot({ onUpsertSession });
    onUpsertSession.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "New session" }));

    expect(onUpsertSession).toHaveBeenCalledWith(expect.objectContaining({
      threadId: "runtime-session-one",
      title: "Run pwd",
      type: "runtime",
      runtimeId: "desktop-local",
      agentId: "codex-acp",
    }));
    expect(startDraft).toHaveBeenCalledWith("desktop-local", undefined, expect.objectContaining({
      projectId: "project-one",
      agentId: "codex-acp",
      freshSession: true,
    }));
  });

  it("sends the first prompt from a desktop runtime draft instead of creating an empty session first", () => {
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
    const sendMessage = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "draft",
      ready: false,
      select,
      sendMessage,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.getByTestId("chat-input").getAttribute("data-disabled")).toBe("false");
    fireEvent.click(screen.getByTestId("submit-chat-input"));

    expect(sendMessage).toHaveBeenCalledWith("这个是?");
    expect(select).not.toHaveBeenCalled();
  });

  it("routes text revision restore requests through the local runtime CLI action path", () => {
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
    const sendMessage = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
      sendMessage,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    act(() => {
      window.dispatchEvent(new CustomEvent("clash:revision-restore-request", {
        detail: {
          kind: "text",
          nodeId: "text-1",
          revisionId: "txrev-2",
          mode: "replace",
          command: "clash text restore --node text-1 --revision txrev-2 --mode replace",
        },
      }));
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0]?.[0]).toContain("clash text restore --node text-1 --revision txrev-2 --mode replace");
    expect(sendMessage.mock.calls[0]?.[0]).toContain("Do not edit the canvas, snapshot, or SQLite directly");
  });

  it("renders ACP model and thought-level config directly in the composer selector", () => {
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
    const setConfigOption = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      sessionConfigOptions: [...codexAcpConfigOptions] as any,
      setConfigOption,
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    const trigger = screen.getByRole("button", { name: "Session runtime, harness, and model" });
    expect(screen.getByTestId("session-harness-config-trigger")).toBe(trigger);
    expect(screen.getByTestId("session-permission-mode-trigger").getAttribute("aria-label")).toBe("Harness permission mode");
    expect(screen.getByTestId("session-permission-mode-trigger")).not.toBe(trigger);
    expect(trigger.querySelector("[data-acp-agent-logo]")).toBeTruthy();
    expect(trigger.querySelector("[data-session-config-status-slot]")).toBeTruthy();
    expect(trigger.textContent).toContain("GPT-5.5");
    expect(trigger.textContent).not.toContain("Auto");
    expect(trigger.textContent).not.toContain("Local");
    expect(trigger.textContent).not.toContain("Codex");

    fireEvent.pointerDown(trigger);

    expect(screen.queryByText("Runtime")).toBeNull();
    expect(screen.queryByText("Cloud")).toBeNull();
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Harness × Code/ })).toBeNull();
    expect(screen.queryByText("Auto")).toBeNull();
    expect(screen.queryByText("Use the selected harness default model")).toBeNull();
    expect(screen.getByText("Harness")).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: /Codex/ }).getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByText("OpenAI")).toBeNull();
    expect(screen.queryByText("Anthropic")).toBeNull();
    expect(screen.getByRole("menuitem", { name: "GPT-5.5" })).toBeTruthy();
    expect(screen.queryByText("Codex conversational model")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Thinking effort.*Low/ })).toBeNull();

    fireEvent.click(screen.getByRole("menuitem", { name: "GPT-5.5" }));
    expect(screen.getByText("Effort")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Medium/ }));

    expect(setConfigOption).toHaveBeenCalledWith("thought_level", "medium");
  });

  it("updates the ACP model through session/set_config_option", () => {
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
    const setConfigOption = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      sessionConfigOptions: [...codexAcpConfigOptions] as any,
      ready: true,
      setConfigOption,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    const trigger = screen.getByRole("button", { name: "Session runtime, harness, and model" });
    fireEvent.pointerDown(trigger);

    fireEvent.click(screen.getByRole("menuitemradio", { name: "GPT-5.4" }));

    expect(setConfigOption).toHaveBeenCalledWith("model", "gpt-5.4");
  });

  it("locks harness switching for an existing session while allowing ACP model changes", () => {
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
    const startDraft = vi.fn();
    const setConfigOption = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          { id: "codex-acp", label: "Codex", binary: "codex-acp" },
          { id: "cursor", label: "Cursor", binary: "clash-acp-cursor" },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "connected",
      sessionConfigOptions: [...codexAcpConfigOptions] as any,
      ready: true,
      select,
      startDraft,
      setConfigOption,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    const trigger = screen.getByRole("button", { name: "Session runtime, harness, and model" });
    expect((trigger as HTMLButtonElement).disabled).toBe(false);
    fireEvent.pointerDown(trigger);

    const codexHarness = screen.getByRole("menuitemradio", { name: /Codex/ });
    const cursorHarness = screen.getByRole("menuitemradio", { name: /Cursor/ });
    expect(codexHarness.getAttribute("aria-disabled")).toBe("true");
    expect(cursorHarness.getAttribute("aria-disabled")).toBe("true");

    fireEvent.click(cursorHarness);
    expect(select).not.toHaveBeenCalled();
    expect(startDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("menuitemradio", { name: "GPT-5.4" }));

    expect(setConfigOption).toHaveBeenCalledWith("model", "gpt-5.4");
  });

  it("refreshes runtime metadata when opening the session config selector", async () => {
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
    const refresh = vi.fn().mockResolvedValue(undefined);
    mocks.useClashRuntime.mockReturnValue(runtimeState({ refresh }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });
    });
  });

  it("notifies the user when session config refresh fails", async () => {
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
    const refresh = vi.fn().mockRejectedValue(new Error("runtime probe failed"));
    mocks.useClashRuntime.mockReturnValue(runtimeState({ refresh }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilotWithFeedback();

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not refresh local agents");
    expect(alert.textContent).toContain("runtime probe failed");
  });

  it("disables session config for an existing session when the harness exposes no model switch", () => {
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
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          { id: "codex-acp", label: "Codex", binary: "codex-acp" },
          { id: "cursor", label: "Cursor", binary: "clash-acp-cursor" },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "connected",
      sessionConfigOptions: [],
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    const trigger = screen.getByRole("combobox", { name: "Session runtime, harness, and model" }) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    fireEvent.click(trigger);

    expect(screen.queryByRole("listbox", { name: "Session runtime, harness, and model" })).toBeNull();
  });

  it("keeps long Cursor model menus scrollable inside the viewport", () => {
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
    const cursorModelConfig = {
      id: "model",
      name: "Model",
      type: "select",
      category: "model",
      currentValue: "composer-2.5[fast=true]",
      options: Array.from({ length: 30 }, (_, index) => ({
        value: index === 0 ? "composer-2.5[fast=true]" : `model-${index}`,
        name: index === 0 ? "composer-2.5" : `Cursor model ${index}`,
      })),
    };
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [{ id: "cursor", label: "Cursor", binary: "clash-acp-cursor" }],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "cursor",
      status: "connected",
      sessionConfigOptions: [cursorModelConfig] as any,
      ready: true,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));

    const menu = screen.getByRole("listbox", { name: "Session runtime, harness, and model" });
    expect(menu.className).toContain("overflow-hidden");
    expect(menu.querySelector('[class*="overflow-y-auto"]')).toBeTruthy();
    expect(menu.className).not.toContain("overflow-visible");
    expect(menu.getAttribute("style")).toContain("max-height:");
  });

  it("applies permission changes through the active harness session", () => {
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
    const setSessionMode = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
      sessionModes: {
        ...codexSessionModes,
        currentModeId: "codex:full-access",
      },
      select,
      setSessionMode,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    const permissionTrigger = screen.getByRole("combobox", { name: "Harness permission mode" });
    expect(permissionTrigger.textContent).toContain("Full access");
    fireEvent.click(permissionTrigger);
    fireEvent.click(screen.getByRole("option", { name: /Review/ }));

    expect(setSessionMode).toHaveBeenCalledWith("codex:review");
    expect(select).not.toHaveBeenCalled();
  });

  it("keeps permission choices scoped to each selected harness before the session starts", () => {
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
    const startDraft = vi.fn();
    const setSessionMode = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          {
            id: "codex-acp",
            label: "Codex",
            binary: "codex-acp",
            session_modes: { ...codexSessionModes, currentModeId: "codex:full-access" },
          },
          {
            id: "claude-acp",
            label: "Claude",
            binary: "claude-agent-acp",
            session_modes: {
              currentModeId: "claude:full-access",
              availableModes: [
                { id: "claude:ask", name: "Ask first", description: "Claude asks before tools" },
                { id: "claude:full-access", name: "Full access", description: "Claude full access mode" },
              ],
            },
          },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "draft",
      ready: false,
      startDraft,
      setSessionMode,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    const permissionTrigger = screen.getByRole("combobox", { name: "Harness permission mode" });
    expect(permissionTrigger.textContent).toContain("Full access");

    fireEvent.click(permissionTrigger);
    fireEvent.click(screen.getByRole("option", { name: /Review/ }));
    expect(setSessionMode).toHaveBeenLastCalledWith("codex:review");

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));
    fireEvent.click(screen.getByRole("option", { name: /Claude/ }));
    expect(startDraft).toHaveBeenLastCalledWith("desktop-local", undefined, {
      projectId: "project-one",
      agentId: "claude-acp",
      permissionModeId: "claude:full-access",
    });
    expect(screen.getByRole("combobox", { name: "Harness permission mode" }).textContent).not.toContain("Review");

    fireEvent.click(screen.getByRole("combobox", { name: "Harness permission mode" }));
    fireEvent.click(screen.getByRole("option", { name: /Ask first/ }));
    expect(setSessionMode).toHaveBeenLastCalledWith("claude:ask");

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));
    expect(startDraft).toHaveBeenLastCalledWith("desktop-local", undefined, {
      projectId: "project-one",
      agentId: "codex-acp",
      permissionModeId: "codex:review",
    });
    expect(screen.getByRole("combobox", { name: "Harness permission mode" }).textContent).toContain("Review");
  });

  it("uses the selected agent's native ACP mode option as the visible permission mode", () => {
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
    const codexModeConfig = {
      id: "mode",
      name: "Mode",
      type: "select",
      category: "mode",
      currentValue: "agent",
      options: [
        { value: "read-only", name: "Read-only", description: "Requires approval before edits" },
        { value: "agent", name: "Agent", description: "Read and edit files" },
        { value: "agent-full-access", name: "Agent (full access)", description: "Can edit files and run tools" },
      ],
    };
    const qwenModeConfig = {
      id: "mode",
      name: "Mode",
      type: "select",
      category: "mode",
      currentValue: "qwen-safe",
      options: [
        { value: "qwen-safe", name: "Qwen safe", description: "Ask before tools" },
        { value: "qwen-auto", name: "Qwen auto", description: "Use Qwen defaults" },
      ],
    };
    const startDraft = vi.fn();
    const setConfigOption = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          { id: "codex-acp", label: "Codex", binary: "codex-acp", config_options: [codexModeConfig] },
          { id: "qwen-code", label: "Qwen Code", binary: "clash-acp-qwen-code", config_options: [qwenModeConfig] },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "draft",
      ready: false,
      sessionConfigOptions: [codexModeConfig] as any,
      startDraft,
      setConfigOption,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.getByRole("combobox", { name: "Harness permission mode" }).textContent).toContain("Agent");
    fireEvent.click(screen.getByRole("combobox", { name: "Harness permission mode" }));
    fireEvent.click(screen.getByRole("option", { name: /Read-only/ }));

    expect(setConfigOption).toHaveBeenCalledWith("mode", "read-only");
    expect(startDraft).toHaveBeenLastCalledWith("desktop-local", undefined, {
      projectId: "project-one",
      agentId: "codex-acp",
      permissionModeId: "read-only",
    });

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));
    fireEvent.click(screen.getByRole("option", { name: /Qwen Code/ }));
    expect(screen.getByRole("combobox", { name: "Harness permission mode" }).textContent).toContain("Qwen safe");

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));
    fireEvent.click(screen.getByRole("option", { name: /Codex/ }));

    expect(startDraft).toHaveBeenLastCalledWith("desktop-local", undefined, {
      projectId: "project-one",
      agentId: "codex-acp",
      permissionModeId: "read-only",
    });
    expect(screen.getByRole("combobox", { name: "Harness permission mode" }).textContent).toContain("Read-only");
  });

  it("does not reuse one agent's ACP mode config for another agent without mode config", () => {
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
    const codexModeConfig = {
      id: "mode",
      name: "Mode",
      type: "select",
      category: "mode",
      currentValue: "agent",
      options: [
        { value: "read-only", name: "Read-only", description: "Requires approval before edits" },
        { value: "agent", name: "Agent", description: "Read and edit files" },
      ],
    };
    const startDraft = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          { id: "codex-acp", label: "Codex", binary: "codex-acp", config_options: [codexModeConfig] },
          { id: "openclaw", label: "OpenClaw", binary: "openclaw" },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "draft",
      ready: false,
      sessionConfigOptions: [codexModeConfig] as any,
      startDraft,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    fireEvent.click(screen.getByRole("combobox", { name: "Session runtime, harness, and model" }));
    fireEvent.click(screen.getByRole("option", { name: /OpenClaw/ }));

    expect(startDraft).toHaveBeenLastCalledWith("desktop-local", undefined, {
      projectId: "project-one",
      agentId: "openclaw",
    });
    expect(screen.queryByRole("combobox", { name: "Harness permission mode" })).toBeNull();
  });

  it("shows ACP slash commands only while the draft starts with slash", () => {
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
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
      availableCommands: [
        { name: "review", description: "Review unstaged changes" },
        { name: "compact", description: "Compact this session" },
      ],
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
    expect(screen.queryByText("/review")).toBeNull();

    fireEvent.change(screen.getByLabelText("chat draft"), { target: { value: "/" } });

    const commandList = screen.getByRole("listbox", { name: "Slash commands" });
    expect(commandList).toBeTruthy();
    expect(within(commandList).getByText("/review")).toBeTruthy();
    expect(within(commandList).getByText("Review unstaged changes")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("chat draft"), { target: { value: "hello" } });

    expect(screen.queryByRole("listbox", { name: "Slash commands" })).toBeNull();
    expect(screen.queryByText("/review")).toBeNull();
  });

  it("keeps the compact session selector focused on agent logo, model, and transient status", () => {
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
      selectedAgentId: "codex-acp",
      status: "sending",
      ready: true,
      sessionConfigOptions: [...codexAcpConfigOptions] as any,
      messages: [
        {
          id: "runtime-message-one",
          role: "user",
          parts: [{ type: "text", text: "hello desktop runtime helper" }],
        },
      ] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    const trigger = screen.getByRole("button", { name: "Session runtime, harness, and model" });
    const statusSlot = trigger.querySelector("[data-session-config-status-slot]");
    const activityRow = container.querySelector(".clash-copilot-agent-activity-row");
    expect(trigger.querySelector("[data-acp-agent-logo]")).toBeTruthy();
    expect(statusSlot?.textContent).toBe("");
    expect(activityRow).toBeTruthy();
    expect(activityRow?.className).toContain("gap-0.5");
    expect(activityRow?.querySelector("[data-copilot-rail-slot]")).toBeTruthy();
    expect(activityRow?.querySelector("[data-agent-activity-label]")?.className).toContain("-ml-0.5");
    expect(activityRow?.querySelector('[data-agent-motion-state="working"]')).toBeTruthy();
    expect(activityRow?.querySelector(".clash-agent-motion")?.className).toContain("h-6");
    expect(container.querySelector(".clash-copilot-agent-perch")).toBeNull();
    expect(screen.queryByRole("status", { name: "Thinking activity" })).toBeNull();
    expect(screen.getByText("Letting it simmer")).toBeTruthy();
    expect(trigger.textContent).toContain("GPT-5.5");
    expect(trigger.textContent).not.toContain("Auto");
    expect(trigger.textContent).not.toContain("Local");
    expect(trigger.textContent).not.toContain("Codex");
  });

  it("keeps a stable agent activity slot when a turn completes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T00:00:00.000Z"));
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
    const runningState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "sending",
      ready: true,
      messages: [
        {
          id: "runtime-message-one",
          role: "user",
          parts: [{ type: "text", text: "hello desktop runtime helper" }],
        },
      ] as any,
    });
    const completedState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "connected",
      ready: true,
      messages: runningState.messages,
    });
    mocks.useClashRuntime.mockReturnValue(runningState);
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container, rerender } = renderDesktopCopilot();
    expect(container.querySelector(".clash-copilot-agent-activity-row")).toBeTruthy();
    expect(screen.getByText("Letting it simmer")).toBeTruthy();

    vi.setSystemTime(new Date("2026-06-21T00:02:05.000Z"));
    mocks.useClashRuntime.mockReturnValue(completedState);
    act(() => {
      rerender(
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
    });

    expect(container.querySelector(".clash-copilot-agent-activity-slot")).toBeTruthy();
    expect(container.querySelector(".clash-copilot-agent-activity-row")).toBeTruthy();
    expect(container.querySelector(".clash-copilot-agent-activity-slot")?.textContent).toContain("Worked for 2m");
    expect(container.querySelector(".clash-copilot-agent-activity-slot")?.textContent).not.toBe("");
    expect(container.querySelector('[data-agent-motion-state="review"]')).toBeTruthy();
    expect(screen.getByText("Worked for 2m")).toBeTruthy();
    vi.useRealTimers();
  });

  it("does not invent a streaming activity row for attached completed runtime history", () => {
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
      runtimes: [{
        ...desktopLocalRuntime,
        agents: [
          { id: "codex-acp", binary: "codex-acp" },
          { id: "cursor", label: "Cursor", binary: "clash-acp-cursor" },
        ],
      }],
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "cursor",
      sessionId: "local-session-cursor",
      currentSession: {
        id: "local-session-cursor",
        threadId: "local-session-cursor",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "cursor",
        status: "active",
      },
      status: "connected",
      ready: true,
      messages: [
        {
          id: "user-turn-cursor",
          role: "user",
          parts: [{ type: "text", text: "Reply exactly: pong" }],
        },
        {
          id: "assistant-turn-cursor",
          role: "assistant",
          parts: [{ type: "text", text: "pong" }],
        },
      ] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container } = renderDesktopCopilot();

    expect(screen.getAllByText("Reply exactly: pong").length).toBeGreaterThan(0);
    expect(screen.queryByText("Putting it into words")).toBeNull();
    expect(container.querySelector(".clash-copilot-agent-activity-wrapper")).toBeNull();
  });

  it("keeps the activity row visually stable when a follow-up message starts", () => {
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
    const runningState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "sending",
      ready: true,
      messages: [
        {
          id: "user-runtime-message-one",
          role: "user",
          parts: [{ type: "text", text: "first prompt" }],
        },
      ] as any,
    });
    const runningWithFollowUpState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "sending",
      ready: true,
      messages: [
        ...runningState.messages,
        {
          id: "user-runtime-message-two",
          role: "user",
          parts: [{ type: "text", text: "second prompt" }],
        },
      ] as any,
    });
    mocks.useClashRuntime.mockReturnValue(runningState);
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container, rerender } = renderDesktopCopilot();
    const activityRowBefore = container.querySelector(".clash-copilot-agent-activity-row");
    expect(activityRowBefore).toBeTruthy();
    expect(activityRowBefore?.getAttribute("data-activity-layout")).toBe("stable");

    mocks.useClashRuntime.mockReturnValue(runningWithFollowUpState);
    act(() => {
      rerender(
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
    });

    const activityRowsAfter = container.querySelectorAll(".clash-copilot-agent-activity-row");
    expect(activityRowsAfter).toHaveLength(1);
    const activityRowAfter = activityRowsAfter[0];
    expect(activityRowAfter?.getAttribute("data-activity-layout")).toBe("stable");
    expect(activityRowAfter?.querySelector('[data-agent-motion-state="working"]')).toBeTruthy();
  });

  it("keeps an empty activity slot in the new chat empty state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T00:00:00.000Z"));
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
    const runningState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "sending",
      ready: true,
      messages: [
        {
          id: "runtime-message-one",
          role: "user",
          parts: [{ type: "text", text: "hello desktop runtime helper" }],
        },
      ] as any,
    });
    const completedState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "connected",
      ready: true,
      messages: runningState.messages,
    });
    const newChatState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: null,
      status: "draft",
      ready: false,
      messages: [],
    });
    mocks.useClashRuntime.mockReturnValue(runningState);
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { rerender } = renderDesktopCopilot();
    expect(screen.getByText("Letting it simmer")).toBeTruthy();

    vi.setSystemTime(new Date("2026-06-21T00:02:05.000Z"));
    mocks.useClashRuntime.mockReturnValue(completedState);
    act(() => {
      rerender(
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
    });
    expect(screen.getByText("Worked for 2m")).toBeTruthy();

    mocks.useClashRuntime.mockReturnValue(newChatState);
    act(() => {
      rerender(
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
    });

    expect(document.querySelector(".clash-copilot-agent-activity-slot")).toBeTruthy();
    expect(document.querySelector(".clash-copilot-agent-activity-empty-anchor")).toBeTruthy();
    expect(document.querySelector(".clash-copilot-agent-activity-row")).toBeTruthy();
    expect(document.querySelector('[data-agent-motion-state="idle"]')).toBeTruthy();
    expect(screen.getByText("Ready when you are")).toBeTruthy();
    expect(screen.queryByText("Worked for 2m")).toBeNull();
    vi.useRealTimers();
  });

  it("does not restore stale worked duration after the new chat view remounts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-21T00:00:00.000Z"));
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
    const runningState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "sending",
      ready: true,
      messages: [
        {
          id: "runtime-message-one",
          role: "user",
          parts: [{ type: "text", text: "hello desktop runtime helper" }],
        },
      ] as any,
    });
    const completedState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "connected",
      ready: true,
      messages: runningState.messages,
    });
    const newChatState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: null,
      status: "draft",
      ready: false,
      messages: [],
    });
    mocks.useClashRuntime.mockReturnValue(runningState);
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { rerender, unmount } = renderDesktopCopilot();
    expect(screen.getByText("Letting it simmer")).toBeTruthy();

    vi.setSystemTime(new Date("2026-06-21T00:02:05.000Z"));
    mocks.useClashRuntime.mockReturnValue(completedState);
    act(() => {
      rerender(
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
    });
    expect(screen.getByText("Worked for 2m")).toBeTruthy();

    unmount();
    mocks.useClashRuntime.mockReturnValue(newChatState);
    renderDesktopCopilot({ threadId: "thread-two" });

    expect(document.querySelector(".clash-copilot-agent-activity-slot")).toBeTruthy();
    expect(document.querySelector(".clash-copilot-agent-activity-empty-anchor")).toBeTruthy();
    expect(document.querySelector(".clash-copilot-agent-activity-row")).toBeTruthy();
    expect(document.querySelector('[data-agent-motion-state="idle"]')).toBeTruthy();
    expect(screen.getByText("Ready when you are")).toBeTruthy();
    expect(screen.queryByText("Worked for 2m")).toBeNull();
    vi.useRealTimers();
  });

  it("moves the idle new-chat activity near the composer without anchoring active messages", () => {
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
    const newChatState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: null,
      status: "draft",
      ready: false,
      messages: [],
    });
    const activeMessageState = runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      sessionId: "runtime-session-one",
      status: "sending",
      ready: true,
      messages: [
        {
          id: "user-runtime-message-one",
          role: "user",
          parts: [{ type: "text", text: "start the run" }],
        },
      ] as any,
    });

    mocks.useClashRuntime.mockReturnValue(newChatState);
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { rerender } = renderDesktopCopilot();

    const emptyAnchor = document.querySelector(".clash-copilot-agent-activity-empty-anchor");
    expect(emptyAnchor).toBeTruthy();
    expect(emptyAnchor?.className).toContain("clash-copilot-agent-activity-composer-companion");
    expect(emptyAnchor?.className).toContain("pb-1");
    expect(emptyAnchor?.closest(".clash-copilot-composer-stack")).toBeTruthy();
    expect(screen.getByText("Ready when you are")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Starter suggestions" })).toBeNull();

    mocks.useClashRuntime.mockReturnValue(activeMessageState);
    act(() => {
      rerender(
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
    });

    expect(document.querySelector(".clash-copilot-agent-activity-empty-anchor")).toBeNull();
    expect(screen.getByText("start the run")).toBeTruthy();
  });

  it("renders runtime assistant ACP events through the shared ACP message list", () => {
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
    const assistantMessage = {
      id: "runtime-assistant-one",
      role: "assistant",
      parts: [
        { type: "thought", text: "Checking the canvas first." },
        {
          type: "tool_call",
          toolCallId: "tool-1",
          title: "Read",
          rawInput: { path: "notes.md" },
          status: "pending",
        },
      ],
    };
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [assistantMessage] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot();

    expect(screen.getByTestId("acp-message-list")).toBeTruthy();
    expect(mocks.AcpMessageList).toHaveBeenCalledWith({ messages: [assistantMessage] });
    expect(screen.queryByRole("status", { name: "Streaming activity" })).toBeNull();
  });

  it("treats runtime edge update and delete after same-patch edge creation as new-edge operations", async () => {
    vi.useFakeTimers();
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
    const onAddNode = vi.fn();
    const onAddEdge = vi.fn();
    const onUpdateEdge = vi.fn();
    const onRemoveEdge = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [{
        id: "runtime-patch-one",
        role: "assistant",
        parts: [{
          type: "raw_event",
          event: {
            sessionUpdate: "clash.canvas.patch",
            operations: [
              { op: "add_node", node: { id: "agent-source", type: "text", data: { label: "Source" } } },
              { op: "add_node", node: { id: "agent-target", type: "image", data: { label: "Target" } } },
              {
                op: "add_edge",
                edge: {
                  id: "agent-source-agent-target",
                  source: "agent-source",
                  target: "agent-target",
                  type: "default",
                },
              },
              {
                op: "update_edge",
                edge: {
                  id: "agent-source-agent-target",
                  patch: { label: "reviewed", animated: true },
                },
              },
              {
                op: "delete_edge",
                edge: { id: "agent-source-agent-target" },
              },
            ],
          },
        }],
      }] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot({ onAddNode, onAddEdge, onUpdateEdge, onRemoveEdge });

    await act(async () => {
      await vi.runOnlyPendingTimersAsync();
    });

    expect(onAddEdge).toHaveBeenCalledWith(
      {
        id: "agent-source-agent-target",
        source: "agent-source",
        target: "agent-target",
        type: "default",
      },
      undefined,
    );
    expect(onUpdateEdge).toHaveBeenCalledWith(
      "agent-source-agent-target",
      { label: "reviewed", animated: true },
      undefined,
    );
    expect(onRemoveEdge).toHaveBeenCalledWith("agent-source-agent-target", undefined);
    vi.useRealTimers();
  });

  it("keeps runtime output pinned to the bottom while the user is already at the bottom", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = { mode: "desktop" };
    let intersectionCallback: IntersectionObserverCallback | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserver(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
        };
      }),
    );
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      requestAnimationFrameMock,
    );
    globalThis.requestAnimationFrame = requestAnimationFrameMock as unknown as typeof requestAnimationFrame;
    window.requestAnimationFrame = requestAnimationFrameMock as unknown as typeof window.requestAnimationFrame;
    const cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
    globalThis.cancelAnimationFrame = cancelAnimationFrameMock as unknown as typeof cancelAnimationFrame;
    window.cancelAnimationFrame = cancelAnimationFrameMock as unknown as typeof window.cancelAnimationFrame;
    Element.prototype.scrollIntoView = vi.fn();
    const firstMessage = {
      id: "runtime-assistant-one",
      role: "assistant",
      parts: [{ type: "text", text: "First chunk" }],
    };
    const secondMessage = {
      id: "runtime-assistant-two",
      role: "assistant",
      parts: [{ type: "text", text: "Second chunk" }],
    };
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [firstMessage] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container, rerender } = renderDesktopCopilot();
    const scroller = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1800 });
    act(() => {
      intersectionCallback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
      while (frameCallbacks.length > 0) frameCallbacks.shift()?.(0);
    });
    scroller.scrollTop = 1200;

    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [firstMessage, secondMessage] as any,
    }));
    act(() => {
      rerender(
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
    });
    const updatedScroller = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(updatedScroller, "scrollHeight", { configurable: true, value: 1800 });
    act(() => {
      while (frameCallbacks.length > 0) frameCallbacks.shift()?.(0);
    });

    expect(updatedScroller.scrollTop).toBe(1800);
  });

  it("does not steal scroll when the user has moved away from the bottom", () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = { mode: "desktop" };
    let intersectionCallback: IntersectionObserverCallback | null = null;
    vi.stubGlobal(
      "IntersectionObserver",
      vi.fn(function IntersectionObserver(callback: IntersectionObserverCallback) {
        intersectionCallback = callback;
        return {
          observe: vi.fn(),
          disconnect: vi.fn(),
        };
      }),
    );
    const frameCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal(
      "requestAnimationFrame",
      requestAnimationFrameMock,
    );
    globalThis.requestAnimationFrame = requestAnimationFrameMock as unknown as typeof requestAnimationFrame;
    window.requestAnimationFrame = requestAnimationFrameMock as unknown as typeof window.requestAnimationFrame;
    const cancelAnimationFrameMock = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
    globalThis.cancelAnimationFrame = cancelAnimationFrameMock as unknown as typeof cancelAnimationFrame;
    window.cancelAnimationFrame = cancelAnimationFrameMock as unknown as typeof window.cancelAnimationFrame;
    Element.prototype.scrollIntoView = vi.fn();
    const firstMessage = {
      id: "runtime-assistant-one",
      role: "assistant",
      parts: [{ type: "text", text: "First chunk" }],
    };
    const secondMessage = {
      id: "runtime-assistant-two",
      role: "assistant",
      parts: [{ type: "text", text: "Second chunk" }],
    };
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [firstMessage] as any,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    const { container, rerender } = renderDesktopCopilot();
    const scroller = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(scroller, "scrollHeight", { configurable: true, value: 1800 });
    act(() => {
      intersectionCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver);
      while (frameCallbacks.length > 0) frameCallbacks.shift()?.(0);
    });
    scroller.scrollTop = 420;

    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "streaming",
      ready: true,
      messages: [firstMessage, secondMessage] as any,
    }));
    act(() => {
      rerender(
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
    });
    const updatedScroller = container.querySelector(".overflow-y-auto") as HTMLDivElement;
    Object.defineProperty(updatedScroller, "scrollHeight", { configurable: true, value: 1800 });
    updatedScroller.scrollTop = 420;
    act(() => {
      while (frameCallbacks.length > 0) frameCallbacks.shift()?.(0);
    });

    expect(updatedScroller.scrollTop).toBe(420);
  });

  it("includes selected canvas nodes in runtime prompts", () => {
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
    const sendMessage = vi.fn();
    mocks.useClashRuntime.mockReturnValue(runtimeState({
      selectedRuntimeId: "desktop-local",
      selectedAgentId: "codex-acp",
      status: "connected",
      ready: true,
      sendMessage,
    }));
    mocks.useAgentCopilot.mockReturnValue(cloudState());

    renderDesktopCopilot({
      selectedNodes: [{
        id: "node-image-one",
        type: "image",
        position: { x: 0, y: 0 },
        data: { label: "Reference frame" },
      } as any],
    });

    fireEvent.click(screen.getByTestId("submit-chat-input"));

    expect(sendMessage).toHaveBeenCalledWith("这个是?\n\nSelected context: @[Reference frame](node:node-image-one)");
  });
});
