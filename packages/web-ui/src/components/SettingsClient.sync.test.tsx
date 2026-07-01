// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import SettingsClient from "./SettingsClient";
import { AppFeedbackProvider } from "./AppFeedback";
import {
  SettingsSurface,
  readLastSettingsSection,
  writeLastSettingsSection,
} from "./SettingsSurface";

const runtimeMock = vi.hoisted(() => ({
  runtimes: [] as any[],
  refresh: vi.fn(),
  promptQueueEnabled: true,
  setPromptQueueEnabled: vi.fn(),
}));

vi.mock("@clash/web-ui/hooks/useClashRuntime", () => ({
  useClashRuntime: () => ({
    runtimes: runtimeMock.runtimes,
    refresh: runtimeMock.refresh,
    promptQueueEnabled: runtimeMock.promptQueueEnabled,
    setPromptQueueEnabled: runtimeMock.setPromptQueueEnabled,
  }),
}));

vi.mock("@clash/web-ui/lib/clientActions", () => ({
  createApiToken: vi.fn(),
  revokeApiToken: vi.fn(),
  setVariable: vi.fn(),
  deleteVariable: vi.fn(),
  uninstallAction: vi.fn(),
  uninstallSkill: vi.fn(),
  listModelCatalog: vi.fn(async () => []),
  listApiTokens: vi.fn(async () => []),
  listVariables: vi.fn(async () => []),
  listInstalledActions: vi.fn(async () => []),
  listInstalledSkills: vi.fn(async () => []),
  listModelProviders: vi.fn(async () => []),
  updateModelProviders: vi.fn(),
  deleteModelProvider: vi.fn(),
  testModelProvider: vi.fn(),
  listProviderOAuth: vi.fn(async () => []),
  startProviderOAuth: vi.fn(),
  completeProviderOAuth: vi.fn(),
}));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  return {
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    motion: new Proxy(
      {},
      {
        get: (_target, tag: string) =>
          ({
            children,
            whileTap: _whileTap,
            initial: _initial,
            animate: _animate,
            exit: _exit,
            transition: _transition,
            ...props
          }: any) =>
            React.createElement(tag, props, children),
      },
    ),
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

const LOCAL_ASR_MODEL_CATALOG = [
  {
    model: {
      id: "sensevoice-small-asr",
      name: "SenseVoice Small",
      provider: "Local",
      kind: "asr",
      defaultAspectRatio: "1:1",
      description: "Local microphone transcription.",
      parameters: [],
      defaultParams: { asr_model: "iic/SenseVoiceSmall" },
      input: {
        requiresPrompt: false,
        inputMode: { audios: { min: 1, max: 1 } },
        promptModalities: ["audio"],
      },
      maxRuntimeMs: 120_000,
    },
    tier: "available",
    routes: [
      {
        modelCode: "sensevoice-small-asr",
        kind: "asr",
        providerId: "local",
        upstreamId: "local",
        upstreamModel: "iic/SenseVoiceSmall",
        apiShape: "local-asr",
        priority: 1,
      },
    ],
    selectedRoute: {
      modelCode: "sensevoice-small-asr",
      kind: "asr",
      providerId: "local",
      upstreamId: "local",
      upstreamModel: "iic/SenseVoiceSmall",
      apiShape: "local-asr",
      priority: 1,
    },
    candidateProviders: ["local"],
    missingCredentials: [],
    missingOAuth: [],
  },
] as any;

describe("SettingsSurface tab state", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("persists the last selected settings section", () => {
    writeLastSettingsSection("audio");
    expect(readLastSettingsSection()).toBe("audio");

    window.localStorage.setItem("clash.settings.activeSection", "not-a-section");
    expect(readLastSettingsSection()).toBeNull();
  });

  it("renders the active sidebar tab as a clear brand state", () => {
    render(
      <MemoryRouter>
        <SettingsSurface active="tokens" onActiveChange={vi.fn()} variant="page" />
      </MemoryRouter>,
    );

    const activeTab = screen.getByRole("button", { name: "API Tokens" });
    expect(activeTab.getAttribute("aria-current")).toBe("page");
    expect(activeTab.className).toContain("border-brand");
    expect(activeTab.className).toContain("bg-brand-light");
  });

  it("uses Agents as the local agent settings tab instead of Runtimes", () => {
    render(
      <MemoryRouter>
        <SettingsSurface active={"agents" as any} onActiveChange={vi.fn()} variant="page" />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Agents" }).getAttribute("aria-current")).toBe("page");
    expect(screen.queryByRole("button", { name: "Runtimes" })).toBeNull();
  });
});

describe("SettingsClient sync section", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    runtimeMock.runtimes = [];
    runtimeMock.refresh = vi.fn();
    runtimeMock.promptQueueEnabled = true;
    runtimeMock.setPromptQueueEnabled = vi.fn();
    window.localStorage.clear();
  });

  it("shows a sync skeleton while local sync configuration is loading", async () => {
    let resolveSync!: (response: Response) => void;
    const syncPromise = new Promise<Response>((resolve) => {
      resolveSync = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/v1/local/sync") && (!init || init.method === "GET")) {
        return syncPromise;
      }
      return new Response("not found", { status: 404 });
    }));

    render(
      <MemoryRouter>
        <AppFeedbackProvider>
          <SettingsClient
            initialTokens={[]}
            initialVariables={[]}
            initialActions={[]}
            initialSkills={[]}
            activeSection="sync"
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("status", { name: "Loading sync settings" })).toBeTruthy();

    resolveSync(new Response(JSON.stringify({
      mode: "local-only",
      remote_loro: {
        enabled: false,
        url: null,
        has_token: false,
        source: "none",
      },
    }), { headers: { "content-type": "application/json" } }));

    await screen.findByRole("radio", { name: /Local only/ });
    expect(screen.queryByRole("status", { name: "Loading sync settings" })).toBeNull();
  });

  it("loads and saves local sync configuration", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/sync") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          mode: "local-only",
          remote_loro: {
            enabled: false,
            url: null,
            has_token: false,
            source: "none",
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/v1/local/sync") && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          mode: "cloud-sync",
          remote_loro_url: "https://cloud.example",
          remote_loro_token: "secret",
        });
        return new Response(JSON.stringify({
          mode: "cloud-sync",
          remote_loro: {
            enabled: true,
            url: "https://cloud.example",
            has_token: true,
            source: "config",
          },
        }), { headers: { "content-type": "application/json" } });
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
            activeSection="sync"
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Local only");
    fireEvent.click(screen.getByRole("radio", { name: /Cloud sync/ }));
    fireEvent.change(screen.getByLabelText("Remote Loro URL"), {
      target: { value: "https://cloud.example" },
    });
    fireEvent.change(screen.getByLabelText("Remote Loro token"), {
      target: { value: "secret" },
    });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(screen.getAllByText("Token saved").length).toBeGreaterThan(0);
    expect(await screen.findByText("Sync settings saved")).toBeTruthy();
    expect(screen.queryByText("Sync settings saved.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save sync settings" })).toBeNull();
  });

  it("manages runtime machines from Sync without an add-machine action", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [{ id: "codex-acp", binary: "codex-acp" }],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/sync") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          mode: "local-only",
          remote_loro: {
            enabled: false,
            url: null,
            has_token: false,
            source: "none",
          },
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="sync"
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Runtime machines" });
    expect(screen.getByText("This Mac")).toBeTruthy();
    expect(screen.getByText("Agents: codex-acp")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove This Mac runtime" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add machine" })).toBeNull();
  });
});

