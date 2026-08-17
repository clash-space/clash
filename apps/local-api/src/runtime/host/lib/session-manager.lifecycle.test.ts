import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AcpSession, SessionOptions } from "../_acp-runtime/types.js";

const mocks = vi.hoisted(() => ({
  runtimeStart: vi.fn(),
  resolveAgentMcpServers: vi.fn(),
}));

const bundledClashMcp = {
  name: "clash",
  command: process.execPath,
  args: ["/opt/clash/plugins/clash/runtime/index.js"],
  env: [{ name: "CLASH_PROJECT_ID", value: "project-lifecycle" }],
  _meta: {
    "io.modelcontextprotocol/ui": {
      host: "clash",
      mimeTypes: ["text/html;profile=mcp-app"],
    },
    "clash.plugin": "builtin",
    "clash.renderer": "product",
  },
};

vi.mock("../_acp-runtime/index.js", () => ({
  AcpRuntimeImpl: class {
    start = mocks.runtimeStart;
  },
}));

vi.mock("../_acp-runtime/spawners/node.js", () => ({
  NodeSpawner: class {},
}));

vi.mock("./session-cwd.js", () => ({
  ensureAgentCwd: vi.fn(async () => "/tmp/clash-session-lifecycle"),
  readAgentRuntime: vi.fn(async () => ({ agent_id: "fake-acp" })),
  resolveAgentMcpServers: mocks.resolveAgentMcpServers,
}));

import { SessionManager, type ManagerOut, type SessionStartParams } from "./session-manager.js";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function sessionParams(sessionId: string): SessionStartParams {
  return {
    session_id: sessionId,
    agent_template_id: "clash",
    agent_id: "fake-acp",
    agent_spec: { command: "fake-acp" },
    project_id: "project-lifecycle",
  };
}

function createAcpSession(options: {
  prompt?: AcpSession["prompt"];
  dispose?: AcpSession["dispose"];
} = {}): AcpSession {
  return {
    id: "runtime-session",
    acpSessionId: "acp-session",
    options: { agent: { command: "fake-acp" } } satisfies SessionOptions,
    authMethods: [],
    protocolVersion: null,
    agentInfo: null,
    agentCapabilities: {},
    initializeMeta: null,
    sessionSetupMeta: null,
    configOptions: [],
    modes: null,
    promptCapabilities: {},
    supportsSessionFork: false,
    supportsSessionList: false,
    supportsSessionDelete: false,
    supportsSessionResume: false,
    supportsSessionClose: false,
    supportsLogout: false,
    supportsProviders: false,
    supportsNes: false,
    nesCapabilities: null,
    positionEncoding: null,
    supportsSteering: false,
    loadedReplayEvents: [],
    drainPendingEvents() {
      return [];
    },
    prompt: options.prompt ?? (async function* () {}),
    async steer() {
      return "injected";
    },
    async setConfigOption() {
      return [];
    },
    async setMode() {
      return;
    },
    async provideToolResult() {
      return undefined;
    },
    async authenticate() {
      return undefined;
    },
    async cancelCurrentTurn() {
      return;
    },
    async listSessions() {
      return { sessions: [] };
    },
    async deleteSession() {
      return;
    },
    async logout() {
      return;
    },
    async listProviders() {
      return { providers: [] };
    },
    async setProvider() {
      return;
    },
    async disableProvider() {
      return;
    },
    async requestExtension() {
      return {};
    },
    async notifyExtension() {
      return;
    },
    async startNes() {
      return { sessionId: "nes-session" };
    },
    async suggestNes() {
      return { suggestions: [] };
    },
    async closeNes() {
      return;
    },
    async didOpenDocument() {
      return;
    },
    async didChangeDocument() {
      return;
    },
    async didCloseDocument() {
      return;
    },
    async didSaveDocument() {
      return;
    },
    async didFocusDocument() {
      return;
    },
    async acceptNes() {
      return;
    },
    async rejectNes() {
      return;
    },
    isAlive() {
      return true;
    },
    dispose: options.dispose ?? (async () => undefined),
  };
}

