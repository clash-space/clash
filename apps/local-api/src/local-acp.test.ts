import { describe, expect, it, vi } from "vitest";
import { createLocalAcpAdapter, type SessionManagerLike, type SessionSender } from "./local-acp";

describe("local ACP adapter", () => {
  it("reports the desktop local runtime from detected ACP agents", async () => {
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
      ],
      hostname: () => "This Mac",
      osTag: () => "darwin/arm64",
      nowSeconds: () => 1_700_000_000,
    });

    await expect(adapter.listRuntimes()).resolves.toEqual({
      runtimes: [
        {
          id: "desktop-local",
          machine_id: "desktop-local",
          hostname: "This Mac",
          os: "darwin/arm64",
          agents: [{ id: "codex-cli", binary: "codex" }],
          version: "desktop",
          status: "online",
          last_heartbeat: 1_700_000_000,
          created_at: 1_700_000_000,
        },
      ],
    });
  });

  it("starts ACP sessions with the first detected local agent", async () => {
    const start = vi.fn<SessionManagerLike["start"]>(async () => undefined);
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
      ],
      createSessionManager: () => ({ start, prompt: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }),
      createSessionId: () => "local-acp-session-1",
    });

    await expect(adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "director",
      projectId: "project-1",
      resumeAcpSessionId: "acp-existing",
    })).resolves.toEqual({ session_id: "local-acp-session-1" });

    expect(start).toHaveBeenCalledWith({
      session_id: "local-acp-session-1",
      crew_id: "director",
      agent_id: "codex-cli",
      project_id: "project-1",
      resume: { acp_session_id: "acp-existing" },
    });
  });

  it("prefers Codex over API-key-only ACP agents by default", async () => {
    const start = vi.fn<SessionManagerLike["start"]>(async () => undefined);
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "claude-agent-acp",
          label: "Claude Agent ACP",
          spec: { command: "claude-agent-acp" },
        },
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
      ],
      createSessionManager: () => ({ start, prompt: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }),
      createSessionId: () => "local-acp-session-preferred",
    });

    await adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "director",
      projectId: "project-1",
    });

    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: "codex-cli",
    }));
  });

  it("starts ACP sessions with the requested local agent override", async () => {
    const start = vi.fn<SessionManagerLike["start"]>(async () => undefined);
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
        {
          id: "claude-code-acp",
          label: "Claude Code",
          spec: { command: "claude-code-acp" },
        },
      ],
      createSessionManager: () => ({ start, prompt: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }),
      createSessionId: () => "local-acp-session-agent",
    });

    await expect(adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "generator",
      crewMemberId: "local-generator",
      agentId: "claude-code-acp",
      projectId: "project-1",
    })).resolves.toEqual({ session_id: "local-acp-session-agent" });

    expect(start).toHaveBeenCalledWith({
      session_id: "local-acp-session-agent",
      crew_id: "generator",
      agent_id: "claude-code-acp",
      crew_member_id: "local-generator",
      project_id: "project-1",
    });
  });

  it("injects desktop local API env into spawned agent sessions", async () => {
    const setSpawnEnv = vi.fn<NonNullable<SessionManagerLike["setSpawnEnv"]>>();
    const start = vi.fn<SessionManagerLike["start"]>(async () => undefined);
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-app-server",
          label: "Codex",
          spec: { command: "node", args: ["codex-app-server-acp.js"] },
        },
      ],
      spawnEnv: {
        CLASH_API_URL: "http://127.0.0.1:49396",
        CLASH_API_KEY: "clsh_local_desktop",
      },
      createSessionManager: () => ({
        setSpawnEnv,
        start,
        prompt: vi.fn(),
        cancel: vi.fn(),
        dispose: vi.fn(),
      }),
      createSessionId: () => "local-acp-session-env",
    });

    await adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "director",
      crewMemberId: "local-director",
      projectId: "project-env",
    });

    expect(setSpawnEnv).toHaveBeenCalledWith({
      CLASH_API_URL: "http://127.0.0.1:49396",
      CLASH_API_KEY: "clsh_local_desktop",
    });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      agent_id: "codex-app-server",
      crew_member_id: "local-director",
      project_id: "project-env",
    }));
  });

  it("pushes room mentions to the matching project crew session", async () => {
    const start = vi.fn<SessionManagerLike["start"]>(async () => undefined);
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
      ],
      createSessionManager: () => ({ start, prompt: vi.fn(), cancel: vi.fn(), dispose: vi.fn() }),
      createSessionId: () => "local-acp-session-mentioned",
    });

    await adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "director",
      crewMemberId: "local-director",
      projectId: "project-room",
    });

    const send = vi.fn();
    const ws = {
      OPEN: 1,
      readyState: 1,
      send,
      on: vi.fn(),
      close: vi.fn(),
    } as any;
    adapter.bindSessionSocket("local-acp-session-mentioned", ws);
    send.mockClear();

    await expect(adapter.pushRoomMention("project-room", "local-director", {
      message_id: "room-msg-1",
      from_kind: "user",
      from_id: "local-user",
      from_user_id: "local-user",
      text: "hello director",
    })).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: "room.mention",
      message_id: "room-msg-1",
      from_kind: "user",
      from_id: "local-user",
      from_user_id: "local-user",
      text: "hello director",
    }));
  });

  it("records local prompt and crew events as session history rows", async () => {
    let sendToBrowser!: SessionSender;
    const prompt = vi.fn<SessionManagerLike["prompt"]>(async ({ session_id, turn_id }) => {
      sendToBrowser({
        type: "session.event",
        session_id,
        turn_id,
        event: { type: "text", text: "agent reply" },
      });
      sendToBrowser({ type: "session.complete", session_id, turn_id });
    });
    const adapter = createLocalAcpAdapter({
      detectAgents: async () => [
        {
          id: "codex-cli",
          label: "Codex CLI",
          spec: { command: "codex", args: ["--acp"] },
        },
      ],
      createSessionManager: (send) => {
        sendToBrowser = send;
        return { start: vi.fn(), prompt, cancel: vi.fn(), dispose: vi.fn() };
      },
      createSessionId: () => "local-acp-session-history",
      nowSeconds: (() => {
        let now = 1_700_000_000;
        return () => now++;
      })(),
    });
    await adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "director",
      crewMemberId: "local-director",
      projectId: "project-history",
    });

    const ws = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn(),
      on: vi.fn(),
      close: vi.fn(),
    } as any;
    adapter.bindSessionSocket("local-acp-session-history", ws);
    const messageHandler = ws.on.mock.calls.find(([event]: [string]) => event === "message")?.[1];
    expect(messageHandler).toBeTypeOf("function");

    messageHandler(Buffer.from(JSON.stringify({
      type: "prompt",
      turn_id: "turn-1",
      text: "hello agent",
    })));
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(adapter.listSessionMessages("local-acp-session-history")).resolves.toEqual({
      messages: [
        {
          id: "turn-1-user",
          sender_kind: "user",
          sender_id: "local-user",
          turn_id: "turn-1",
          events: [{ type: "text", text: "hello agent" }],
          created_at: 1_700_000_000,
        },
        {
          id: "turn-1-crew",
          sender_kind: "crew",
          sender_id: "local-director",
          turn_id: "turn-1",
          events: [{ type: "text", text: "agent reply" }],
          created_at: 1_700_000_001,
        },
      ],
    });
  });
});