describe("SettingsClient audio section", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    runtimeMock.runtimes = [];
    runtimeMock.refresh = vi.fn();
    runtimeMock.promptQueueEnabled = true;
    runtimeMock.setPromptQueueEnabled = vi.fn();
    window.localStorage.clear();
  });

  it("shows an audio skeleton while local audio configuration is loading", async () => {
    let resolveAudio!: (response: Response) => void;
    const audioPromise = new Promise<Response>((resolve) => {
      resolveAudio = resolve;
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.includes("/api/v1/local/audio") && (!init?.method || init.method === "GET")) {
        return audioPromise;
      }
      return new Response("not found", { status: 404 });
    }));

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"audio" as any}
          embedded
        />
      </MemoryRouter>,
    );

    expect(await screen.findByRole("status", { name: "Loading audio settings" })).toBeTruthy();

    resolveAudio(new Response(JSON.stringify({
      asr: {
        enabled: false,
        provider: "builtin-funasr",
        base_url: null,
        model: "iic/SenseVoiceSmall",
        has_api_key: false,
        ready: false,
        setup: {
          provider: "funasr",
          runtime: "builtin-rpc",
          status: "disabled",
          available: false,
          default_base_url: null,
          commands: ["python3 -m pip install -U funasr modelscope torch torchaudio"],
          message: "FunASR is not installed",
        },
      },
    }), { headers: { "content-type": "application/json" } }));

    await screen.findByText("Voice input");
    expect(screen.queryByRole("status", { name: "Loading audio settings" })).toBeNull();
  });

  it("deploys local ASR from the model card without fake model selection", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/audio/install") && init?.method === "POST") {
        expect(JSON.parse(String(init.body))).toEqual({ asr_model: "iic/SenseVoiceSmall" });
        return new Response(JSON.stringify({
          asr: {
            enabled: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            has_api_key: false,
            ready: false,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "disabled",
              available: true,
              default_base_url: null,
              commands: [],
            },
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/v1/local/audio") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({
          asr: {
            enabled: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            has_api_key: false,
            ready: false,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "needs-install",
              available: false,
              default_base_url: null,
              commands: [],
            },
          },
        }), { headers: { "content-type": "application/json" } });
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
            initialModelCatalog={LOCAL_ASR_MODEL_CATALOG}
            activeSection={"models" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("SenseVoice Small")).toBeTruthy();
    expect(screen.getByText("asr")).toBeTruthy();
    const modelCard = screen.getByText("sensevoice-small-asr").closest(".rounded-xl") as HTMLElement;
    expect(modelCard).toBeTruthy();
    expect(within(modelCard).getByText("Uses local model cache.")).toBeTruthy();
    expect(within(modelCard).getByText("Not deployed")).toBeTruthy();

    fireEvent.click(within(modelCard).getByRole("button", { name: "Deploy local ASR model" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).includes("/api/v1/local/audio/install") && init?.method === "POST"
    ))).toBe(true));
    await screen.findByText("Deployed");
    expect(within(modelCard).queryByRole("button", { name: "Add" })).toBeNull();
    expect(window.localStorage.getItem("clash.settings.selectedModelIds")).toBeNull();
  });

  it("loads and saves local ASR using catalog model cards", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/audio") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({
          asr: {
            enabled: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            has_api_key: false,
            ready: false,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "disabled",
              available: true,
              default_base_url: null,
              commands: [],
            },
          },
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/v1/local/audio") && init?.method === "PATCH") {
        expect(JSON.parse(String(init.body))).toEqual({
          asr_enabled: true,
          asr_provider: "builtin-funasr",
          asr_model: "iic/SenseVoiceSmall",
        });
        return new Response(JSON.stringify({
          asr: {
            enabled: true,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            has_api_key: false,
            ready: true,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "ready",
              available: true,
              default_base_url: null,
              commands: [],
            },
          },
        }), { headers: { "content-type": "application/json" } });
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
            initialModelCatalog={LOCAL_ASR_MODEL_CATALOG}
            activeSection={"audio" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Audio" });
    expect(screen.getByText("Voice input")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Install local speech recognition" })).toBeNull();
    expect(screen.queryByText("Built-in FunASR setup")).toBeNull();
    expect(screen.queryByText("FunASR is not installed")).toBeNull();
    expect(screen.queryByText("Needs install")).toBeNull();
    expect(screen.queryByLabelText("ASR engine")).toBeNull();
    expect(screen.queryByLabelText("Endpoint URL")).toBeNull();
    expect(screen.queryByLabelText("ASR API key")).toBeNull();
    expect(screen.queryByText("Advanced")).toBeNull();
    expect(screen.queryByText(/FunASR/i)).toBeNull();
    expect(screen.queryByText("python3 -m pip install -U funasr modelscope torch torchaudio")).toBeNull();

    const modelSelect = screen.getByRole("combobox", { name: "ASR model" });
    expect(modelSelect.className).toContain("clash-settings-select-trigger");
    expect(modelSelect.textContent).toContain("SenseVoice Small");
    expect((screen.getByRole("switch", { name: "Enable voice input" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("switch", { name: "Enable voice input" }));

    await waitFor(() => expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).includes("/api/v1/local/audio") && init?.method === "PATCH"
    ))).toBe(true));
    expect(screen.queryByText("Ready")).toBeNull();
    expect(document.querySelector(".clash-settings-alert-error")).toBeNull();
    expect(screen.queryByText("Audio settings saved.")).toBeNull();
  });

  it("explains missing ASR deployment instead of disabling audio controls", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/audio") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({
          asr: {
            enabled: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            has_api_key: false,
            ready: false,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "needs-install",
              available: false,
              default_base_url: null,
              commands: [],
            },
          },
        }), { headers: { "content-type": "application/json" } });
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
            initialModelCatalog={LOCAL_ASR_MODEL_CATALOG}
            activeSection={"audio" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("heading", { name: "Audio" });
    const switchButton = screen.getByRole("switch", { name: "Enable voice input" }) as HTMLButtonElement;
    expect(switchButton.disabled).toBe(false);
    const modelButton = screen.getByRole("button", { name: "ASR model" }) as HTMLButtonElement;
    expect(modelButton.disabled).toBe(false);

    fireEvent.click(switchButton);

    const dialog = await screen.findByRole("dialog", { name: "Deploy ASR model" });
    expect(within(dialog).getByText("The selected ASR model must be deployed before voice input can run locally.")).toBeTruthy();
    const openModels = within(dialog).getByRole("link", { name: "Open Models" });
    expect(openModels.getAttribute("href")).toBe("/settings?section=models");
    expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).includes("/api/v1/local/audio") && init?.method === "PATCH"
    ))).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Deploy ASR model" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "ASR model" }));

    expect(await screen.findByRole("dialog", { name: "Deploy ASR model" })).toBeTruthy();
  });

  it("shows local ASR deploy failures through global feedback instead of an inline alert", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/audio/install") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "HTTP 404" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/audio") && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({
          asr: {
            enabled: false,
            provider: "builtin-funasr",
            base_url: null,
            model: "iic/SenseVoiceSmall",
            has_api_key: false,
            ready: false,
            setup: {
              provider: "funasr",
              runtime: "builtin-rpc",
              status: "needs-install",
              available: false,
              default_base_url: null,
              commands: [],
            },
          },
        }), { headers: { "content-type": "application/json" } });
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
            initialModelCatalog={LOCAL_ASR_MODEL_CATALOG}
            activeSection={"models" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("SenseVoice Small");
    fireEvent.click(screen.getByRole("button", { name: "Deploy local ASR model" }));

    const toast = await screen.findByRole("alert");
    expect(toast.textContent).toContain("Could not deploy local ASR model");
    expect(toast.textContent).toContain("HTTP 404");
    expect(document.querySelector(".clash-settings-alert-error")).toBeNull();
    expect(screen.getByRole("button", { name: "Deploy local ASR model" }).textContent).toBe("Deploy");
  });

  it("shows local ASR load failures through global feedback instead of an inline alert", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => (
      new Response(JSON.stringify({ error: "HTTP 404" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })
    )));

    render(
      <MemoryRouter>
        <AppFeedbackProvider>
          <SettingsClient
            initialTokens={[]}
            initialVariables={[]}
            initialActions={[]}
            initialSkills={[]}
            activeSection={"audio" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    const toast = await screen.findByRole("alert");
    expect(toast.textContent).toContain("Could not load audio settings");
    expect(toast.textContent).toContain("HTTP 404");
    expect(document.querySelector(".clash-settings-alert-error")).toBeNull();
  });
});