async function nextTask(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("SessionManager lifecycle", () => {
  beforeEach(() => {
    mocks.runtimeStart.mockReset();
    mocks.resolveAgentMcpServers.mockReset();
    mocks.resolveAgentMcpServers.mockResolvedValue([bundledClashMcp]);
  });

  it("mounts the bundled Clash MCP in ACP session/new during cold start", async () => {
    mocks.runtimeStart.mockResolvedValue(createAcpSession());
    const manager = new SessionManager(() => undefined);
    const params = sessionParams("session-bundled-clash-mcp");

    await manager.start(params);

    try {
      expect(mocks.resolveAgentMcpServers).toHaveBeenCalledWith(
        "clash",
        expect.objectContaining({
          CLASH_PROJECT_ID: "project-lifecycle",
          CLASH_WORKSPACE_ROOT: "/tmp/clash-session-lifecycle",
        }),
      );
      expect(mocks.runtimeStart).toHaveBeenCalledWith(
        expect.objectContaining({
          mcpServers: [bundledClashMcp],
        }),
      );
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("publishes negotiated ACP capability facts in session.ready", async () => {
    const session = createAcpSession();
    Object.assign(session, {
      protocolVersion: 1,
      agentInfo: { name: "fixture-agent", version: "1.2.3" },
      agentCapabilities: {
        promptCapabilities: { image: true },
        sessionCapabilities: { fork: {}, list: {}, resume: {}, close: {} },
      },
      initializeMeta: { steering: { supported: true } },
      sessionSetupMeta: { startupInfo: { provider: "fixture" } },
      promptCapabilities: { image: true },
      supportsSessionFork: true,
      supportsSessionList: true,
      supportsSessionResume: true,
      supportsSessionClose: true,
      supportsLogout: true,
      supportsProviders: true,
      supportsNes: true,
      nesCapabilities: { jump: {} },
      positionEncoding: "utf-16",
      supportsSteering: true,
    });
    mocks.runtimeStart.mockResolvedValue(session);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-ready-capabilities");

    await manager.start(params);

    try {
      expect(sent).toContainEqual(expect.objectContaining({
        type: "session.ready",
        session_id: params.session_id,
        protocol_version: 1,
        agent_info: { name: "fixture-agent", version: "1.2.3" },
        agent_capabilities: expect.objectContaining({
          promptCapabilities: { image: true },
        }),
        initialize_meta: { steering: { supported: true } },
        session_setup_meta: { startupInfo: { provider: "fixture" } },
        prompt_capabilities: { image: true },
        supports_session_fork: true,
        supports_session_list: true,
        supports_session_resume: true,
        supports_session_close: true,
        supports_logout: true,
        supports_providers: true,
        supports_nes: true,
        nes_capabilities: { jump: {} },
        position_encoding: "utf-16",
        supports_steering: true,
      }));
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("forwards post-ready out-of-band ACP updates without assigning them to a turn", async () => {
    let publishOutOfBand: ((event: unknown) => void) | undefined;
    mocks.runtimeStart.mockImplementation(async (options: SessionOptions) => {
      publishOutOfBand = options.onOutOfBandSessionUpdate;
      return createAcpSession();
    });
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-out-of-band-update");

    await manager.start(params);
    publishOutOfBand?.({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "background result" },
    });

    try {
      expect(sent).toContainEqual({
        type: "session.event",
        session_id: params.session_id,
        turn_id: "",
        event: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "background result" },
        },
      });
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("fails closed instead of starting a self-host session without the bundled Clash MCP", async () => {
    mocks.resolveAgentMcpServers.mockResolvedValue([]);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-missing-bundled-clash-mcp");

    await manager.start(params);

    expect(mocks.runtimeStart).not.toHaveBeenCalled();
    expect(sent).toContainEqual(expect.objectContaining({
      type: "session.error",
      session_id: params.session_id,
      message: expect.stringMatching(/bundled Clash MCP/i),
    }));
    expect(sent.some((message) => message.type === "session.ready")).toBe(false);
  });

  it("host-marks product rendering only for the bundled MCP injected into this session", async () => {
    mocks.resolveAgentMcpServers.mockResolvedValue([{
      name: "clash",
      command: process.execPath,
      args: ["/opt/clash/plugins/clash/runtime/index.js"],
      env: [],
      _meta: {
        "clash.plugin": "builtin",
        "clash.renderer": "product",
      },
    }]);
    mocks.runtimeStart.mockResolvedValue(createAcpSession({
      prompt() {
        return (async function* () {
          yield {
            sessionUpdate: "tool_call",
            toolCallId: "bundled-clash",
            rawInput: { server: "clash", tool: "clash_canvas_list" },
            _meta: { is_mcp_tool_call: true },
          };
          yield {
            sessionUpdate: "tool_call",
            toolCallId: "other-mcp",
            rawInput: { server: "charts", tool: "show_sales" },
            _meta: { is_mcp_tool_call: true },
          };
        })();
      },
    }));
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-trusted-mcp-renderer");

    await manager.start(params);
    await manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-mcp",
      text: "inspect canvas",
    });

    try {
      const events = sent
        .filter((message): message is Extract<ManagerOut, { type: "session.event" }> => message.type === "session.event")
        .map((message) => message.event);
      expect(events).toEqual([
        expect.objectContaining({
          toolCallId: "bundled-clash",
          _meta: expect.objectContaining({
            "clash.host_trusted_mcp": true,
            "clash.renderer": "product",
          }),
        }),
        expect.objectContaining({
          toolCallId: "other-mcp",
          _meta: { is_mcp_tool_call: true },
        }),
      ]);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("keeps raw ACP events and appends canonical subagent lifecycle before turn completion", async () => {
    mocks.runtimeStart.mockResolvedValue(createAcpSession({
      prompt() {
        return (async function* () {
          yield {
            sessionUpdate: "tool_call",
            toolCallId: "tool-spawn",
            title: "spawnAgent",
            status: "in_progress",
            rawInput: {
              message: "Audit the runtime",
              agent_type: "reviewer",
              fork_context: true,
            },
            _meta: {
              codex: {
                collaboration: {
                  tool: "spawnAgent",
                  receiverThreadIds: ["child-codex-1"],
                },
              },
            },
          };
        })();
      },
    }));
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = {
      ...sessionParams("session-canonical-subagent"),
      agent_id: "codex-acp",
    };

    await manager.start(params);
    await manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-canonical-subagent",
      text: "delegate the audit",
    });

    try {
      const turnMessages = sent.filter(
        (message) => "turn_id" in message && message.turn_id === "turn-canonical-subagent",
      );
      expect(turnMessages).toEqual([
        expect.objectContaining({
          type: "session.event",
          event: expect.objectContaining({
            sessionUpdate: "tool_call",
            toolCallId: "tool-spawn",
          }),
        }),
        expect.objectContaining({
          type: "session.event",
          event: expect.objectContaining({
            schema_version: "oma.event.v1",
            type: "work_item.started",
            work_item_id: "child-codex-1",
          }),
        }),
        expect.objectContaining({
          type: "session.event",
          event: expect.objectContaining({
            schema_version: "oma.event.v1",
            type: "work_item.missing_terminal",
            work_item_id: "child-codex-1",
          }),
        }),
        expect.objectContaining({ type: "session.complete" }),
      ]);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("normalizes out-of-band callback lifecycle without assigning it to a turn", async () => {
    let publishOutOfBand: ((event: unknown) => void) | undefined;
    mocks.runtimeStart.mockImplementation(async (options: SessionOptions) => {
      publishOutOfBand = options.onOutOfBandSessionUpdate;
      return createAcpSession();
    });
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-canonical-callback");

    await manager.start(params);
    publishOutOfBand?.({
      type: "acp.client_request",
      requestId: "callback-1",
      method: "terminal/create",
      params: { command: "pwd" },
    });

    try {
      expect(sent.filter((message) => message.type === "session.event")).toEqual([
        {
          type: "session.event",
          session_id: params.session_id,
          turn_id: "",
          event: {
            type: "acp.client_request",
            requestId: "callback-1",
            method: "terminal/create",
            params: { command: "pwd" },
          },
        },
        expect.objectContaining({
          type: "session.event",
          session_id: params.session_id,
          turn_id: "",
          event: expect.objectContaining({
            schema_version: "oma.event.v1",
            type: "callback.requested",
            data: expect.objectContaining({
              callback_id: "callback-1",
              category: "terminal",
            }),
          }),
        }),
      ]);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("coalesces concurrent starts for one session into one ACP child", async () => {
    const started = deferred<AcpSession>();
    const session = createAcpSession();
    mocks.runtimeStart.mockReturnValue(started.promise);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-coalesced-start");

    const first = manager.start(params);
    const second = manager.start(params);
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalled());
    await nextTask();
    const startCount = mocks.runtimeStart.mock.calls.length;
    started.resolve(session);
    await Promise.all([first, second]);

    try {
      expect(startCount).toBe(1);
      expect(sent.filter((message) => message.type === "session.ready")).toHaveLength(1);
      expect(sent.some((message) => message.type === "session.error")).toBe(false);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("lets dispose dominate an in-flight start and reaps the late ACP child", async () => {
    const started = deferred<AcpSession>();
    const dispose = vi.fn(async () => undefined);
    mocks.runtimeStart.mockReturnValue(started.promise);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-disposed-during-start");

    const starting = manager.start(params);
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalledOnce());
    const disposing = manager.dispose(params.session_id);
    started.resolve(createAcpSession({ dispose }));
    await Promise.all([starting, disposing]);

    try {
      expect(dispose).toHaveBeenCalledOnce();
      expect(manager.has(params.session_id)).toBe(false);
      expect(sent.some((message) => message.type === "session.ready")).toBe(false);
      expect(sent.filter((message) => message.type === "session.disposed")).toHaveLength(1);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("serializes prompts within one ACP session", async () => {
    const promptReleases: Array<Deferred<void>> = [];
    const promptInputs: unknown[] = [];
    const session = createAcpSession({
      prompt(input) {
        promptInputs.push(input);
        const release = deferred<void>();
        promptReleases.push(release);
        return (async function* () {
          await release.promise;
        })();
      },
    });
    mocks.runtimeStart.mockResolvedValue(session);
    const manager = new SessionManager(() => undefined);
    const params = sessionParams("session-serialized-prompts");
    await manager.start(params);

    const first = manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-1",
      text: "first",
    });
    await vi.waitFor(() => expect(promptInputs).toHaveLength(1));
    const second = manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-2",
      text: "second",
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 75));
    const concurrentPromptCount = promptInputs.length;
    promptReleases[0]!.resolve();
    await vi.waitFor(() => expect(promptInputs).toHaveLength(2));
    promptReleases[1]!.resolve();
    await Promise.all([first, second]);

    try {
      expect(concurrentPromptCount).toBe(1);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("injects steering through the negotiated ACP extension instead of opening a concurrent prompt", async () => {
    const session = createAcpSession();
    const steer = vi.fn(async () => "injected" as const);
    session.steer = steer;
    mocks.runtimeStart.mockResolvedValue(session);
    const manager = new SessionManager(() => undefined);
    const params = sessionParams("session-steering");
    await manager.start(params);

    try {
      await expect(manager.steer(params.session_id, "Use the latest tool output"))
        .resolves.toBe("injected");
      expect(steer).toHaveBeenCalledWith([
        { type: "text", text: "Use the latest tool output" },
      ]);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("owns the out-of-band turn started by steering until harness activity becomes idle", async () => {
    let publishOutOfBand: ((event: unknown) => void) | undefined;
    const session = createAcpSession();
    session.steer = vi.fn(async () => "startedNewTurn" as const);
    Object.assign(session, { supportsSteering: true });
    mocks.runtimeStart.mockImplementation(async (options: SessionOptions) => {
      publishOutOfBand = options.onOutOfBandSessionUpdate;
      return session;
    });
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = {
      ...sessionParams("session-steering-new-turn"),
      agent_id: "codex-acp",
    };
    await manager.start(params);

    let settled = false;
    const steering = manager
      .steer(params.session_id, "Continue independently", "turn-steering-new")
      .then((outcome) => {
        settled = true;
        return outcome;
      });
    await nextTask();

    expect(settled).toBe(false);
    publishOutOfBand?.({
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: "new turn output" },
    });
    publishOutOfBand?.({
      sessionUpdate: "session_info_update",
      _meta: { codex: { threadStatus: { type: "idle" } } },
    });

    try {
      await expect(steering).resolves.toBe("startedNewTurn");
      expect(sent).toContainEqual(expect.objectContaining({
        type: "session.event",
        session_id: params.session_id,
        turn_id: "turn-steering-new",
        event: expect.objectContaining({ sessionUpdate: "agent_message_chunk" }),
      }));
      expect(sent).toContainEqual(expect.objectContaining({
        type: "session.complete",
        session_id: params.session_id,
        turn_id: "turn-steering-new",
      }));
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("cancels a steering-started out-of-band turn through ACP and persists a cancelled terminal", async () => {
    let publishOutOfBand: ((event: unknown) => void) | undefined;
    const session = createAcpSession();
    session.steer = vi.fn(async () => "startedNewTurn" as const);
    session.cancelCurrentTurn = vi.fn(async () => undefined);
    Object.assign(session, { supportsSteering: true });
    mocks.runtimeStart.mockImplementation(async (options: SessionOptions) => {
      publishOutOfBand = options.onOutOfBandSessionUpdate;
      return session;
    });
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = {
      ...sessionParams("session-cancel-steering-new-turn"),
      agent_id: "codex-acp",
    };
    await manager.start(params);

    const steering = manager.steer(
      params.session_id,
      "Continue independently",
      "turn-steering-cancelled",
    );
    await nextTask();
    manager.cancel(params.session_id, "turn-steering-cancelled");

    expect(session.cancelCurrentTurn).toHaveBeenCalledOnce();
    publishOutOfBand?.({
      sessionUpdate: "session_info_update",
      _meta: { codex: { threadStatus: { type: "idle" } } },
    });

    try {
      await steering;
      expect(sent).toContainEqual(expect.objectContaining({
        type: "session.complete",
        session_id: params.session_id,
        turn_id: "turn-steering-cancelled",
        stop_reason: "cancelled",
      }));
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("ends an ACP promptError as a redacted session error", async () => {
    const session = createAcpSession({
      prompt() {
        return (async function* () {
          yield {
            type: "promptError",
            error: "RequestError: Invalid params; secret provider response",
          };
        })();
      },
    });
    mocks.runtimeStart.mockResolvedValue(session);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-prompt-error");
    await manager.start(params);

    await manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-prompt-error",
      text: "do the work",
    });

    try {
      expect(
        sent.filter(
          (message) =>
            (message.type === "session.complete" ||
              message.type === "session.error") &&
            message.turn_id === "turn-prompt-error",
        ),
      ).toEqual([
        {
          type: "session.error",
          session_id: params.session_id,
          turn_id: "turn-prompt-error",
          message: "Agent prompt failed",
        },
      ]);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("keeps the ACP prompt response on the turn completion boundary", async () => {
    const session = createAcpSession({
      prompt() {
        return (async function* () {
          yield {
            type: "promptComplete",
            response: {
              stopReason: "max_tokens",
              usage: {
                totalTokens: 34,
                inputTokens: 21,
                outputTokens: 13,
              },
              _meta: { providerRequestId: "request-17" },
            },
          };
        })();
      },
    });
    mocks.runtimeStart.mockResolvedValue(session);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-prompt-stop-reason");
    await manager.start(params);

    await manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-prompt-stop-reason",
      text: "write until the limit",
    });

    try {
      expect(
        sent.filter(
          (message) =>
            message.type === "session.complete" &&
            message.turn_id === "turn-prompt-stop-reason",
        ),
      ).toEqual([
        {
          type: "session.complete",
          session_id: params.session_id,
          turn_id: "turn-prompt-stop-reason",
          stop_reason: "max_tokens",
          usage: {
            totalTokens: 34,
            inputTokens: 21,
            outputTokens: 13,
          },
          meta: { providerRequestId: "request-17" },
        },
      ]);
    } finally {
      await manager.dispose(params.session_id);
    }
  });

  it("emits no late turn completion after disposal", async () => {
    const promptDone = deferred<void>();
    const session = createAcpSession({
      prompt() {
        return (async function* () {
          await promptDone.promise;
        })();
      },
    });
    mocks.runtimeStart.mockResolvedValue(session);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-dispose-dominates-turn");
    await manager.start(params);

    const prompting = manager.prompt({
      session_id: params.session_id,
      turn_id: "turn-disposed",
      text: "keep working",
    });
    await nextTask();
    await manager.dispose(params.session_id);
    promptDone.resolve();
    await prompting;

    const disposedAt = sent.findIndex((message) => message.type === "session.disposed");
    expect(disposedAt).toBeGreaterThanOrEqual(0);
    expect(sent.slice(disposedAt + 1)).not.toContainEqual(
      expect.objectContaining({
        type: expect.stringMatching(/^session\.(complete|error)$/),
        turn_id: "turn-disposed",
      }),
    );
  });

  it("keeps disposeAll pending until in-flight starts are reaped", async () => {
    const started = deferred<AcpSession>();
    const dispose = vi.fn(async () => undefined);
    mocks.runtimeStart.mockReturnValue(started.promise);
    const sent: ManagerOut[] = [];
    const manager = new SessionManager((message) => sent.push(message));
    const params = sessionParams("session-shutdown-during-start");

    const starting = manager.start(params);
    await vi.waitFor(() => expect(mocks.runtimeStart).toHaveBeenCalledOnce());
    let shutdownSettled = false;
    const shutdown = manager.disposeAll().then(() => {
      shutdownSettled = true;
    });
    await nextTask();
    const settledBeforeStartResolved = shutdownSettled;
    started.resolve(createAcpSession({ dispose }));
    await Promise.all([starting, shutdown]);

    expect(settledBeforeStartResolved).toBe(false);
    expect(dispose).toHaveBeenCalledOnce();
    expect(manager.has(params.session_id)).toBe(false);
    expect(sent.some((message) => message.type === "session.ready")).toBe(false);
  });
});
