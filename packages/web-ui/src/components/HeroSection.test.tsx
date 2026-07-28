// @vitest-environment jsdom
import { forwardRef, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import HeroSection from "./HeroSection";
import type { UseClashRuntimeReturn } from "@clash/web-ui/hooks/useClashRuntime";

const mocks = vi.hoisted(() => ({
  startDraft: vi.fn(),
  setConfigOption: vi.fn(),
  setSessionMode: vi.fn(),
  refresh: vi.fn().mockResolvedValue(undefined),
}));

const modeOption = {
  id: "mode",
  name: "Mode",
  type: "select",
  category: "mode",
  currentValue: "agent",
  options: [
    { value: "read-only", name: "Read-only" },
    { value: "agent", name: "Agent" },
    { value: "agent-full-access", name: "Agent (full access)" },
  ],
};

const modelOption = {
  id: "model",
  name: "Model",
  type: "select",
  category: "model",
  currentValue: "gpt-5.6-sol",
  options: [
    { value: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
    { value: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
  ],
};

vi.mock("@clash/web-ui/hooks/useClashRuntime", () => ({
  useClashRuntime: (): UseClashRuntimeReturn => ({
    runtimes: [{
      id: "desktop-local",
      machine_id: "desktop-local",
      hostname: "This Mac",
      os: "darwin/arm64",
      agents: [{
        id: "codex-acp",
        label: "Codex",
        config_options: [modeOption, modelOption],
      }],
      preferences: {
        agent_id: "codex-acp",
        config_by_agent: {},
        mode_by_agent: { "codex-acp": "agent" },
      },
      version: "desktop",
      status: "online",
      last_heartbeat: Date.now(),
      created_at: Date.now(),
    }],
    startupStatus: "ready",
    selectedRuntimeId: null,
    selectedAgentId: null,
    sessionId: null,
    currentSession: null,
    status: "idle",
    errorMessage: null,
    transientStatus: null,
    diagnostics: [],
    messages: [],
    availableCommands: [],
    promptQueue: [],
    promptQueueEnabled: true,
    promptQueueMode: "single",
    sessionConfigOptions: [],
    sessionModes: null,
    sessionInfoMeta: null,
    goal: null,
    sessionUsage: null,
    permissionRequests: [],
    sessionRuntimeStatus: null,
    sessionRestartPhase: "idle",
    ready: false,
    refresh: mocks.refresh,
    select: vi.fn(),
    startDraft: mocks.startDraft,
    prepareSession: vi.fn(),
    attachSession: vi.fn(),
    loadResumeOptions: vi.fn().mockResolvedValue([]),
    sendMessage: vi.fn(),
    setPromptQueueEnabled: vi.fn(),
    setPromptQueueMode: vi.fn(),
    steerQueuedPrompt: vi.fn(),
    updateQueuedPrompt: vi.fn(),
    removeQueuedPrompt: vi.fn(),
    reorderPromptQueue: vi.fn(),
    clearPromptQueue: vi.fn(),
    setConfigOption: mocks.setConfigOption,
    setSessionMode: mocks.setSessionMode,
    respondPermission: vi.fn(),
    restartSession: vi.fn(),
    cancel: vi.fn(),
    shutdown: vi.fn(),
  }),
}));

vi.mock("./copilot/ChatInput", () => ({
  ChatInput: forwardRef((props: {
    variant?: string;
    toolbarAccessory?: ReactNode;
    rightToolbarAccessory?: ReactNode;
  }, _ref) => (
    <div data-testid="home-composer" data-variant={props.variant}>
      {props.toolbarAccessory}
      {props.rightToolbarAccessory}
    </div>
  )),
}));

vi.mock("framer-motion", () => ({
  motion: {
    h1: ({ children, ...props }: { children?: ReactNode }) => <h1 {...props}>{children}</h1>,
  },
}));

describe("HeroSection runtime composer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses the full runtime composer controls with hero sizing", async () => {
    render(
      <MemoryRouter>
        <HeroSection />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("home-composer").getAttribute("data-variant")).toBe("hero");
    expect(screen.getByTestId("session-permission-mode-trigger").textContent).toContain("Approve for me");
    expect(screen.getByTestId("session-harness-config-trigger").textContent).toContain("GPT-5.6-Sol");

    await waitFor(() => {
      expect(mocks.startDraft).toHaveBeenCalledWith(
        "desktop-local",
        undefined,
        expect.objectContaining({
          agentId: "codex-acp",
          permissionModeId: "agent",
        }),
      );
    });
  });
});
