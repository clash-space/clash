import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
  type Agent,
  type ContentBlock,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";
import { AcpSessionImpl } from "./session.js";
import type { ChildHandle, SessionOptions } from "./types.js";

type LegacyMultiRootSessionOptions = SessionOptions & {
  additionalDirectories: string[];
};

describe("Backchat ACP runtime parity", () => {
  it("forwards adapter request metadata through session/new", async () => {
    let newSessionRequest:
      | { _meta?: Record<string, unknown> | null }
      | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession(params) {
        newSessionRequest = params;
        return { sessionId: "adapter-meta-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "adapter-meta-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        sessionRequestMeta: {
          claudeCode: {
            emitRawSDKMessages: [
              { type: "system", subtype: "task_notification" },
            ],
          },
        },
      },
    });

    await session.init();
    await session.dispose();

    expect(newSessionRequest?._meta).toEqual({
      claudeCode: {
        emitRawSDKMessages: [
          { type: "system", subtype: "task_notification" },
        ],
      },
    });
  });

  it("keeps Clash session/new single-root when an agent advertises secondary roots", async () => {
    let newSessionRequest:
      | { cwd: string; additionalDirectories?: string[] }
      | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { additionalDirectories: {} },
          },
        };
      },
      async newSession(params) {
        newSessionRequest = params;
        return { sessionId: "multi-root-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "multi-root-session",
      options: {
        agent: { command: "fake-agent", cwd: "/work/main" },
        additionalDirectories: ["/work/docs", "/work/backend"],
      } as LegacyMultiRootSessionOptions,
    });

    await session.init();
    await session.dispose();

    expect(newSessionRequest).toEqual({
      cwd: "/work/main",
      mcpServers: [],
    });
  });

  it("does not send additionalDirectories when the agent has not advertised support", async () => {
    let newSessionRequest:
      | { cwd: string; additionalDirectories?: string[] }
      | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession(params) {
        newSessionRequest = params;
        return { sessionId: "single-root-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "single-root-session",
      options: {
        agent: { command: "fake-agent", cwd: "/work/main" },
        additionalDirectories: ["/work/docs"],
      } as LegacyMultiRootSessionOptions,
    });

    await session.init();
    await session.dispose();

    expect(newSessionRequest).toEqual({
      cwd: "/work/main",
      mcpServers: [],
    });
  });

  it("exposes the legacy-compatible mode state returned by session/new", async () => {
    const modes = {
      currentModeId: "ask",
      availableModes: [
        { id: "ask", name: "Ask" },
        { id: "code", name: "Code" },
      ],
    };
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "new-modes-session", modes };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "new-modes-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const observed = (session as AcpSessionImpl & { modes?: unknown }).modes;
    await session.dispose();

    expect(observed).toEqual(modes);
  });

  it("preserves adapter metadata returned by session/new", async () => {
    const setupMeta = {
      piAcp: { startupInfo: "Loaded AGENTS.md" },
    };
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "new-meta-session", _meta: setupMeta };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "new-meta-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const observed = session.sessionSetupMeta;
    await session.dispose();

    expect(observed).toEqual(setupMeta);
  });

  it("exposes the legacy-compatible mode state returned by session/load", async () => {
    const modes = {
      currentModeId: "review",
      availableModes: [
        { id: "review", name: "Review" },
        { id: "code", name: "Code" },
      ],
    };
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { loadSession: true },
        };
      },
      async loadSession() {
        return { modes };
      },
      async newSession() {
        throw new Error("session/new must not be used after a successful load");
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "load-modes-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-modes-session",
      },
    });

    await session.init();
    const observed = (session as AcpSessionImpl & { modes?: unknown }).modes;
    await session.dispose();

    expect(observed).toEqual(modes);
  });

  it("prefers ACP session/resume over replaying history through session/load", async () => {
    let resumeRequest:
      | { sessionId: string; cwd: string; additionalDirectories?: string[] }
      | undefined;
    let loadCalls = 0;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            loadSession: true,
            sessionCapabilities: {
              resume: {},
              additionalDirectories: {},
            },
          },
        };
      },
      async resumeSession(params) {
        resumeRequest = params;
        return {
          _meta: { piAcp: { startupInfo: "Resumed context" } },
          configOptions: [],
          modes: {
            currentModeId: "code",
            availableModes: [{ id: "code", name: "Code" }],
          },
        };
      },
      async loadSession() {
        loadCalls += 1;
        return {};
      },
      async newSession() {
        throw new Error("session/new must not run after resume succeeds");
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "resume-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-session",
        additionalDirectories: ["/tmp/docs"],
      } as LegacyMultiRootSessionOptions,
    });

    await session.init();
    const observedModes = session.modes;
    const observedSetupMeta = session.sessionSetupMeta;
    await session.dispose();

    expect(resumeRequest).toEqual({
      sessionId: "existing-session",
      cwd: "/tmp/openma",
      mcpServers: [],
    });
    expect(loadCalls).toBe(0);
    expect(observedModes?.currentModeId).toBe("code");
    expect(observedSetupMeta).toEqual({
      piAcp: { startupInfo: "Resumed context" },
    });
  });

  it("closes a negotiated ACP session before disposing its process", async () => {
    const lifecycle: string[] = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { close: {} },
          },
        };
      },
      async newSession() {
        return { sessionId: "close-session" };
      },
      async closeSession(params) {
        lifecycle.push(`close:${params.sessionId}`);
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const child = {
      ...harness.child,
      async kill(signal?: "SIGTERM" | "SIGKILL") {
        lifecycle.push(`kill:${signal}`);
        await harness.child.kill(signal);
      },
    };
    const session = new AcpSessionImpl({
      child,
      id: "close-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await session.dispose();

    expect(lifecycle).toEqual(["close:close-session", "kill:SIGTERM"]);
  });

  it("exposes the legacy-compatible mode state returned by session/fork", async () => {
    const modes = {
      currentModeId: "architect",
      availableModes: [
        { id: "architect", name: "Architect" },
        { id: "code", name: "Code" },
      ],
    };
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: { sessionCapabilities: { fork: {} } },
        };
      },
      async unstable_forkSession() {
        return { sessionId: "forked-modes-session", modes };
      },
      async newSession() {
        throw new Error("session/new must not be used after a successful fork");
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "fork-modes-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        forkFromAcpSessionId: "parent-session",
      },
    });

    await session.init();
    const observed = (session as AcpSessionImpl & { modes?: unknown }).modes;
    await session.dispose();

    expect(observed).toEqual(modes);
  });

  it("updates the exposed legacy mode state after session/set_mode succeeds", async () => {
    let setModeRequest: { sessionId: string; modeId: string } | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return {
          sessionId: "set-mode-session",
          modes: {
            currentModeId: "ask",
            availableModes: [
              { id: "ask", name: "Ask" },
              { id: "code", name: "Code" },
            ],
          },
        };
      },
      async setSessionMode(params) {
        setModeRequest = params;
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "set-mode-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await session.setMode("code");
    const observed = session.modes;
    await session.dispose();

    expect(setModeRequest).toEqual({ sessionId: "set-mode-session", modeId: "code" });
    expect(observed?.currentModeId).toBe("code");
  });

  it("exposes steering only when the agent negotiates the extension capability", async () => {
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    expect(session.supportsSteering).toBe(true);
    await session.dispose();
  });

  it("sends negotiated steering through the extension method", async () => {
    let steeringRequest:
      | { method: string; params: Record<string, unknown> }
      | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod(method, params) {
        steeringRequest = { method, params };
        return { outcome: "injected" };
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    const blocks: ContentBlock[] = [
      { type: "text", text: "change direction" },
      { type: "resource_link", uri: "file:///tmp/brief.md", name: "brief" },
    ];

    await session.init();
    expect(typeof session.steer).toBe("function");
    const outcome = await session.steer(blocks);
    await session.dispose();

    expect(outcome).toBe("injected");
    expect(steeringRequest).toEqual({
      method: "_session/steering",
      params: {
        sessionId: "steering-session",
        prompt: blocks,
        _meta: { steering: { idleBehavior: "promptRequired" } },
      },
    });
  });

  it("refuses to send steering when the agent did not negotiate it", async () => {
    let extensionCalls = 0;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "plain-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        extensionCalls += 1;
        return { outcome: "injected" };
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "plain-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await expect(session.steer("do not send")).rejects.toThrow(
      "ACP agent did not negotiate _session/steering",
    );
    expect(extensionCalls).toBe(0);
    await session.dispose();
  });

  it("rejects an invalid steering extension outcome", async () => {
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "invalid-steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        return { outcome: "unexpected" };
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "invalid-steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await expect(session.steer("change direction")).rejects.toThrow(
      "Invalid _session/steering outcome: unexpected",
    );
    await session.dispose();
  });

  it("accepts the failed outcome used by Codex steering", async () => {
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "failed-steering-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        return { outcome: "failed" };
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "failed-steering-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await expect(session.steer("change direction")).resolves.toBe("failed");
    await session.dispose();
  });

  it("delivers post-init session updates emitted outside a prompt", async () => {
    const outOfBandUpdates: unknown[] = [];
    const harness = createHarness((conn) => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          _meta: { steering: { supported: true } },
        };
      },
      async newSession() {
        return { sessionId: "out-of-band-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
      async extMethod() {
        await conn.sessionUpdate({
          sessionId: "out-of-band-session",
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "background answer" },
          },
        });
        await conn.sessionUpdate({
          sessionId: "out-of-band-session",
          update: {
            sessionUpdate: "session_info_update",
            _meta: { codex: { threadStatus: { type: "idle" } } },
          },
        });
        return { outcome: "startedNewTurn" };
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "out-of-band-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        onOutOfBandSessionUpdate: (update) => outOfBandUpdates.push(update),
      },
    });

    await session.init();
    await expect(session.steer("continue after the race")).resolves.toBe(
      "startedNewTurn",
    );
    await session.dispose();

    expect(outOfBandUpdates).toEqual([
      {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "background answer" },
      },
      {
        sessionUpdate: "session_info_update",
        _meta: { codex: { threadStatus: { type: "idle" } } },
      },
    ]);
  });

  it("can send ACP session/cancel for an extension-owned background turn", async () => {
    let cancelRequest: { sessionId: string } | undefined;
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "background-turn-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel(params) {
        cancelRequest = params;
      },
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "background-turn-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const cancelCurrentTurn = (
      session as AcpSessionImpl & {
        cancelCurrentTurn?: () => Promise<void>;
      }
    ).cancelCurrentTurn;
    if (typeof cancelCurrentTurn !== "function") {
      await session.dispose();
      expect(cancelCurrentTurn).toBeTypeOf("function");
      return;
    }
    await cancelCurrentTurn.call(session);
    await session.dispose();

    expect(cancelRequest).toEqual({ sessionId: "background-turn-session" });
  });

  it("advertises supported ACP projections and nested transcript extensions during initialize", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    const harness = createHarness((conn) => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "nested-transcript-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "nested-transcript-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      session: {
        configOptions: {
          boolean: {},
        },
      },
      plan: {},
      _meta: {
        "subagent-transcript": true,
        terminal_output: true,
      },
    });
  });

  it("merges host capabilities without dropping Backchat or Clash extension support", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    const harness = createHarness(() => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "merged-client-capabilities-session" };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "merged-client-capabilities-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCapabilities: {
          auth: { terminal: true },
          _meta: { hostCapability: true },
        } as never,
      },
    });

    await session.init();
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      auth: { terminal: true },
      session: { configOptions: { boolean: {} } },
      plan: {},
      _meta: {
        hostCapability: true,
        "subagent-transcript": true,
        "terminal-auth": true,
        terminal_output: true,
        parameterizedModelPicker: true,
      },
    });
  });

  it("retains the complete ACP initialize response for canonical session capabilities", async () => {
    const agentCapabilities = {
      loadSession: true,
      promptCapabilities: { image: true, embeddedContext: true },
      mcpCapabilities: { http: true, sse: false },
      sessionCapabilities: {
        list: {},
        delete: {},
        resume: {},
        close: {},
        additionalDirectories: {},
      },
      auth: { logout: {} },
      _meta: { "vendor.dev/capability": true },
    };
    const initializeMeta = {
      steering: { supported: true },
      "vendor.dev/runtime": { build: "2026.08" },
    };
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentInfo: { name: "fixture-agent", version: "1.2.3" },
          agentCapabilities,
          _meta: initializeMeta,
        };
      },
      async newSession() {
        return { sessionId: "initialize-evidence-session" };
      },
      async closeSession() {
        return {};
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "initialize-evidence-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const evidence = {
      protocolVersion: (session as AcpSessionImpl & { protocolVersion?: unknown }).protocolVersion,
      agentInfo: session.agentInfo,
      agentCapabilities: (session as AcpSessionImpl & { agentCapabilities?: unknown }).agentCapabilities,
      initializeMeta: (session as AcpSessionImpl & { initializeMeta?: unknown }).initializeMeta,
    };
    await session.dispose();

    expect(evidence).toEqual({
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: "fixture-agent", version: "1.2.3" },
      agentCapabilities,
      initializeMeta,
    });
  });

  it("uses the ACP session lifecycle and streams only the active prompt", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION, agentCapabilities: { loadSession: true } };
      },
      async loadSession(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "replayed history" },
          },
        });
        return {};
      },
      async newSession() {
        throw new Error("newSession must not be used when loading is supported");
      },
      async prompt(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "fresh answer" },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));

    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-acp-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        resumeAcpSessionId: "existing-session",
        mcpServers: [],
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("continue")) events.push(event);
    await session.dispose();

    expect(session.acpSessionId).toBe("existing-session");
    expect(events).toContainEqual(
      expect.objectContaining({
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "fresh answer" },
      }),
    );
    expect(events).not.toContainEqual(
      expect.objectContaining({ content: { type: "text", text: "replayed history" } }),
    );
  });

  it("preserves notification-scoped ACP metadata without overwriting update metadata", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "notification-meta-session" };
      },
      async prompt(params) {
        await conn.sessionUpdate({
          sessionId: params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "hello" },
            _meta: { claudeCode: { parentToolUseId: "task-1" } },
          },
          _meta: {
            traceparent: "00-abc-def-01",
            "vendor.dev/notification": { sequence: 7 },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "notification-meta-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("hello")) events.push(event);
    await session.dispose();

    expect(events).toContainEqual(expect.objectContaining({
      sessionUpdate: "agent_message_chunk",
      _meta: { claudeCode: { parentToolUseId: "task-1" } },
      "_openma.acp.notification": {
        session_id: "notification-meta-session",
        meta: {
          traceparent: "00-abc-def-01",
          "vendor.dev/notification": { sequence: 7 },
        },
      },
    }));
  });

  it("retains an agent-to-client ACP extension notification as an adapter event", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "extension-notification-session" };
      },
      async prompt() {
        await conn.extNotification("_vendor.dev/background_progress", {
          sessionId: "extension-notification-session",
          taskId: "task-7",
          progress: 0.5,
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "extension-notification-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("run")) events.push(event);
    await session.dispose();

    expect(events).toContainEqual({
      type: "acp.extension_notification",
      method: "_vendor.dev/background_progress",
      params: {
        sessionId: "extension-notification-session",
        taskId: "task-7",
        progress: 0.5,
      },
    });
    expect(events).toContainEqual({
      type: "acp.client_notification",
      method: "_vendor.dev/background_progress",
      params: {
        sessionId: "extension-notification-session",
        taskId: "task-7",
        progress: 0.5,
      },
    });
  });

  it("retains an unsupported agent-to-client extension request before returning method-not-found", async () => {
    let rejectionCode: number | undefined;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "unsupported-extension-request-session" };
      },
      async prompt() {
        try {
          await conn.extMethod("cursor/task", {
            toolCallId: "task-call-1",
            agentId: "cursor-child-1",
            subagentType: "explore",
          });
        } catch (error) {
          rejectionCode = (error as { code?: number }).code;
        }
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "unsupported-extension-request-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("run")) events.push(event);
    await session.dispose();

    expect(rejectionCode).toBe(-32601);
    expect(events).toContainEqual({
      type: "acp.extension_request",
      method: "cursor/task",
      params: {
        toolCallId: "task-call-1",
        agentId: "cursor-child-1",
        subagentType: "explore",
      },
    });
    expect(events).toContainEqual({
      type: "acp.client_error",
      requestId: "client-request-1",
      method: "cursor/task",
      error: {
        code: -32601,
        message: "Method not found",
      },
    });
  });

  it("delegates an agent-to-client ACP extension request to the host adapter", async () => {
    let response: Record<string, unknown> | undefined;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "extension-request-session" };
      },
      async prompt() {
        response = await conn.extMethod("_vendor.dev/subagent_message", {
          childId: "agent-2",
          text: "new direction",
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "extension-request-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          extensionRequest: async (method, params) => ({
            accepted: method === "_vendor.dev/subagent_message",
            childId: params.childId,
          }),
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("message child")) events.push(event);
    await session.dispose();

    expect(response).toEqual({ accepted: true, childId: "agent-2" });
    expect(events).toContainEqual({
      type: "acp.client_request",
      requestId: "client-request-1",
      method: "_vendor.dev/subagent_message",
      params: { childId: "agent-2", text: "new direction" },
    });
    expect(events).toContainEqual({
      type: "acp.client_response",
      requestId: "client-request-1",
      method: "_vendor.dev/subagent_message",
      result: { accepted: true, childId: "agent-2" },
    });
  });

  it("retains every standard agent-to-client callback request and response in the session event stream", async () => {
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "callback-audit-session" };
      },
      async prompt() {
        await conn.requestPermission({
          sessionId: "callback-audit-session",
          toolCall: {
            toolCallId: "permission-tool",
            title: "Permission tool",
          },
          options: [{
            kind: "allow_once",
            name: "Allow once",
            optionId: "allow",
          }],
        });
        await conn.readTextFile({
          sessionId: "callback-audit-session",
          path: "/tmp/openma/input.txt",
        });
        await conn.writeTextFile({
          sessionId: "callback-audit-session",
          path: "/tmp/openma/output.txt",
          content: "written",
        });
        const terminal = await conn.createTerminal({
          sessionId: "callback-audit-session",
          command: "printf",
          args: ["hello"],
        });
        await terminal.currentOutput();
        await terminal.waitForExit();
        await terminal.kill();
        await terminal.release();
        await conn.unstable_createElicitation({
          mode: "form",
          sessionId: "callback-audit-session",
          message: "Choose",
          requestedSchema: {
            type: "object",
            properties: {
              answer: { type: "string" },
            },
          },
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "callback-audit-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          requestPermission: async () => ({
            outcome: { outcome: "selected", optionId: "allow" },
          }),
          readTextFile: async () => ({ content: "read" }),
          writeTextFile: async () => ({}),
          createTerminal: async () => ({ terminalId: "terminal-1" }),
          terminalOutput: async () => ({
            output: "hello",
            truncated: false,
            exitStatus: { exitCode: 0, signal: null },
          }),
          waitForTerminalExit: async () => ({ exitCode: 0, signal: null }),
          killTerminal: async () => ({}),
          releaseTerminal: async () => ({}),
          createElicitation: async () => ({
            action: "accept",
            content: { answer: "yes" },
          }),
        },
      },
    });

    await session.init();
    const events: Array<Record<string, unknown>> = [];
    for await (const event of session.prompt("audit callbacks")) {
      events.push(event as Record<string, unknown>);
    }
    await session.dispose();

    const lifecycle = events
      .filter((event) =>
        event.type === "acp.client_request"
        || event.type === "acp.client_response")
      .map((event) => ({
        type: event.type,
        requestId: event.requestId,
        method: event.method,
      }));
    expect(lifecycle).toEqual([
      { type: "acp.client_request", requestId: "client-request-1", method: "session/request_permission" },
      { type: "acp.client_response", requestId: "client-request-1", method: "session/request_permission" },
      { type: "acp.client_request", requestId: "client-request-2", method: "fs/read_text_file" },
      { type: "acp.client_response", requestId: "client-request-2", method: "fs/read_text_file" },
      { type: "acp.client_request", requestId: "client-request-3", method: "fs/write_text_file" },
      { type: "acp.client_response", requestId: "client-request-3", method: "fs/write_text_file" },
      { type: "acp.client_request", requestId: "client-request-4", method: "terminal/create" },
      { type: "acp.client_response", requestId: "client-request-4", method: "terminal/create" },
      { type: "acp.client_request", requestId: "client-request-5", method: "terminal/output" },
      { type: "acp.client_response", requestId: "client-request-5", method: "terminal/output" },
      { type: "acp.client_request", requestId: "client-request-6", method: "terminal/wait_for_exit" },
      { type: "acp.client_response", requestId: "client-request-6", method: "terminal/wait_for_exit" },
      { type: "acp.client_request", requestId: "client-request-7", method: "terminal/kill" },
      { type: "acp.client_response", requestId: "client-request-7", method: "terminal/kill" },
      { type: "acp.client_request", requestId: "client-request-8", method: "terminal/release" },
      { type: "acp.client_response", requestId: "client-request-8", method: "terminal/release" },
      { type: "acp.client_request", requestId: "client-request-9", method: "elicitation/create" },
      { type: "acp.client_response", requestId: "client-request-9", method: "elicitation/create" },
    ]);
    expect(events).toContainEqual({
      type: "acp.client_response",
      requestId: "client-request-1",
      method: "session/request_permission",
      result: { outcome: { outcome: "selected", optionId: "allow" } },
    });
  });

  it("retains a failed agent-to-client callback before propagating its ACP error", async () => {
    let readRejected = false;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "callback-error-session" };
      },
      async prompt() {
        try {
          await conn.readTextFile({
            sessionId: "callback-error-session",
            path: "/tmp/openma/missing.txt",
          });
        } catch {
          readRejected = true;
        }
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "callback-error-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          readTextFile: async () => {
            throw new Error("file unavailable");
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("read")) events.push(event);
    await session.dispose();

    expect(readRejected).toBe(true);
    expect(events).toContainEqual({
      type: "acp.client_error",
      requestId: "client-request-1",
      method: "fs/read_text_file",
      error: { message: "file unavailable" },
    });
  });

  it("exposes negotiated ACP session-list, session-delete, logout, and provider inputs", async () => {
    const received: Array<{ method: string; params: unknown }> = [];
    const harness = createHarness(() => ({
      async initialize() {
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            sessionCapabilities: { list: {}, delete: {} },
            auth: { logout: {} },
            providers: {},
          },
        };
      },
      async newSession() {
        return { sessionId: "management-session" };
      },
      async listSessions(params) {
        received.push({ method: "session/list", params });
        return {
          sessions: [{
            sessionId: "listed-session",
            cwd: "/tmp/openma",
            title: "Listed",
          }],
        };
      },
      async deleteSession(params) {
        received.push({ method: "session/delete", params });
        return {};
      },
      async logout(params) {
        received.push({ method: "logout", params });
        return {};
      },
      async unstable_listProviders(params) {
        received.push({ method: "providers/list", params });
        return { providers: [] };
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "management-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    const runtime = session as AcpSessionImpl & {
      supportsSessionList?: boolean;
      supportsSessionDelete?: boolean;
      supportsLogout?: boolean;
      supportsProviders?: boolean;
      listSessions?: (params: { cwd?: string }) => Promise<unknown>;
      deleteSession?: (sessionId: string) => Promise<void>;
      logout?: () => Promise<void>;
      listProviders?: () => Promise<unknown>;
    };

    await session.init();
    const listed = await runtime.listSessions?.({ cwd: "/tmp/openma" });
    await runtime.deleteSession?.("listed-session");
    await runtime.logout?.();
    const providers = await runtime.listProviders?.();
    const capabilities = {
      list: runtime.supportsSessionList,
      delete: runtime.supportsSessionDelete,
      logout: runtime.supportsLogout,
      providers: runtime.supportsProviders,
    };
    await session.dispose();

    expect(capabilities).toEqual({
      list: true,
      delete: true,
      logout: true,
      providers: true,
    });
    expect(listed).toEqual({
      sessions: [{
        sessionId: "listed-session",
        cwd: "/tmp/openma",
        title: "Listed",
      }],
    });
    expect(providers).toEqual({ providers: [] });
    expect(received).toEqual([
      { method: "session/list", params: { cwd: "/tmp/openma" } },
      { method: "session/delete", params: { sessionId: "listed-session" } },
      { method: "logout", params: {} },
      { method: "providers/list", params: {} },
    ]);
  });

  it("sends client-to-agent extension requests and notifications through the shared runtime", async () => {
    const received: Array<{ method: string; params: unknown }> = [];
    const harness = createHarness(() => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "extension-egress-session" };
      },
      async extMethod(method, params) {
        received.push({ method, params });
        return { accepted: true, method };
      },
      async extNotification(method, params) {
        received.push({ method, params });
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "extension-egress-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    const runtime = session as AcpSessionImpl & {
      requestExtension?: (
        method: string,
        params: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>;
      notifyExtension?: (
        method: string,
        params: Record<string, unknown>,
      ) => Promise<void>;
    };

    await session.init();
    const response = await runtime.requestExtension?.("_vendor.dev/control", {
      sessionId: "extension-egress-session",
      action: "pause",
    });
    await runtime.notifyExtension?.("_vendor.dev/observed", {
      sessionId: "extension-egress-session",
      revision: 2,
    });
    await session.dispose();

    expect(response).toEqual({ accepted: true, method: "_vendor.dev/control" });
    expect(received).toEqual([
      {
        method: "_vendor.dev/control",
        params: { sessionId: "extension-egress-session", action: "pause" },
      },
      {
        method: "_vendor.dev/observed",
        params: { sessionId: "extension-egress-session", revision: 2 },
      },
    ]);
  });

  it("advertises and delegates ACP elicitation only when the host supplies its callback lifecycle", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    let elicitationResponse: unknown;
    const completed: unknown[] = [];
    const harness = createHarness((conn) => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "elicitation-session" };
      },
      async prompt() {
        elicitationResponse = await conn.unstable_createElicitation({
          mode: "url",
          sessionId: "elicitation-session",
          message: "Authorize repository access",
          elicitationId: "release-channel",
          url: "https://agent.example.com/connect",
        });
        await conn.unstable_completeElicitation({ elicitationId: "release-channel" });
        await conn.unstable_completeElicitation({ elicitationId: "release-channel" });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "elicitation-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientCallbacks: {
          createElicitation: async () => ({ action: "accept" }),
          completeElicitation: async (params) => {
            completed.push(params);
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("configure release")) events.push(event);
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      elicitation: { form: {}, url: {} },
    });
    expect(elicitationResponse).toEqual({ action: "accept" });
    expect(completed).toEqual([{ elicitationId: "release-channel" }]);
    expect(events).toContainEqual({
      type: "acp.elicitation_complete",
      method: "elicitation/complete",
      params: { elicitationId: "release-channel" },
    });
    expect(events).toContainEqual({
      type: "acp.client_notification",
      method: "elicitation/complete",
      params: { elicitationId: "release-channel" },
    });
    expect(events.filter((event) =>
      (event as { type?: string }).type === "acp.elicitation_complete",
    )).toHaveLength(1);
  });

  it("advertises URL elicitation from explicit host mode support without requiring a completion callback", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    let elicitationResponse: unknown;
    const harness = createHarness((conn) => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "url-elicitation-session" };
      },
      async prompt() {
        elicitationResponse = await conn.unstable_createElicitation({
          mode: "url",
          sessionId: "url-elicitation-session",
          message: "Authorize repository access",
          elicitationId: "url-without-host-callback",
          url: "https://agent.example.com/connect",
        });
        await conn.unstable_completeElicitation({
          elicitationId: "url-without-host-callback",
        });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "url-elicitation-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientElicitationCapabilities: { url: {} },
        clientCallbacks: {
          createElicitation: async () => ({ action: "accept" }),
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("authorize")) events.push(event);
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      elicitation: { url: {} },
    });
    expect(initializeRequest?.clientCapabilities).not.toMatchObject({
      elicitation: { form: {} },
    });
    expect(elicitationResponse).toEqual({ action: "accept" });
    expect(events).toContainEqual({
      type: "acp.elicitation_complete",
      method: "elicitation/complete",
      params: { elicitationId: "url-without-host-callback" },
    });
  });

  it("ignores elicitation completion for an unknown URL interaction", async () => {
    const completed: unknown[] = [];
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "unknown-url-completion-session" };
      },
      async prompt() {
        await conn.unstable_completeElicitation({ elicitationId: "unknown-url" });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "unknown-url-completion-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientElicitationCapabilities: { url: {} },
        clientCallbacks: {
          createElicitation: async () => ({ action: "accept" }),
          completeElicitation: async (params) => {
            completed.push(params);
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("wait for oauth")) events.push(event);
    await session.dispose();

    expect(completed).toEqual([]);
    expect(events).not.toContainEqual({
      type: "acp.elicitation_complete",
      method: "elicitation/complete",
      params: { elicitationId: "unknown-url" },
    });
  });

  it("routes ACP-over-MCP requests and notifications through typed host callbacks", async () => {
    const received: Array<{ method: string; params: unknown }> = [];
    let listed: unknown;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "mcp-over-acp-session" };
      },
      async prompt() {
        const connected = await conn.extMethod("mcp/connect", {
          serverId: "openma-tools",
        });
        const connectionId = String(connected.connectionId);
        listed = await conn.extMethod("mcp/message", {
          connectionId,
          method: "tools/list",
        });
        await conn.extNotification("mcp/message", {
          connectionId,
          method: "notifications/initialized",
        });
        await conn.extMethod("mcp/disconnect", { connectionId });
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "mcp-over-acp-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        mcpServers: [{
          type: "acp",
          name: "OpenMA tools",
          serverId: "openma-tools",
        }],
        clientCallbacks: {
          connectMcp: async (params) => {
            received.push({ method: "mcp/connect", params });
            return { connectionId: "mcp-connection-1" };
          },
          messageMcp: async (params) => {
            received.push({ method: "mcp/message:request", params });
            return { tools: [{ name: "inspect" }] };
          },
          notifyMcp: async (params) => {
            received.push({ method: "mcp/message:notification", params });
          },
          disconnectMcp: async (params) => {
            received.push({ method: "mcp/disconnect", params });
            return {};
          },
        },
      },
    });

    await session.init();
    const events: unknown[] = [];
    for await (const event of session.prompt("list tools")) events.push(event);
    await session.dispose();

    expect(listed).toEqual({ tools: [{ name: "inspect" }] });
    expect(received).toEqual([
      { method: "mcp/connect", params: { serverId: "openma-tools" } },
      {
        method: "mcp/message:request",
        params: { connectionId: "mcp-connection-1", method: "tools/list" },
      },
      {
        method: "mcp/message:notification",
        params: {
          connectionId: "mcp-connection-1",
          method: "notifications/initialized",
        },
      },
      {
        method: "mcp/disconnect",
        params: { connectionId: "mcp-connection-1" },
      },
    ]);
    expect(events).toContainEqual({
      type: "acp.mcp_notification",
      method: "mcp/message",
      params: {
        connectionId: "mcp-connection-1",
        method: "notifications/initialized",
      },
    });
    expect(events).toContainEqual({
      type: "acp.client_notification",
      method: "mcp/message",
      params: {
        connectionId: "mcp-connection-1",
        method: "notifications/initialized",
      },
    });
  });

  it("negotiates and sends the complete ACP NES and document-input lifecycle", async () => {
    let initializeRequest: { clientCapabilities?: Record<string, unknown> } | undefined;
    const received: Array<{ method: string; params: unknown }> = [];
    const harness = createHarness(() => ({
      async initialize(params) {
        initializeRequest = params as typeof initializeRequest;
        return {
          protocolVersion: PROTOCOL_VERSION,
          agentCapabilities: {
            nes: {
              events: {
                document: {
                  didOpen: {},
                  didChange: { syncKind: "full" },
                  didClose: {},
                  didSave: {},
                  didFocus: {},
                },
              },
            },
            positionEncoding: "utf-16",
          },
        };
      },
      async newSession() {
        return { sessionId: "conversation-session" };
      },
      async unstable_startNes(params) {
        received.push({ method: "nes/start", params });
        return { sessionId: "nes-session" };
      },
      async unstable_suggestNes(params) {
        received.push({ method: "nes/suggest", params });
        return { suggestions: [] };
      },
      async unstable_closeNes(params) {
        received.push({ method: "nes/close", params });
        return {};
      },
      async unstable_didOpenDocument(params) {
        received.push({ method: "document/didOpen", params });
      },
      async unstable_didChangeDocument(params) {
        received.push({ method: "document/didChange", params });
      },
      async unstable_didCloseDocument(params) {
        received.push({ method: "document/didClose", params });
      },
      async unstable_didSaveDocument(params) {
        received.push({ method: "document/didSave", params });
      },
      async unstable_didFocusDocument(params) {
        received.push({ method: "document/didFocus", params });
      },
      async unstable_acceptNes(params) {
        received.push({ method: "nes/accept", params });
      },
      async unstable_rejectNes(params) {
        received.push({ method: "nes/reject", params });
      },
      async prompt() {
        return { stopReason: "end_turn" };
      },
      async cancel() {},
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "nes-runtime-session",
      options: {
        agent: { command: "fake-agent", cwd: "/tmp/openma" },
        clientNesCapabilities: {
          jump: {},
          rename: {},
          searchAndReplace: {},
        },
        positionEncodings: ["utf-16"],
      },
    });

    await session.init();
    const started = await session.startNes({
      workspaceUri: "file:///tmp/openma",
      workspaceFolders: [{ uri: "file:///tmp/openma", name: "openma" }],
    });
    const document = {
      sessionId: started.sessionId,
      uri: "file:///tmp/openma/app.ts",
    };
    await session.didOpenDocument({
      ...document,
      languageId: "typescript",
      version: 1,
      text: "const answer = 41;\n",
    });
    await session.didChangeDocument({
      ...document,
      version: 2,
      contentChanges: [{ text: "const answer = 42;\n" }],
    });
    await session.didFocusDocument({
      ...document,
      version: 2,
      position: { line: 0, character: 18 },
      visibleRange: {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      },
    });
    const suggestions = await session.suggestNes({
      ...document,
      version: 2,
      position: { line: 0, character: 18 },
      triggerKind: "manual",
    });
    await session.acceptNes({ sessionId: started.sessionId, id: "suggestion-1" });
    await session.rejectNes({
      sessionId: started.sessionId,
      id: "suggestion-2",
      reason: "replaced",
    });
    await session.didSaveDocument(document);
    await session.didCloseDocument(document);
    await session.closeNes({ sessionId: started.sessionId });
    const capabilities = {
      supportsNes: session.supportsNes,
      nesCapabilities: session.nesCapabilities,
      positionEncoding: session.positionEncoding,
    };
    await session.dispose();

    expect(initializeRequest?.clientCapabilities).toMatchObject({
      nes: { jump: {}, rename: {}, searchAndReplace: {} },
      positionEncodings: ["utf-16"],
    });
    expect(capabilities).toEqual({
      supportsNes: true,
      nesCapabilities: {
        events: {
          document: {
            didOpen: {},
            didChange: { syncKind: "full" },
            didClose: {},
            didSave: {},
            didFocus: {},
          },
        },
      },
      positionEncoding: "utf-16",
    });
    expect(suggestions).toEqual({ suggestions: [] });
    expect(received.map(({ method }) => method)).toEqual([
      "nes/start",
      "document/didOpen",
      "document/didChange",
      "document/didFocus",
      "nes/suggest",
      "nes/accept",
      "nes/reject",
      "document/didSave",
      "document/didClose",
      "nes/close",
    ]);
  });

  it("sends structured content and returns a cancelled stop reason", async () => {
    let received: ContentBlock[] | undefined;
    let cancelCount = 0;
    const harness = createHarness((conn) => ({
      async initialize() {
        return { protocolVersion: PROTOCOL_VERSION };
      },
      async newSession() {
        return { sessionId: "session-1" };
      },
      async prompt(params) {
        received = params.prompt;
        await new Promise<void>((resolve) => {
          const timer = setInterval(() => {
            if (cancelCount > 0) {
              clearInterval(timer);
              resolve();
            }
          }, 1);
        });
        return { stopReason: "cancelled" };
      },
      async cancel() {
        cancelCount += 1;
      },
      async authenticate() {
        return {};
      },
    }));
    const session = new AcpSessionImpl({
      child: harness.child,
      id: "shared-acp-session",
      options: { agent: { command: "fake-agent", cwd: "/tmp/openma" } },
    });
    await session.init();
    const abort = new AbortController();
    const blocks: ContentBlock[] = [
      { type: "text", text: "hello" },
      { type: "resource_link", uri: "file:///tmp/readme.md", name: "readme" },
    ];
    const events: unknown[] = [];
    const draining = (async () => {
      for await (const event of session.prompt(blocks, { abortSignal: abort.signal })) {
        events.push(event);
      }
    })();
    await new Promise((resolve) => setTimeout(resolve, 5));
    abort.abort();
    await draining;
    await session.dispose();

    expect(received).toEqual(blocks);
    expect(cancelCount).toBe(1);
    expect(events).toContainEqual(expect.objectContaining({ type: "promptComplete" }));
  });
});

function createHarness(toAgent: (conn: AgentSideConnection) => Agent): { child: ChildHandle } {
  const clientToAgent = new TransformStream<Uint8Array, Uint8Array>();
  const agentToClient = new TransformStream<Uint8Array, Uint8Array>();
  new AgentSideConnection(
    toAgent,
    ndJsonStream(agentToClient.writable, clientToAgent.readable),
  );
  return {
    child: {
      stdin: clientToAgent.writable,
      stdout: agentToClient.readable,
      stderr: new ReadableStream({ start(controller) { controller.close(); } }),
      exited: Promise.resolve({ code: 0, signal: null }),
      async kill() {
        await Promise.allSettled([
          clientToAgent.writable.close(),
          agentToClient.writable.close(),
        ]);
      },
    },
  };
}