describe("SettingsClient runtime harnesses", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
    runtimeMock.runtimes = [];
    runtimeMock.refresh = vi.fn();
    runtimeMock.promptQueueEnabled = true;
    runtimeMock.setPromptQueueEnabled = vi.fn();
  });

  it("shows an agent skeleton while local harness metadata is loading", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    let resolveHarnesses!: (response: Response) => void;
    const harnessesPromise = new Promise<Response>((resolve) => {
      resolveHarnesses = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return harnessesPromise;
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByText("Checking installed agent auth…");
    const skeleton = screen.getByRole("status", { name: "Loading agents" });
    expect(skeleton).toBeTruthy();
    expect(skeleton.className).toContain("divide-y");
    expect(within(skeleton).queryByTestId("agent-skeleton-actions")).toBeNull();

    resolveHarnesses(new Response(JSON.stringify({
      harnesses: [{
        id: "codex-acp",
        label: "Codex",
        binary: "/tmp/clash-acp-codex",
        enabled: false,
        available: true,
        installed: true,
        installable: true,
      }],
    }), { headers: { "content-type": "application/json" } }));

    await screen.findByText("Codex");
    expect(screen.queryByRole("status", { name: "Loading agents" })).toBeNull();
  });

  it("renders local harnesses and persists enablement changes", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [{ id: "codex-acp", binary: "codex-acp" }],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    const harnesses: Array<{
      id: string;
      label: string;
      binary: string;
      enabled: boolean;
      available: boolean;
      custom?: boolean;
      installed?: boolean;
      installedVersion?: string;
      latestVersion?: string;
      updateAvailable?: boolean;
      installable?: boolean;
      installSource?: "registry" | "adapter";
      downloadUrl?: string;
      downloadKind?: "adapter";
      homepage?: string;
      auth?: {
        status: string;
        message: string;
        command?: string;
        methodId?: string;
        methodName?: string;
        methods?: Array<{ id: string; name?: string; description?: string; type?: string }>;
      };
    }> = [
      {
        id: "codex-acp",
        label: "Codex",
        binary: "codex-acp",
        enabled: false,
        available: false,
        installable: true,
        installSource: "registry",
      },
      {
        id: "claude-acp",
        label: "Claude",
        binary: "claude-agent-acp",
        enabled: false,
        available: false,
        installable: true,
        installSource: "registry",
      },
      {
        id: "opencode",
        label: "OpenCode",
        binary: "opencode",
        enabled: false,
        available: false,
        installable: true,
        installSource: "registry",
        homepage: "https://opencode.ai/",
      },
      {
        id: "openclaw",
        label: "OpenClaw",
        binary: "openclaw",
        enabled: false,
        available: false,
        homepage: "https://docs.openclaw.ai/cli/acp",
      },
      {
        id: "gemini",
        label: "Gemini",
        binary: "clash-acp-gemini",
        enabled: false,
        available: false,
        installable: true,
        installSource: "registry",
      },
      {
        id: "cursor",
        label: "Cursor",
        binary: "/tmp/clash-acp-cursor",
        enabled: true,
        available: true,
        installed: true,
        installedVersion: "1.0.0",
        latestVersion: "1.1.0",
        updateAvailable: true,
        installable: true,
        installSource: "registry",
      },
    ];
    let agentServers = {
      "Local ACP": {
        type: "custom",
        command: "node",
        args: ["~/projects/local-agent/index.js", "--acp"],
        env: {},
      },
    };
    runtimeMock.runtimes = [
      {
        id: "local-runtime",
        machine_id: "local-runtime",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [
          { id: "cursor", label: "Cursor", binary: "/tmp/clash-acp-cursor" },
          ...Array.from({ length: 38 }, (_unused, index) => ({
            id: `registry-${index}`,
            label: `Registry ${index}`,
            binary: `registry-${index}`,
          })),
        ],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
      {
        id: "studio-runtime",
        machine_id: "studio-runtime",
        hostname: "Studio Mac",
        os: "darwin/arm64",
        agents: [{ id: "remote-codex", label: "Remote Codex", binary: "codex-acp", version: "1.0.0" }],
        version: "desktop",
        status: "offline",
        last_heartbeat: 1_699_999_000,
        created_at: 1_699_999_000,
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: agentServers }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/agent-servers") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        agentServers = body.agent_servers;
        harnesses[3] = {
          id: "custom-studio-acp",
          label: "Studio ACP",
          binary: "node",
          enabled: true,
          available: true,
          custom: true,
        };
        return new Response(JSON.stringify({ agent_servers: agentServers, harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { enabled_harness_ids?: string[] };
        expect(body.enabled_harness_ids).toEqual(expect.arrayContaining(["cursor", "claude-acp"]));
        expect(body.enabled_harness_ids).toHaveLength(2);
        harnesses[1] = { ...harnesses[1], enabled: true };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/gemini/authenticate") && init?.method === "POST") {
        harnesses[4] = {
          ...harnesses[4],
          enabled: false,
          auth: {
            status: "configured",
            message: "Gemini authentication is configured for ACP.",
            command: "/tmp/clash-acp-gemini",
            methodId: "login",
            methodName: "Login",
            methods: [{ id: "login", name: "Login", type: "terminal" }],
          },
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/gemini/install") && init?.method === "POST") {
        harnesses[4] = {
          ...harnesses[4],
          binary: "/tmp/clash-acp-gemini",
          enabled: false,
          available: true,
          installed: true,
          auth: {
            status: "needs-auth",
            message: "Gemini has no auth method selected for ACP.",
            command: "/tmp/clash-acp-gemini",
            methodId: "login",
            methodName: "Login",
            methods: [{ id: "login", name: "Login", type: "terminal" }],
          },
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/claude-acp/install") && init?.method === "POST") {
        harnesses[1] = {
          ...harnesses[1],
          binary: "/tmp/claude-agent-acp",
          available: true,
          installed: true,
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/cursor/upgrade") && init?.method === "POST") {
        harnesses[5] = {
          ...harnesses[5],
          installedVersion: "1.1.0",
          latestVersion: "1.1.0",
          updateAvailable: false,
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/cursor/install") && init?.method === "DELETE") {
        harnesses[5] = {
          ...harnesses[5],
          enabled: false,
          available: false,
          installed: false,
          installedVersion: undefined,
          updateAvailable: false,
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByText("Agents");
    const agentsHeading = screen.getByRole("heading", { name: "Agents" });
    const promptQueueHeading = screen.getByRole("heading", { name: "Prompt queue" });
    expect(agentsHeading.compareDocumentPosition(promptQueueHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Machines" })).toBeNull();
    expect(screen.queryByText("Bound agents")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add machine" })).toBeNull();
    expect(screen.getByText("Claude")).toBeTruthy();
    expect(screen.queryByText("Bundled")).toBeNull();
    expect(screen.getByRole("button", { name: "Install Codex" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install Claude" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Enable Codex agent" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Enable Gemini agent" })).toBeNull();
    expect(screen.getByRole("button", { name: "Upgrade Cursor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Uninstall Cursor" })).toBeTruthy();
    expect(screen.getByText("Version: 1.0.0 -> 1.1.0")).toBeTruthy();
    expect(screen.getAllByText("Not installed").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: "Install OpenCode" })).toBeTruthy();
    expect(screen.getByText("Docs: https://docs.openclaw.ai/cli/acp")).toBeTruthy();
    expect(screen.getByText("Custom agent servers")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Collapse This Mac runtime" })).toBeTruthy();
    expect(within(screen.getByRole("button", { name: "Collapse This Mac runtime" })).getByText("1 configured agent")).toBeTruthy();
    expect(screen.queryByText("39 configured agents")).toBeNull();
    expect(screen.queryByText("Show agents")).toBeNull();
    expect(screen.queryByText("Hide agents")).toBeNull();
    expect(screen.getByText("Studio Mac")).toBeTruthy();
    expect(screen.getByText("Remote Codex")).toBeTruthy();
    expect(screen.getByText("node ~/projects/local-agent/index.js --acp")).toBeTruthy();
    expect(screen.queryByLabelText("Custom agent servers JSON")).toBeNull();
    expect(screen.getByRole("button", { name: "Install Gemini" })).toBeTruthy();
    expect(screen.getByText("clash-acp-gemini")).toBeTruthy();
    expect(screen.queryByText("/opt/homebrew/bin/gemini")).toBeNull();
    expect(screen.queryByText(/npm install -g/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Collapse This Mac runtime" }));
    expect(screen.queryByRole("button", { name: "Install Codex" })).toBeNull();
    expect(screen.getByRole("button", { name: "Expand This Mac runtime" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Expand This Mac runtime" }));
    expect(screen.getByRole("button", { name: "Install Codex" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/api/v1/local/harnesses?probe=auth&refresh=1")
    ))).toBe(true));
    expect(runtimeMock.refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });

    fireEvent.click(screen.getByRole("button", { name: "Install Gemini" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/gemini/install"),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(screen.getByRole("button", { name: "Uninstall Gemini" })).toBeTruthy();
    expect(screen.getByText("Auth needed")).toBeTruthy();
    expect(screen.getByText(/Gemini has no auth method selected for ACP/)).toBeTruthy();
    expect(screen.getAllByText("/tmp/clash-acp-gemini").length).toBeGreaterThan(0);
    expect(screen.getByText("Manual fallback")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Enable Gemini agent" })).toBeNull();
    expect(screen.queryByText(/Click Auth/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Check Gemini auth again" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => (
      String(input).includes("/api/v1/local/harnesses?probe=auth&refresh=1")
    )).length).toBeGreaterThanOrEqual(2));
    expect(runtimeMock.refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });

    fireEvent.click(screen.getByRole("button", { name: "Open Gemini setup" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/gemini/authenticate"),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(screen.getByText("Auth configured")).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Enable Gemini agent" }) as HTMLButtonElement).disabled).toBe(false);
    expect(runtimeMock.refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });

    fireEvent.click(screen.getByRole("button", { name: "Install Claude" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/claude-acp/install"),
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses"),
      expect.objectContaining({ method: "PUT" }),
    ));
    expect((await screen.findByRole("switch", { name: "Disable Claude agent" })).getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Add custom agent server" }));
    expect(screen.getByRole("dialog", { name: "Add custom agent server" })).toBeTruthy();
    expect(screen.getByText("Settings preview")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Node script" }));
    fireEvent.change(screen.getByLabelText("Agent server name"), {
      target: { value: "Studio ACP" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save agent server" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/agent-servers"),
      expect.objectContaining({ method: "PUT" }),
    ));
    const agentServerPut = fetchMock.mock.calls.find(([input, init]) => (
      String(input).includes("/api/v1/local/agent-servers") && init?.method === "PUT"
    ));
    expect(JSON.parse(String(agentServerPut?.[1]?.body))).toEqual({
      agent_servers: {
        "Local ACP": {
          type: "custom",
          command: "node",
          args: ["~/projects/local-agent/index.js", "--acp"],
          env: {},
        },
        "Studio ACP": {
          type: "custom",
          command: "node",
          args: ["~/projects/my-agent/index.js", "--acp"],
          env: {},
        },
      },
    });
    expect(screen.getByText("node")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Upgrade Cursor" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/cursor/upgrade"),
      expect.objectContaining({ method: "POST" }),
    ));
    expect(screen.getByText("Version: 1.1.0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Upgrade Cursor" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Uninstall Cursor" }));
    const uninstallDialog = screen.getByRole("dialog", { name: "Uninstall Cursor?" });
    expect(within(uninstallDialog).getByText(/removes the Clash-managed ACP install/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input, init]) => (
      String(input).includes("/api/v1/local/harnesses/cursor/install") && init?.method === "DELETE"
    ))).toBe(false);
    fireEvent.click(within(uninstallDialog).getByRole("button", { name: "Confirm uninstall Cursor" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/cursor/install"),
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(screen.getByRole("button", { name: "Install Cursor" })).toBeTruthy();
  });

  it("does not offer install for available unmanaged agents", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [{ id: "codex-acp", binary: "codex-acp" }],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "codex-acp",
            label: "Codex",
            binary: "/tmp/dev-build/acp-bin/codex-acp",
            enabled: true,
            available: true,
            installable: true,
            installSource: "registry",
            auth: {
              status: "configured",
              message: "Codex ACP auth is configured (Login with ChatGPT).",
            },
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByText("Auth configured");
    expect(screen.queryByRole("button", { name: "Install Codex" })).toBeNull();
    expect(screen.getByRole("switch", { name: "Disable Codex agent" }).getAttribute("aria-checked")).toBe("true");
  });

  it("updates harness enablement optimistically and probes missing metadata after save", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    let resolvePut!: (response: Response) => void;
    const putPromise = new Promise<Response>((resolve) => {
      resolvePut = resolve;
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && init?.method === "PUT") {
        return putPromise;
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "claude-acp",
            label: "Claude",
            binary: "/tmp/claude-agent-acp",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            installSource: "registry",
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    const enableSwitch = await screen.findByRole("switch", { name: "Enable Claude agent" });
    fireEvent.click(enableSwitch);

    expect(screen.getByRole("switch", { name: "Disable Claude agent" }).getAttribute("aria-checked")).toBe("true");
    expect(runtimeMock.refresh).not.toHaveBeenCalled();

    resolvePut(new Response(JSON.stringify({
      harnesses: [{
        id: "claude-acp",
        label: "Claude",
        binary: "/tmp/claude-agent-acp",
        enabled: true,
        available: true,
        installed: true,
        installable: true,
        installSource: "registry",
      }],
    }), { headers: { "content-type": "application/json" } }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses"),
      expect.objectContaining({ method: "PUT" }),
    ));
    await waitFor(() => expect(runtimeMock.refresh).toHaveBeenCalledWith({ probe: "config", refresh: true }));
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/api/v1/local/harnesses?probe=auth&refresh=1")
    ))).toBe(true);
  });

  it("does not show unknown as the installed version for legacy registry installs", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [{ id: "cursor", binary: "clash-acp-cursor" }],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [
            {
              id: "cursor",
              label: "Cursor",
              binary: "/Users/xiaoyang/.clash/local-api/acp-bin/clash-acp-cursor",
              enabled: true,
              available: true,
              installed: true,
              latestVersion: "2026.06.24",
              updateAvailable: true,
              installable: true,
              installSource: "registry",
            },
          ],
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }));

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByText("Cursor");
    expect(screen.getByText("Latest version: 2026.06.24")).toBeTruthy();
    expect(screen.queryByText(/unknown/)).toBeNull();
  });

  it("keeps install and uninstall busy labels separate while an install refresh is pending", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    let finishRefresh!: () => void;
    runtimeMock.refresh = vi.fn(() => new Promise<void>((resolve) => {
      finishRefresh = resolve;
    }));
    const harnesses: Array<{
      id: string;
      label: string;
      binary: string;
      enabled: boolean;
      available: boolean;
      installed?: boolean;
      installable: boolean;
      installSource: "registry";
      latestVersion?: string;
    }> = [
      {
        id: "devin",
        label: "Devin",
        binary: "clash-acp-devin",
        enabled: false,
        available: false,
        installable: true,
        installSource: "registry" as const,
        latestVersion: "2026.8.18",
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/devin/install") && init?.method === "POST") {
        harnesses[0] = {
          ...harnesses[0],
          installed: true,
          enabled: false,
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    }));

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Install Devin" });
    fireEvent.click(screen.getByRole("button", { name: "Install Devin" }));

    await screen.findByRole("button", { name: "Uninstall Devin" });
    expect(runtimeMock.refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });
    expect(screen.queryByText("Uninstalling…")).toBeNull();
    finishRefresh();
  });

  it("installs and enables an auth-ready registry agent in one flow", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    const harnesses: Array<{
      id: string;
      label: string;
      binary: string;
      enabled: boolean;
      available: boolean;
      installed?: boolean;
      installable: boolean;
      installSource: "registry";
    }> = [
      {
        id: "codex-acp",
        label: "Codex",
        binary: "codex-acp",
        enabled: false,
        available: false,
        installable: true,
        installSource: "registry" as const,
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/codex-acp/install") && init?.method === "POST") {
        harnesses[0] = {
          ...harnesses[0],
          binary: "/tmp/clash-acp-codex",
          available: true,
          installed: true,
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && init?.method === "PUT") {
        expect(JSON.parse(String(init.body))).toEqual({ enabled_harness_ids: ["codex-acp"] });
        harnesses[0] = {
          ...harnesses[0],
          enabled: true,
        };
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ harnesses }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Install Codex" });
    expect(screen.queryByRole("switch", { name: "Enable Codex agent" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Install Codex" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses/codex-acp/install"),
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/local/harnesses"),
      expect.objectContaining({ method: "PUT" }),
    ));
    await screen.findByRole("button", { name: "Uninstall Codex" });
    expect(screen.queryByRole("button", { name: "Install Codex" })).toBeNull();
  });

  it("refreshes auth state when enablement is rejected by the backend guard", async () => {
    let authRefreshRequested = false;
    const readyHarness = {
      id: "qwen-code",
      label: "Qwen Code",
      binary: "/tmp/clash-acp-qwen-code",
      enabled: false,
      available: true,
      installed: true,
      installable: true,
      installSource: "registry" as const,
    };
    const needsAuthHarness = {
      ...readyHarness,
      auth: {
        status: "needs-auth" as const,
        message: "Qwen Code requires ACP authentication (Use OpenAI API key).",
        command: "/tmp/clash-acp-qwen-code",
        methodId: "openai-api-key",
        methodName: "Use OpenAI API key",
        methods: [{
          id: "openai-api-key",
          name: "Use OpenAI API key",
          description: "Requires setting the OPENAI_API_KEY environment variable",
          type: "terminal",
        }],
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && init?.method === "PUT") {
        authRefreshRequested = true;
        return new Response(JSON.stringify({
          error: "Authenticate Qwen Code before enabling. Qwen Code requires ACP authentication (Use OpenAI API key).",
        }), {
          status: 400,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [authRefreshRequested ? needsAuthHarness : readyHarness],
        }), {
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole("switch", { name: "Enable Qwen Code agent" }));

    await screen.findByText("Auth needed");
    expect(screen.queryByRole("button", { name: "Open Qwen Code setup" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Configure Qwen Code credentials" }));

    await screen.findByRole("status");
    expect(screen.getByText("Configure Qwen Code credentials")).toBeTruthy();
    expect(screen.getByText("Set OPENAI_API_KEY in your agent environment, then check again.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Providers" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Check again" }).length).toBeGreaterThan(0);
    expect(screen.queryByRole("switch", { name: "Enable Qwen Code agent" })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/api/v1/local/harnesses/qwen-code/authenticate")
    ))).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/api/v1/local/harnesses?probe=auth&refresh=1")
    ))).toBe(true);
  });

  it("lets users disable runtime prompt queueing from settings", async () => {
    runtimeMock.runtimes = [
      {
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [{ id: "codex-acp", binary: "codex-acp" }],
        version: "desktop",
        status: "online",
        last_heartbeat: 1_700_000_000,
        created_at: 1_700_000_000,
      },
    ];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ harnesses: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection={"agents" as any}
          embedded
        />
      </MemoryRouter>,
    );

    const queueSwitch = screen.getByRole("switch", { name: "Disable prompt queue" });
    expect(queueSwitch.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(queueSwitch);

    expect(runtimeMock.setPromptQueueEnabled).toHaveBeenCalledWith(false);
  });

  it("shows non-blocking agent probe failures as global feedback with a retry action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ error: "probe unavailable" }), {
          status: 500,
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Could not load agents");
    expect(screen.getByText("HTTP 500")).toBeTruthy();
    expect(screen.queryByText(/Failed to load agents/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => (
      String(input).includes("/api/v1/local/harnesses?probe=auth&refresh=1")
    )).length).toBeGreaterThanOrEqual(1));
    expect(runtimeMock.refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });
  });

  it("shows auth launch failures as non-blocking global feedback", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/devin/authenticate") && init?.method === "POST") {
        return new Response(JSON.stringify({ error: "Login canceled" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "devin",
            label: "Devin",
            binary: "/tmp/clash-acp-devin",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            auth: {
              status: "needs-auth",
              message: "Devin is not signed in for ACP.",
              command: "/tmp/clash-acp-devin auth login",
              methodId: "login",
              methodName: "Login",
              methods: [{ id: "login", name: "Login", type: "agent" }],
            },
          }],
        }), { headers: { "content-type": "application/json" } });
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Devin");
    expect(screen.queryByRole("switch", { name: "Enable Devin agent" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Devin" }));

    await screen.findByRole("alert");
    expect(screen.getByText("Could not start Devin sign in")).toBeTruthy();
    expect(screen.getByText("Login canceled")).toBeTruthy();
    expect(screen.queryByRole("dialog", { name: "Could not start Devin sign in" })).toBeNull();
    expect(screen.queryByText(/Failed to load agents/)).toBeNull();
  });

  it("routes env var auth methods to credential configuration instead of sign-in", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/qwen-code/authenticate")) {
        return new Response(JSON.stringify({ error: "should not authenticate env_var methods" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "qwen-code",
            label: "Qwen Code",
            binary: "/tmp/clash-acp-qwen-code",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            auth: {
              status: "needs-auth",
              message: "Qwen Code requires ACP authentication (OpenAI API key).",
              command: "/tmp/clash-acp-qwen-code",
              methodId: "openai-key",
              methodName: "OpenAI API key",
              methods: [{
                id: "openai-key",
                name: "OpenAI API key",
                description: "Use an OpenAI-compatible API key",
                type: "env_var",
                vars: [{ name: "OPENAI_API_KEY", label: "API key", secret: true }],
                link: "https://platform.openai.com/api-keys",
              }],
            },
          }],
        }), { headers: { "content-type": "application/json" } });
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Auth needed");
    expect(screen.queryByRole("button", { name: "Sign in to Qwen Code" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Configure Qwen Code credentials" }));

    await screen.findByRole("status");
    expect(screen.getByText("Configure Qwen Code credentials")).toBeTruthy();
    expect(screen.getByText("Set OPENAI_API_KEY in your agent environment, then check again.")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Providers" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Check again" }).length).toBeGreaterThan(0);
    expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/api/v1/local/harnesses/qwen-code/authenticate")
    ))).toBe(false);
  });

  it("shows scoped auth checking copy when rechecking one agent", async () => {
    let resolveAuthRefresh!: (response: Response) => void;
    const authRefreshPromise = new Promise<Response>((resolve) => {
      resolveAuthRefresh = resolve;
    });
    const qwenHarness = {
      id: "qwen-code",
      label: "Qwen Code",
      binary: "/tmp/clash-acp-qwen-code",
      enabled: false,
      available: true,
      installed: true,
      installable: true,
      installSource: "registry" as const,
      auth: {
        status: "needs-auth" as const,
        message: "Qwen Code requires ACP authentication (Use OpenAI API key).",
        command: "/tmp/clash-acp-qwen-code",
        methodId: "openai-key",
        methodName: "OpenAI API key",
        methods: [{
          id: "openai-key",
          name: "OpenAI API key",
          description: "Requires setting the OPENAI_API_KEY environment variable",
          type: "env_var",
          vars: [{ name: "OPENAI_API_KEY", label: "API key", secret: true }],
        }],
      },
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses?probe=auth&refresh=1") && (!init || init.method === "GET")) {
        return authRefreshPromise;
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ harnesses: [qwenHarness] }), {
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Auth needed");
    fireEvent.click(screen.getByRole("button", { name: "Check Qwen Code auth again" }));

    expect(screen.getByText("Checking Qwen Code auth…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check Qwen Code auth again" }).textContent).toContain("Checking auth…");
    expect(screen.queryByText("Checking agents…")).toBeNull();

    resolveAuthRefresh(new Response(JSON.stringify({ harnesses: [qwenHarness] }), {
      headers: { "content-type": "application/json" },
    }));
    await waitFor(() => expect(screen.queryByText("Checking Qwen Code auth…")).toBeNull());
  });

  it("lets users choose a concrete ACP auth method", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/devin/authenticate") && init?.method === "POST") {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "devin",
            label: "Devin",
            binary: "/tmp/clash-acp-devin",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            auth: {
              status: "needs-auth",
              message: "Devin is not signed in for ACP.",
              methodId: "browser",
              methodName: "Browser Login",
              methods: [
                { id: "browser", name: "Browser Login", type: "agent" },
                { id: "api-key", name: "API Key", type: "agent" },
              ],
            },
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "devin",
            label: "Devin",
            binary: "/tmp/clash-acp-devin",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            auth: {
              status: "needs-auth",
              message: "Devin is not signed in for ACP.",
              methodId: "browser",
              methodName: "Browser Login",
              methods: [
                { id: "browser", name: "Browser Login", type: "agent" },
                { id: "api-key", name: "API Key", type: "agent" },
              ],
            },
          }],
        }), { headers: { "content-type": "application/json" } });
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByRole("button", { name: "Sign in to Devin with API Key" });
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Devin with API Key" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/local/harnesses/devin/authenticate"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ method_id: "api-key" }),
        }),
      );
    });
  });

  it("automatically rechecks auth after a sign-in launch", async () => {
    let authConfigured = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/devin/authenticate") && init?.method === "POST") {
        authConfigured = true;
        return new Response(JSON.stringify({
          harnesses: [{
            id: "devin",
            label: "Devin",
            binary: "/tmp/clash-acp-devin",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            auth: {
              status: "needs-auth",
              message: "Devin is not signed in for ACP.",
              methodId: "api-key",
              methodName: "API Key",
              methods: [{ id: "api-key", name: "API Key", type: "agent" }],
            },
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "devin",
            label: "Devin",
            binary: "/tmp/clash-acp-devin",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            auth: authConfigured
              ? {
                  status: "configured",
                  message: "Devin ACP auth is configured (API Key).",
                  methodId: "api-key",
                  methodName: "API Key",
                  methods: [{ id: "api-key", name: "API Key", type: "agent" }],
                }
              : {
                  status: "needs-auth",
                  message: "Devin is not signed in for ACP.",
                  methodId: "api-key",
                  methodName: "API Key",
                  methods: [{ id: "api-key", name: "API Key", type: "agent" }],
                },
          }],
        }), { headers: { "content-type": "application/json" } });
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Auth needed");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Devin" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Waiting for Devin auth…")).toBeTruthy();

    await act(async () => {
      vi.advanceTimersByTime(2_000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText("Auth configured")).toBeTruthy();
    expect(screen.queryByText("Waiting for Devin auth…")).toBeNull();
    expect(runtimeMock.refresh).toHaveBeenCalledWith({ probe: "config", refresh: true });
  });

  it("releases the Opening state when sign-in launch does not settle", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/local/agent-servers") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({ agent_servers: {} }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/api/v1/local/harnesses/devin/authenticate") && init?.method === "POST") {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      }
      if (url.includes("/api/v1/local/harnesses") && (!init || init.method === "GET")) {
        return new Response(JSON.stringify({
          harnesses: [{
            id: "devin",
            label: "Devin",
            binary: "/tmp/clash-acp-devin",
            enabled: false,
            available: true,
            installed: true,
            installable: true,
            auth: {
              status: "needs-auth",
              message: "Devin is not signed in for ACP.",
              methodId: "api-key",
              methodName: "API Key",
              methods: [{ id: "api-key", name: "API Key", type: "agent" }],
            },
          }],
        }), { headers: { "content-type": "application/json" } });
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
            activeSection={"agents" as any}
            embedded
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    await screen.findByText("Auth needed");
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole("button", { name: "Sign in to Devin" }));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Sign in to Devin" }).textContent).toContain("Opening sign in…");

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(screen.getByText("Waiting for Devin auth…")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in to Devin" }).textContent).toContain("Open again");
  });
});

describe("SettingsClient model routing", () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.restoreAllMocks();
  });

  it("does not expose legacy fallback or advanced routing controls in BYOK provider details", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              providerId: "fal",
              upstreamId: "fal",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[
            {
              model: {
                id: "nano-banana-2",
                name: "Nano Banana 2",
                provider: "fal",
                kind: "image",
                parameters: [],
                defaultParams: {},
                defaultAspectRatio: "16:9",
                input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
              },
              tier: "available",
              selectedRoute: {
                modelCode: "nano-banana-2",
                kind: "image",
                providerId: "fal",
                upstreamId: "fal",
                upstreamModel: "fal-ai/nano-banana-2",
                apiShape: "fal",
                priority: 20,
              },
              routes: [],
              candidateProviders: ["fal"],
              missingCredentials: [],
              missingOAuth: [],
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Search providers")).toBeTruthy();
    expect(screen.getByText("fal.ai")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /fal\.ai/i }));

    expect(screen.queryByText("Fallback")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add fallback fal.ai key" })).toBeNull();
    expect(screen.queryByText("Advanced routing")).toBeNull();
    expect(screen.queryByLabelText("Weight for fal/fal")).toBeNull();
    expect(screen.queryByLabelText("Priority for fal/fal")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save providers" })).toBeNull();
  });

  it("uses brand assets for built-in provider logos", () => {
    const { container } = render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    const logos = Object.fromEntries(
      [...container.querySelectorAll<HTMLImageElement>("[data-provider-logo]")].map((logo) => [
        logo.getAttribute("data-provider-logo"),
        logo.getAttribute("src"),
      ]),
    );

    expect(logos).toMatchObject({
      openai: "/brand/providers/openai.svg",
      anthropic: "/brand/providers/anthropic.svg",
      google: "/brand/providers/google.svg",
      fal: "/brand/providers/fal.svg",
      kie: "/brand/providers/kie.png",
      replicate: "/brand/providers/replicate.svg",
      kling: "/brand/providers/kling.svg",
      minimax: "/brand/providers/minimax.svg",
      jimeng: "/brand/providers/jimeng.svg",
      volcengine: "/brand/providers/volcengine.svg",
      elevenlabs: "/brand/providers/elevenlabs.svg",
    });
  });

  it("does not repeat the provider page heading inside the Providers content", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Provider accounts and execution settings")).toBeNull();
  });

  it("renders the BYOK provider directory without competing row actions", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "BYOK" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "BYOK settings" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Providers" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Web Search" })).toBeNull();
    expect(screen.getByLabelText("Search providers")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Add custom provider/i })).toBeNull();
  });

  it("renders providers as a compact directory before revealing setup forms", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    const configuredProviders = screen.getByRole("list", { name: "Configured BYOK providers" });
    const availableProviders = screen.getByRole("list", { name: "Available BYOK providers" });
    expect(within(configuredProviders).getByText("Replicate")).toBeTruthy();
    expect(within(configuredProviders).getByText("1 key")).toBeTruthy();
    expect(within(availableProviders).getByText("OpenAI")).toBeTruthy();
    expect(within(availableProviders).getAllByText("Not configured").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Open Replicate BYOK settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open OpenAI BYOK settings" })).toBeTruthy();
    expect(screen.queryByText("Settings")).toBeNull();
    expect(screen.queryByRole("button", { name: "Manage Replicate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Configure OpenAI" })).toBeNull();
    expect(screen.getByText("Available")).toBeTruthy();
    expect(screen.queryByLabelText("Replicate API key")).toBeNull();
    expect(screen.queryByRole("switch", { name: "Enable OpenAI" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Provider enabled for Replicate" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));

    expect(screen.queryByRole("list", { name: "Configured BYOK providers" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to BYOK" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Replicate" })).toBeTruthy();
    const nanoLink = screen.getByRole("link", { name: "View supported models" });
    expect(nanoLink.getAttribute("href")).toBe("/settings?section=models&provider=replicate%3Areplicate%3A");
    expect(screen.getByText("Provider Keys")).toBeTruthy();
    expect(screen.getByText("Prioritized")).toBeTruthy();
    expect(screen.queryByText("Fallback")).toBeNull();
    const apiKeys = screen.getByRole("list", { name: "Replicate prioritized keys" });
    expect(within(apiKeys).getByText("API key 1")).toBeTruthy();
    expect(within(apiKeys).getByText("•••• •••• ••••")).toBeTruthy();
    expect(within(apiKeys).getByRole("switch", { name: "Provider enabled for API key 1" })).toBeTruthy();
    expect(within(apiKeys).getByRole("button", { name: "Drag API key 1" })).toBeTruthy();
    expect(within(apiKeys).queryByText("All")).toBeNull();
    expect(screen.getByRole("button", { name: "Add prioritized Replicate key" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add fallback Replicate key" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Replicate API key" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.queryByLabelText("Replicate API key")).toBeNull();
    expect(screen.queryByPlaceholderText("Saved")).toBeNull();

    const existingRow = within(apiKeys).getAllByRole("listitem")[0];
    fireEvent.click(within(existingRow).getByText("API key 1"));

    const existingKeyEditor = within(existingRow).getByRole("group", { name: "API key 1 Replicate API key" });
    expect(within(existingKeyEditor).getByLabelText("Replicate key name")).toBeTruthy();
    expect(within(existingKeyEditor).getByLabelText("Replicate API key")).toBeTruthy();
    expect(within(existingKeyEditor).queryByRole("button", { name: "Save" })).toBeNull();
    fireEvent.change(within(existingKeyEditor).getByLabelText("Replicate key name"), {
      target: { value: "Primary" },
    });
    expect(within(existingKeyEditor).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(within(existingKeyEditor).queryByText("Filters")).toBeNull();
    expect(within(existingKeyEditor).queryByText("API Keys")).toBeNull();
    expect(within(existingKeyEditor).queryByText("Always use for this provider")).toBeNull();
    expect(within(existingKeyEditor).getByRole("combobox", { name: "Model to test" })).toBeTruthy();
    expect(within(existingKeyEditor).getByRole("button", { name: "Run provider test" })).toBeTruthy();
    expect(within(existingKeyEditor).queryByRole("button", { name: /Remove key/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add prioritized Replicate key" }));

    expect(within(existingRow).queryByRole("group", { name: "API key 1 Replicate API key" })).toBeNull();
    const newKeyEditor = screen.getByRole("group", { name: "New Replicate API key" });
    expect(within(newKeyEditor).getByText("New key")).toBeTruthy();
    expect(within(newKeyEditor).getByLabelText("Replicate key name")).toBeTruthy();
    expect(within(newKeyEditor).getByLabelText("Replicate API key")).toBeTruthy();
    expect(within(newKeyEditor).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(newKeyEditor).queryByRole("switch", { name: "Always use for this provider" })).toBeNull();
    expect(within(newKeyEditor).queryByRole("button", { name: /Test/i })).toBeNull();
    expect(within(newKeyEditor).queryByText("Filters")).toBeNull();
    expect(within(newKeyEditor).queryByText("Models")).toBeNull();
    expect(within(newKeyEditor).queryByText("API Keys")).toBeNull();
    expect(screen.queryByText("Fallback")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add fallback Replicate key" })).toBeNull();
    expect(screen.queryByText("Advanced routing")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back to BYOK" }));

    expect(screen.getByRole("list", { name: "Configured BYOK providers" })).toBeTruthy();
    expect(screen.queryByLabelText("Replicate API key")).toBeNull();
  });

  it("counts multiple credentialless provider accounts in the directory summary", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "mock-primary",
              label: "Mock primary",
              providerId: "mock",
              upstreamId: "mock",
              enabled: true,
              priority: 10,
            },
            {
              id: "mock-secondary",
              label: "Mock secondary",
              providerId: "mock",
              upstreamId: "mock",
              enabled: true,
              priority: 20,
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    const configuredProviders = screen.getByRole("list", { name: "Configured BYOK providers" });
    expect(within(configuredProviders).getByText("Mock Provider")).toBeTruthy();
    expect(within(configuredProviders).getByText("2 keys")).toBeTruthy();
  });

  it("adds another API key as a separate provider account", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              label: "Primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add prioritized Replicate key" }));
    fireEvent.change(screen.getByLabelText("Replicate API key"), {
      target: { value: "r8-second-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            providerId: "replicate",
            upstreamId: "replicate",
            enabled: true,
            credentials: { apiKey: "r8-second-key" },
            configuredCredentials: ["apiKey"],
          }),
        ]),
      );
    });
  });

  it("shows the saved server state after adding a second provider key", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => [
      ...providers,
    ]);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add prioritized Replicate key" }));
    fireEvent.change(screen.getByLabelText("Replicate API key"), {
      target: { value: "r8-second-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalled();
    });

    await waitFor(() => {
      const apiKeys = screen.getByRole("list", { name: "Replicate prioritized keys" });
      const rows = within(apiKeys).getAllByRole("listitem");
      expect(rows).toHaveLength(2);
      expect(within(apiKeys).getByText("API key 1")).toBeTruthy();
      expect(within(apiKeys).getByText("API key 2")).toBeTruthy();
    });
  });

  it("persists provider enablement and disables the switch while save is pending", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    let resolveSave!: (providers: any[]) => void;
    vi.mocked(actions.updateModelProviders).mockImplementation(
      (providers) =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    const initialSwitch = within(screen.getByRole("list", { name: "Replicate prioritized keys" })).getByRole("switch", {
      name: "Provider enabled for API key 1",
    });
    expect(initialSwitch.getAttribute("aria-checked")).toBe("true");

    fireEvent.click(initialSwitch);

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith([
        expect.objectContaining({
          id: "replicate-primary",
          providerId: "replicate",
          enabled: false,
        }),
      ]);
    });
    const pendingSwitch = within(screen.getByRole("list", { name: "Replicate prioritized keys" })).getByRole("switch", {
      name: "Provider enabled for API key 1",
    });
    expect(pendingSwitch.getAttribute("aria-checked")).toBe("false");
    expect(pendingSwitch.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveSave([
        {
          id: "replicate-primary",
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: false,
          configuredCredentials: ["apiKey"],
        },
      ]);
    });

    await waitFor(() => {
      const savedSwitch = within(screen.getByRole("list", { name: "Replicate prioritized keys" })).getByRole("switch", {
        name: "Provider enabled for API key 1",
      });
      expect(savedSwitch.hasAttribute("disabled")).toBe(false);
      expect(savedSwitch.getAttribute("aria-checked")).toBe("false");
    });
  });

  it("does not expose a provider saving status while idle", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Saving provider settings…")).toBeNull();
  });

  it("renders provider keys in priority order with drag handles", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              label: "Primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 20,
              configuredCredentials: ["apiKey"],
            },
            {
              id: "replicate-team",
              label: "Team",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 10,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));

    const apiKeys = screen.getByRole("list", { name: "Replicate prioritized keys" });
    const rows = within(apiKeys).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Team")).toBeTruthy();
    expect(within(rows[1]).getByText("Primary")).toBeTruthy();
    expect(within(apiKeys).getByRole("button", { name: "Drag Team" })).toBeTruthy();
    expect(within(apiKeys).getByRole("button", { name: "Drag Primary" })).toBeTruthy();
  });

  it("reorders provider keys with keyboard-accessible controls and persists priorities", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              label: "Primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 20,
              configuredCredentials: ["apiKey"],
            },
            {
              id: "replicate-team",
              label: "Team",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 10,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    const apiKeys = screen.getByRole("list", { name: "Replicate prioritized keys" });
    const rows = within(apiKeys).getAllByRole("listitem");
    expect(within(rows[0]).getByText("Team")).toBeTruthy();
    expect(within(rows[1]).getByText("Primary")).toBeTruthy();

    fireEvent.click(within(rows[1]).getByRole("button", { name: "Move Primary up" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "replicate-primary",
            priority: 10,
          }),
          expect.objectContaining({
            id: "replicate-team",
            priority: 20,
          }),
        ]),
      );
    });
  });

  it("removes a saved provider account from the provider detail editor", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.deleteModelProvider).mockResolvedValue();
    vi.mocked(actions.listModelProviders).mockResolvedValue([
      {
        id: "replicate-secondary",
        label: "Secondary",
        providerId: "replicate",
        upstreamId: "replicate",
        enabled: true,
        priority: 20,
        configuredCredentials: ["apiKey"],
      },
    ]);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              label: "Primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 10,
              configuredCredentials: ["apiKey"],
            },
            {
              id: "replicate-secondary",
              label: "Secondary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 20,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    const apiKeys = screen.getByRole("list", { name: "Replicate prioritized keys" });
    const primaryRow = within(apiKeys).getByText("Primary").closest("li") as HTMLElement;
    fireEvent.click(within(primaryRow).getByText("Primary"));

    const editor = within(primaryRow).getByRole("group", { name: "Primary Replicate API key" });
    fireEvent.click(within(editor).getByRole("button", { name: "Remove key" }));

    await waitFor(() => {
      expect(actions.deleteModelProvider).toHaveBeenCalledWith("replicate-primary");
    });
    expect(screen.queryByText("Primary")).toBeNull();
    expect(screen.getByText("Secondary")).toBeTruthy();
  });

  it("renders OAuth providers as account configs with scoped authorization controls", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.listProviderOAuth).mockResolvedValue([
      {
        providerId: "dreamina",
        accountId: "jimeng-primary",
        status: "authorized",
        accountLabel: "Primary Dreamina",
        hasAccessToken: true,
      },
    ]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "jimeng-primary",
              label: "Primary Dreamina",
              providerId: "jimeng",
              upstreamId: "jimeng",
              enabled: true,
              priority: 10,
              availableOAuth: ["dreamina"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "Open Dreamina BYOK settings" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Open Dreamina BYOK settings" }));

    expect(screen.getByText("Provider Accounts")).toBeTruthy();
    expect(screen.queryByText("Provider Keys")).toBeNull();
    expect(screen.getByRole("button", { name: "Add prioritized Dreamina account" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();

    const accounts = screen.getByRole("list", { name: "Dreamina prioritized accounts" });
    const accountRow = within(accounts).getByText("Primary Dreamina").closest("li") as HTMLElement;
    await waitFor(() => {
      expect(within(accountRow).getByText("Connected: Primary Dreamina")).toBeTruthy();
    });
    expect(within(accountRow).getByRole("switch", { name: "Provider enabled for Primary Dreamina" })).toBeTruthy();

    fireEvent.click(within(accountRow).getByText("Primary Dreamina"));

    const editor = within(accountRow).getByRole("group", { name: "Primary Dreamina Dreamina account" });
    expect(within(editor).getByText("Authorization")).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect(within(editor).getByRole("combobox", { name: "Model to test" })).toBeTruthy();
    expect(within(editor).getByRole("button", { name: "Run provider test" })).toBeTruthy();
    expect(within(editor).queryByLabelText("Dreamina API key")).toBeNull();
  });

  it("creates a Dreamina account before starting OAuth for that account", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);
    vi.mocked(actions.startProviderOAuth).mockImplementation(async (providerId, accountId, accountLabel) => ({
      providerId,
      accountId,
      accountLabel,
      status: "pending",
      verificationUri: "https://jimeng.example/device",
      userCode: "AAAA-BBBB",
      deviceCode: "device-code",
      hasAccessToken: false,
    }));

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Dreamina BYOK settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add prioritized Dreamina account" }));
    const newAccountEditor = screen.getByRole("group", { name: "New Dreamina account" });
    fireEvent.change(within(newAccountEditor).getByLabelText("Dreamina account name"), {
      target: { value: "Studio" },
    });
    fireEvent.click(within(newAccountEditor).getByRole("button", { name: "Save" }));

    let savedAccountId = "";
    await waitFor(() => {
      const savedProviders = vi.mocked(actions.updateModelProviders).mock.calls.at(-1)?.[0] ?? [];
      const savedAccount = savedProviders.find((provider) => provider.providerId === "jimeng" && provider.label === "Studio");
      expect(savedAccount).toBeTruthy();
      savedAccountId = savedAccount?.id ?? "";
      expect(savedAccountId).toEqual(expect.any(String));
    });

    const accountRow = (await screen.findByText("Studio")).closest("li") as HTMLElement;
    fireEvent.click(within(accountRow).getByText("Studio"));
    fireEvent.click(within(accountRow).getByRole("button", { name: "Connect" }));

    await waitFor(() => {
      expect(actions.startProviderOAuth).toHaveBeenCalledWith("dreamina", savedAccountId, "Studio");
    });
  });

  it("surfaces provider OAuth launch failures instead of silently dropping the action", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.listProviderOAuth).mockResolvedValue([]);
    vi.mocked(actions.startProviderOAuth).mockRejectedValue(
      new Error("Dreamina authorization is only available in the local desktop runtime."),
    );

    render(
      <MemoryRouter>
        <AppFeedbackProvider>
          <SettingsClient
            initialTokens={[]}
            initialVariables={[]}
            initialActions={[]}
            initialSkills={[]}
            activeSection="providers"
            embedded
            initialModelProviders={[
              {
                id: "jimeng-primary",
                label: "Primary Dreamina",
                providerId: "jimeng",
                upstreamId: "jimeng",
                enabled: true,
                priority: 10,
                availableOAuth: ["dreamina"],
              },
            ]}
            initialModelCatalog={[]}
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Dreamina BYOK settings" }));
    const accounts = screen.getByRole("list", { name: "Dreamina prioritized accounts" });
    const accountRow = within(accounts).getByText("Primary Dreamina").closest("li") as HTMLElement;
    fireEvent.click(within(accountRow).getByText("Primary Dreamina"));

    const editor = within(accountRow).getByRole("group", { name: "Primary Dreamina Dreamina account" });
    const connectButton = within(editor).getByRole("button", { name: "Connect" });
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(actions.startProviderOAuth).toHaveBeenCalledWith("dreamina", "jimeng-primary", "Primary Dreamina");
    });
    const toast = await screen.findByRole("alert");
    expect(toast.textContent).toContain("Could not start Dreamina authorization");
    expect(toast.textContent).toContain("Dreamina authorization is only available in the local desktop runtime.");
    await waitFor(() => {
      expect((connectButton as HTMLButtonElement).disabled).toBe(false);
    });
  });

  it("surfaces provider OAuth completion failures on the edited account", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.listProviderOAuth).mockResolvedValue([
      {
        providerId: "dreamina",
        accountId: "jimeng-primary",
        accountLabel: "Primary Dreamina",
        status: "pending",
        verificationUri: "https://jimeng.example/device",
        userCode: "FAIL-CODE",
        deviceCode: "device-code-fails",
        hasAccessToken: false,
      },
    ]);
    vi.mocked(actions.completeProviderOAuth).mockRejectedValue(new Error("Dreamina device code expired"));

    render(
      <MemoryRouter>
        <AppFeedbackProvider>
          <SettingsClient
            initialTokens={[]}
            initialVariables={[]}
            initialActions={[]}
            initialSkills={[]}
            activeSection="providers"
            embedded
            initialModelProviders={[
              {
                id: "jimeng-primary",
                label: "Primary Dreamina",
                providerId: "jimeng",
                upstreamId: "jimeng",
                enabled: true,
                priority: 10,
                availableOAuth: ["dreamina"],
              },
            ]}
            initialModelCatalog={[]}
          />
        </AppFeedbackProvider>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Dreamina BYOK settings" }));
    const accounts = screen.getByRole("list", { name: "Dreamina prioritized accounts" });
    const accountRow = within(accounts).getByText("Primary Dreamina").closest("li") as HTMLElement;
    await waitFor(() => {
      expect(within(accountRow).getByText("Authorization pending")).toBeTruthy();
    });
    fireEvent.click(within(accountRow).getByText("Primary Dreamina"));

    const editor = within(accountRow).getByRole("group", { name: "Primary Dreamina Dreamina account" });
    const completeButton = within(editor).getByRole("button", { name: "Complete" });
    fireEvent.click(completeButton);

    await waitFor(() => {
      expect(actions.completeProviderOAuth).toHaveBeenCalledWith("dreamina", "device-code-fails", "jimeng-primary");
    });
    const toast = await screen.findByRole("alert");
    expect(toast.textContent).toContain("Could not complete Dreamina authorization");
    expect(toast.textContent).toContain("Dreamina device code expired");
    expect(within(editor).getByText("Error: Dreamina device code expired")).toBeTruthy();
    await waitFor(() => {
      expect(within(editor).getByRole("button", { name: "Connect" })).toBeTruthy();
    });
  });

  it("runs a deterministic mock provider test from the provider config editor", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.testModelProvider).mockImplementation(async ({ modelId }) => ({
      ok: true,
      providerId: "mock",
      upstreamId: "mock",
      modelId,
      provider: modelId === "mock-text-model" ? "mock" : "fal-mock",
      ...(modelId === "mock-text-model" ? {} : { requestId: "fal-mock-provider-test" }),
      modelEndpoint: modelId === "mock-text-model" ? "mock/text-completion" : modelId === "mock-image-model" ? "fal-ai/mock-image" : "fal-ai/nano-banana-2",
      input: modelId === "mock-text-model"
        ? {
          shape: "text",
          model: "mock-text-model",
          prompt: "Provider test for Mock Text Model",
        }
        : {
          shape: "image",
          model: modelId,
          prompt: `Provider test for ${modelId === "mock-image-model" ? "Mock Image Model" : "Nano Banana 2"}`,
          aspectRatio: "16:9",
        },
      output: modelId === "mock-text-model"
        ? {
          shape: "text",
          provider: "mock",
          endpoint: "mock/text-completion",
          text: "Generated text (mock-text-model)\n\nProvider test for Mock Text Model",
        }
        : {
          shape: "image",
          provider: "fal-mock",
          endpoint: modelId === "mock-image-model" ? "fal-ai/mock-image" : "fal-ai/nano-banana-2",
          requestId: "fal-mock-provider-test",
          url: "http://local-provider-test/api/mock-fal/files/fal-mock-provider-test.png",
          contentType: "image/png",
          width: 1024,
          height: 576,
        },
      message: `Mock provider ran ${modelId === "mock-text-model" ? "Mock Text Model" : modelId === "mock-image-model" ? "Mock Image Model" : "Nano Banana 2"} through ${modelId === "mock-text-model" ? "mock/text-completion" : modelId === "mock-image-model" ? "fal-ai/mock-image" : "fal-ai/nano-banana-2"}.`,
    }));

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "mock-primary",
              label: "Mock primary",
              providerId: "mock",
              upstreamId: "mock",
              enabled: true,
              priority: 10,
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Mock Provider BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Mock Provider prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Mock primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Mock primary"));

    const editor = within(providerConfig).getByRole("group", { name: "Mock primary Mock Provider API key" });
    const modelToTestSelect = within(editor).getByRole("combobox", { name: "Model to test" });
    expect(modelToTestSelect).toBeTruthy();
    fireEvent.click(modelToTestSelect);
    expect(screen.getByRole("listbox", { name: "Model to test" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Mock Image Model/ }));
    fireEvent.click(within(editor).getByRole("button", { name: "Run provider test" }));

    await waitFor(() => {
      expect(actions.testModelProvider).toHaveBeenCalledWith({
        provider: expect.objectContaining({
          id: "mock-primary",
          providerId: "mock",
          upstreamId: "mock",
        }),
        modelId: "mock-image-model",
      });
    });
    expect(await within(editor).findByText("Mock provider ran Mock Image Model through fal-ai/mock-image.")).toBeTruthy();
    expect(within(editor).getByText("Input")).toBeTruthy();
    expect(within(editor).getByText("Output")).toBeTruthy();
    expect(within(editor).getByLabelText("Provider test input").textContent).toContain('"shape": "image"');
    expect(within(editor).getByLabelText("Provider test input").textContent).toContain('"aspectRatio": "16:9"');
    expect(within(editor).getByLabelText("Provider test output").textContent).toContain('"url": "http://local-provider-test/api/mock-fal/files/fal-mock-provider-test.png"');

    fireEvent.click(within(editor).getByRole("combobox", { name: "Model to test" }));
    expect(screen.getByRole("listbox", { name: "Model to test" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /Mock Text Model/ }));
    fireEvent.click(within(editor).getByRole("button", { name: "Run provider test" }));

    expect(await within(editor).findByText("Mock provider ran Mock Text Model through mock/text-completion.")).toBeTruthy();
    expect(within(editor).getByLabelText("Provider test input").textContent).toContain('"shape": "text"');
    expect(within(editor).getByLabelText("Provider test output").textContent).toContain('"text": "Generated text (mock-text-model)\\n\\nProvider test for Mock Text Model"');
    expect(within(editor).getByLabelText("Provider test output").textContent).not.toContain('"url":');
  });

  it("scopes provider test model choices to the provider config model allowlist", async () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "mock-primary",
              label: "Mock primary",
              providerId: "mock",
              upstreamId: "mock",
              enabled: true,
              priority: 10,
              supportedModelIds: ["gpt-image-2"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Mock Provider BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Mock Provider prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Mock primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Mock primary"));

    const editor = within(providerConfig).getByRole("group", { name: "Mock primary Mock Provider API key" });
    expect(within(editor).getByRole("combobox", { name: "Model to test" }).textContent).toContain("GPT Image 2");

    fireEvent.click(within(editor).getByRole("combobox", { name: "Model to test" }));

    expect(screen.getByRole("listbox", { name: "Model to test" })).toBeTruthy();
    expect(screen.getByRole("option", { name: /GPT Image 2/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /Nano Banana 2/ })).toBeNull();
  });

  it("filters provider test model choices from a searchable picker", async () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "mock-primary",
              label: "Mock primary",
              providerId: "mock",
              upstreamId: "mock",
              enabled: true,
              priority: 10,
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Mock Provider BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Mock Provider prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Mock primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Mock primary"));

    const editor = within(providerConfig).getByRole("group", { name: "Mock primary Mock Provider API key" });
    fireEvent.click(within(editor).getByRole("combobox", { name: "Model to test" }));

    const search = screen.getByRole("combobox", { name: "Search test models" });
    fireEvent.change(search, { target: { value: "text" } });

    fireEvent.click(screen.getByRole("option", { name: /Mock Text Model/ }));

    expect(within(editor).getByRole("combobox", { name: "Model to test" }).textContent).toContain("Mock Text Model");
    expect(screen.queryByRole("option", { name: /Mock Image Model/ })).toBeNull();
  });

  it("runs a saved live provider configuration check from the provider config editor", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.testModelProvider).mockResolvedValue({
      ok: true,
      providerId: "replicate",
      upstreamId: "replicate",
      modelId: "nano-banana-2",
      message: "Replicate configuration is ready for Nano Banana 2.",
    });

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              label: "Replicate primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 10,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Replicate prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Replicate primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Replicate primary"));

    const editor = within(providerConfig).getByRole("group", { name: "Replicate primary Replicate API key" });
    expect(within(editor).getByRole("combobox", { name: "Model to test" })).toBeTruthy();
    fireEvent.click(within(editor).getByRole("button", { name: "Run provider test" }));

    await waitFor(() => {
      expect(actions.testModelProvider).toHaveBeenCalledWith({
        provider: expect.objectContaining({
          id: "replicate-primary",
          providerId: "replicate",
          upstreamId: "replicate",
        }),
        modelId: "nano-banana-2",
      });
    });
    expect(await within(editor).findByText("Replicate configuration is ready for Nano Banana 2.")).toBeTruthy();
  });

  it("does not run provider tests against stale saved data when the editor has unsaved changes", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.testModelProvider).mockResolvedValue({
      ok: true,
      providerId: "replicate",
      upstreamId: "replicate",
      modelId: "nano-banana-2",
      message: "Replicate configuration is ready for Nano Banana 2.",
    });

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              label: "Replicate primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 10,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Replicate prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Replicate primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Replicate primary"));

    const editor = within(providerConfig).getByRole("group", { name: "Replicate primary Replicate API key" });
    const testButton = within(editor).getByRole("button", { name: "Run provider test" });
    expect(testButton.hasAttribute("disabled")).toBe(false);

    fireEvent.change(within(editor).getByLabelText("Replicate key name"), {
      target: { value: "Unsaved key name" },
    });

    expect(within(editor).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(testButton.hasAttribute("disabled")).toBe(true);

    vi.mocked(actions.testModelProvider).mockClear();
    fireEvent.click(testButton);
    expect(actions.testModelProvider).not.toHaveBeenCalled();
  });

  it("clears provider test results when the provider editor changes", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.testModelProvider).mockResolvedValue({
      ok: true,
      providerId: "replicate",
      upstreamId: "replicate",
      modelId: "nano-banana-2",
      message: "Replicate configuration is ready for Nano Banana 2.",
    });

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "replicate-primary",
              label: "Replicate primary",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 10,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Replicate BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Replicate prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Replicate primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Replicate primary"));

    const editor = within(providerConfig).getByRole("group", { name: "Replicate primary Replicate API key" });
    fireEvent.click(within(editor).getByRole("button", { name: "Run provider test" }));

    expect(await within(editor).findByText("Replicate configuration is ready for Nano Banana 2.")).toBeTruthy();

    fireEvent.change(within(editor).getByLabelText("Replicate key name"), {
      target: { value: "Unsaved key name" },
    });

    expect(within(editor).getByRole("button", { name: "Save" })).toBeTruthy();
    expect(within(editor).queryByText("Replicate configuration is ready for Nano Banana 2.")).toBeNull();
  });

  it("saves a provider account model allowlist from the config editor", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "mock-primary",
              label: "Mock primary",
              providerId: "mock",
              upstreamId: "mock",
              enabled: true,
              priority: 10,
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Mock Provider BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Mock Provider prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Mock primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Mock primary"));

    const editor = within(providerConfig).getByRole("group", { name: "Mock primary Mock Provider API key" });
    expect(within(editor).getByText("Model access")).toBeTruthy();
    fireEvent.click(within(editor).getByRole("combobox", { name: "Model access" }));
    fireEvent.click(screen.getByRole("option", { name: /Specific models/ }));
    fireEvent.click(within(editor).getByRole("button", { name: "Add supported model" }));
    const search = screen.getByRole("searchbox", { name: "Filter supported models" });
    fireEvent.change(search, { target: { value: "gpt image" } });
    expect(screen.queryByRole("option", { name: /Nano Banana 2/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /GPT Image 2/ }));
    expect(within(editor).getByRole("button", { name: "Remove GPT Image 2" })).toBeTruthy();
    fireEvent.click(within(editor).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            id: "mock-primary",
            providerId: "mock",
            upstreamId: "mock",
            supportedModelIds: ["gpt-image-2"],
          }),
        ]),
      );
    });
  });

  it("deduplicates provider model choices that have multiple route implementations", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              id: "google-primary",
              label: "Google primary",
              providerId: "official",
              upstreamId: "google",
              region: "global",
              enabled: true,
              priority: 10,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open Google BYOK settings" }));
    const providerConfigs = screen.getByRole("list", { name: "Google prioritized keys" });
    const providerConfig = within(providerConfigs).getByText("Google primary").closest("li") as HTMLElement;
    fireEvent.click(within(providerConfig).getByText("Google primary"));

    const editor = screen.getByRole("group", { name: "Google primary Google API key" });
    fireEvent.click(within(editor).getByRole("combobox", { name: "Model access" }));
    fireEvent.click(screen.getByRole("option", { name: /Specific models/ }));
    fireEvent.click(within(editor).getByRole("button", { name: "Add supported model" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Filter supported models" }), {
      target: { value: "Gemini Flash Image 2" },
    });

    expect(screen.getAllByRole("option", { name: /Gemini Flash Image 2/ })).toHaveLength(1);
  });

  it("configures multiple OpenAI provider keys inline", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open OpenAI BYOK settings" }));
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add prioritized OpenAI key" }));
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "sk-second-openai" },
    });
    fireEvent.change(screen.getByLabelText("OpenAI base URL"), {
      target: { value: "https://openai-compatible.example/v1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            providerId: "official",
            upstreamId: "openai",
            region: "global",
            credentials: {
              apiKey: "sk-second-openai",
              baseUrl: "https://openai-compatible.example/v1",
            },
            configuredCredentials: ["apiKey", "baseUrl"],
          }),
        ]),
      );
    });
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("creates a stable account id for every new provider key", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockClear();
    vi.mocked(actions.listModelCatalog).mockClear();
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open OpenAI BYOK settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Add prioritized OpenAI key" }));
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "sk-first-openai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledTimes(1);
    });
    const firstSave = vi.mocked(actions.updateModelProviders).mock.calls[0]?.[0] ?? [];
    expect(firstSave).toHaveLength(1);
    expect(firstSave[0]).toEqual(expect.objectContaining({
      id: expect.stringMatching(/^official-openai-global-/),
      providerId: "official",
      upstreamId: "openai",
      region: "global",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Add prioritized OpenAI key" }));
    fireEvent.change(screen.getByLabelText("OpenAI API key"), {
      target: { value: "sk-second-openai" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledTimes(2);
    });
    const secondSave = vi.mocked(actions.updateModelProviders).mock.calls[1]?.[0] ?? [];
    expect(secondSave).toHaveLength(2);
    expect(new Set(secondSave.map((provider) => provider.id)).size).toBe(2);
    expect(secondSave.every((provider) => !!provider.id)).toBe(true);
  });

  it("configures all required Kling credential fields inline", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Kling/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add prioritized Kling key" }));
    fireEvent.change(screen.getByLabelText("Kling access key"), {
      target: { value: "kling-access" },
    });
    fireEvent.change(screen.getByLabelText("Kling secret key"), {
      target: { value: "kling-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            providerId: "kling",
            upstreamId: "kling",
            credentials: {
              accessKey: "kling-access",
              secretKey: "kling-secret",
            },
            configuredCredentials: ["accessKey", "secretKey"],
          }),
        ]),
      );
    });
  });

  it("treats Google Vertex credentials as a configured Google provider", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              providerId: "official",
              upstreamId: "google",
              region: "global",
              enabled: true,
              configuredCredentials: ["vertexCredentials"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    const configuredProviders = screen.getByRole("list", { name: "Configured BYOK providers" });
    expect(within(configuredProviders).getByText("Google")).toBeTruthy();
    expect(within(configuredProviders).getByText("1 key")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open Google BYOK settings" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Provider enabled for Google" })).toBeNull();
  });

  it("hides legacy provider rows that do not map to a configurable provider", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="providers"
          embedded
          initialModelProviders={[
            {
              providerId: "official",
              region: "global",
              enabled: true,
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByText("official/global")).toBeNull();
    expect(screen.getByText("OpenAI")).toBeTruthy();
  });

  it("shows models separately from provider forms", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelCatalog={[
            {
              model: {
                id: "nano-banana-2",
                name: "Nano Banana 2",
                provider: "fal",
                kind: "image",
                parameters: [],
                defaultParams: {},
                defaultAspectRatio: "16:9",
                input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
              },
              tier: "available",
              selectedRoute: null,
              routes: [],
              candidateProviders: ["fal"],
              missingCredentials: [],
              missingOAuth: [],
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Models" })).toBeTruthy();
    expect(screen.getByText("Nano Banana 2")).toBeTruthy();
    expect(screen.getByText("Available model cards")).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Modality" })).toBeTruthy();
    expect(screen.queryByLabelText("OpenAI API key")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByText("Selected models")).toBeNull();
    expect(screen.getByText("Provider not configured: fal")).toBeTruthy();
  });

  it("filters the Models page to one provider from the supported-models link", () => {
    render(
      <MemoryRouter initialEntries={["/settings?section=models&provider=replicate%3Areplicate%3A"]}>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelProviders={[
            {
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
            {
              providerId: "official",
              upstreamId: "openai",
              region: "global",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[
            {
              model: {
                id: "nano-banana-2",
                name: "Nano Banana 2",
                provider: "Replicate",
                kind: "image",
                parameters: [],
                defaultParams: {},
                defaultAspectRatio: "16:9",
                input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
              },
              tier: "available",
              selectedRoute: null,
              routes: [],
              candidateProviders: ["replicate"],
              missingCredentials: [],
              missingOAuth: [],
            },
            {
              model: {
                id: "claude-sonnet-4",
                name: "Claude Sonnet 4",
                provider: "Anthropic",
                kind: "text",
                parameters: [],
                defaultParams: {},
                defaultAspectRatio: "16:9",
                input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
              },
              tier: "available",
              selectedRoute: null,
              routes: [],
              candidateProviders: ["official"],
              missingCredentials: [],
              missingOAuth: [],
            },
          ]}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Models supported by Replicate")).toBeTruthy();
    expect(screen.getByText("Nano Banana 2")).toBeTruthy();
    expect(screen.queryByText("Claude Sonnet 4")).toBeNull();
    expect(screen.getByRole("link", { name: "Show all" }).getAttribute("href")).toBe("/settings?section=models");
  });

  it("uses shared select controls for model filters", () => {
    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelCatalog={[
            {
              model: {
                id: "nano-banana-2",
                name: "Nano Banana 2",
                provider: "fal",
                kind: "image",
                parameters: [],
                defaultParams: {},
                defaultAspectRatio: "16:9",
                input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
              },
              tier: "available",
              selectedRoute: null,
              routes: [],
              candidateProviders: ["fal"],
              missingCredentials: [],
              missingOAuth: [],
            },
          ]}
        />
      </MemoryRouter>,
    );

    const modality = screen.getByRole("combobox", { name: "Modality" });
    const providerStatus = screen.getByRole("combobox", { name: "Provider status" });

    expect(modality.className).toContain("clash-select-trigger");
    expect(providerStatus.className).toContain("clash-select-trigger");
  });

  it("lets a model reorder its supported provider priority", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.updateModelProviders).mockImplementation(async (providers) => providers);
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelProviders={[
            {
              providerId: "official",
              upstreamId: "openai",
              region: "global",
              enabled: true,
              priority: 30,
              weight: 10,
              configuredCredentials: ["apiKey"],
            },
            {
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 50,
              weight: 1,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[
            {
              model: {
                id: "gpt-image-2",
                name: "GPT Image 2",
                provider: "OpenAI",
                kind: "image",
                parameters: [],
                defaultParams: {},
                defaultAspectRatio: "1:1",
                input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
              },
              tier: "available",
              selectedRoute: {
                modelCode: "gpt-image-2",
                kind: "image",
                providerId: "official",
                upstreamId: "openai",
                region: "global",
                upstreamModel: "gpt-image-2",
                apiShape: "openai-images",
                priority: 10,
              },
              routes: [
                {
                  modelCode: "gpt-image-2",
                  kind: "image",
                  providerId: "official",
                  upstreamId: "openai",
                  region: "global",
                  upstreamModel: "gpt-image-2",
                  apiShape: "openai-images",
                  priority: 10,
                },
                {
                  modelCode: "gpt-image-2",
                  kind: "image",
                  providerId: "replicate",
                  upstreamId: "replicate",
                  upstreamModel: "openai/gpt-image-2",
                  apiShape: "replicate",
                  priority: 25,
                },
              ],
              candidateProviders: ["official", "replicate"],
              missingCredentials: [],
              missingOAuth: [],
            },
          ]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit provider order for GPT Image 2" }));
    const providerOrder = screen.getByRole("list", { name: "GPT Image 2 provider order" });
    const rows = within(providerOrder).getAllByRole("listitem");
    expect(within(rows[0]).getByText("OpenAI")).toBeTruthy();
    expect(within(rows[1]).getByText("Replicate")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Move Replicate up for GPT Image 2" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            providerId: "replicate",
            upstreamId: "replicate",
            priority: 50,
            weight: 1,
            modelPriorities: { "gpt-image-2": 10 },
          }),
          expect.objectContaining({
            providerId: "official",
            upstreamId: "openai",
            region: "global",
            priority: 30,
            weight: 10,
            modelPriorities: { "gpt-image-2": 20 },
          }),
        ]),
      );
    });
  });

  it("omits provider configs filtered out of a model from that model provider order", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelProviders={[
            {
              providerId: "official",
              upstreamId: "openai",
              region: "global",
              enabled: true,
              configuredCredentials: ["apiKey"],
            },
            {
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
              supportedModelIds: ["nano-banana-2"],
            },
          ]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit provider order for GPT Image 2" }));

    const providerOrder = screen.getByRole("list", { name: "GPT Image 2 provider order" });
    expect(within(providerOrder).getByText("OpenAI")).toBeTruthy();
    expect(within(providerOrder).queryByText("Replicate")).toBeNull();
  });

  it("builds fallback model catalog from every provider account instead of folded provider rows", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelProviders={[
            {
              id: "replicate-nano",
              label: "Nano key",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
              supportedModelIds: ["nano-banana-2"],
            },
            {
              id: "replicate-gpt-image",
              label: "GPT Image key",
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              configuredCredentials: ["apiKey"],
              supportedModelIds: ["gpt-image-2"],
            },
          ]}
          initialModelCatalog={[]}
        />
      </MemoryRouter>,
    );

    const gptImageCard = document.getElementById("model-card-gpt-image-2");
    expect(gptImageCard).toBeTruthy();
    expect(within(gptImageCard as HTMLElement).getByText("Provider ready: replicate/replicate")).toBeTruthy();
  });

  it("disables model provider ordering while provider settings are saving", async () => {
    const actions = await import("@clash/web-ui/lib/clientActions");
    let resolveSave!: (providers: any[]) => void;
    vi.mocked(actions.updateModelProviders).mockImplementation(
      (providers) =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    vi.mocked(actions.listModelCatalog).mockResolvedValue([]);

    render(
      <MemoryRouter>
        <SettingsClient
          initialTokens={[]}
          initialVariables={[]}
          initialActions={[]}
          initialSkills={[]}
          activeSection="models"
          embedded
          initialModelProviders={[
            {
              providerId: "official",
              upstreamId: "openai",
              region: "global",
              enabled: true,
              priority: 30,
              weight: 10,
              configuredCredentials: ["apiKey"],
            },
            {
              providerId: "replicate",
              upstreamId: "replicate",
              enabled: true,
              priority: 50,
              weight: 1,
              configuredCredentials: ["apiKey"],
            },
          ]}
          initialModelCatalog={[
            {
              model: {
                id: "gpt-image-2",
                name: "GPT Image 2",
                provider: "OpenAI",
                kind: "image",
                parameters: [],
                defaultParams: {},
                defaultAspectRatio: "1:1",
                input: { requiresPrompt: true, inputMode: {}, promptModalities: ["text"] },
              },
              tier: "available",
              selectedRoute: {
                modelCode: "gpt-image-2",
                kind: "image",
                providerId: "official",
                upstreamId: "openai",
                region: "global",
                upstreamModel: "gpt-image-2",
                apiShape: "openai-images",
                priority: 10,
              },
              routes: [
                {
                  modelCode: "gpt-image-2",
                  kind: "image",
                  providerId: "official",
                  upstreamId: "openai",
                  region: "global",
                  upstreamModel: "gpt-image-2",
                  apiShape: "openai-images",
                  priority: 10,
                },
                {
                  modelCode: "gpt-image-2",
                  kind: "image",
                  providerId: "replicate",
                  upstreamId: "replicate",
                  upstreamModel: "openai/gpt-image-2",
                  apiShape: "replicate",
                  priority: 25,
                },
              ],
              candidateProviders: ["official", "replicate"],
              missingCredentials: [],
              missingOAuth: [],
            },
          ]}
        />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Edit provider order for GPT Image 2" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Replicate up for GPT Image 2" }));

    await waitFor(() => {
      expect(actions.updateModelProviders).toHaveBeenCalled();
    });

    const pendingProviderOrder = screen.getByRole("list", { name: "GPT Image 2 provider order" });
    expect(within(pendingProviderOrder).getByRole("button", { name: "Move Replicate down for GPT Image 2" }).hasAttribute("disabled")).toBe(true);
    expect(within(pendingProviderOrder).getByRole("button", { name: "Move OpenAI up for GPT Image 2" }).hasAttribute("disabled")).toBe(true);

    await act(async () => {
      resolveSave([
        {
          providerId: "replicate",
          upstreamId: "replicate",
          enabled: true,
          priority: 50,
          weight: 1,
          configuredCredentials: ["apiKey"],
          modelPriorities: { "gpt-image-2": 10 },
        },
        {
          providerId: "official",
          upstreamId: "openai",
          region: "global",
          enabled: true,
          priority: 30,
          weight: 10,
          configuredCredentials: ["apiKey"],
          modelPriorities: { "gpt-image-2": 20 },
        },
      ]);
    });

    await waitFor(() => {
      const savedProviderOrder = screen.getByRole("list", { name: "GPT Image 2 provider order" });
      expect(within(savedProviderOrder).getByRole("button", { name: "Move Replicate down for GPT Image 2" }).hasAttribute("disabled")).toBe(false);
      expect(within(savedProviderOrder).getByRole("button", { name: "Move OpenAI up for GPT Image 2" }).hasAttribute("disabled")).toBe(false);
    });
  });
});
