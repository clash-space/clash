// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClashRuntime } from "./useClashRuntime";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe("useClashRuntime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
    FakeWebSocket.instances = [];
    window.localStorage.clear();
  });

  it("loads runtimes on startup without blocking on agent metadata probes", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ runtimes: [] }), {
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    renderHook(() => useClashRuntime());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls.some(([input, init]) => (
      !init?.method && String(input).endsWith("/api/v1/runtimes")
    ))).toBe(true);
    expect(fetchMock.mock.calls.some(([input, init]) => (
      !init?.method && String(input).includes("/api/v1/runtimes?probe=config")
    ))).toBe(false);
  });

  it("prepares a runtime draft without creating a local session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    act(() => {
      result.current.startDraft("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
        permissionModeId: "codex:full-access",
      });
    });

    expect(result.current.status).toBe("draft");
    expect(result.current.ready).toBe(false);
    expect(result.current.selectedRuntimeId).toBe("desktop-local");
    expect(result.current.selectedAgentId).toBe("codex-acp");
    expect(result.current.sessionId).toBeNull();
    expect(result.current.currentSession).toBeNull();
    expect(result.current.messages).toEqual([]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("creates a local session from a draft only after the first prompt and sends after ready", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-draft" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    act(() => {
      result.current.startDraft("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
      });
      result.current.sendMessage("hi");
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("local-session-draft");
      expect(FakeWebSocket.instances).toHaveLength(1);
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      agent_id: "codex-acp",
      project_id: "project-one",
    });
    expect(result.current.messages).toEqual([
      { id: expect.stringMatching(/^user-t-/), role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
    expect(result.current.status).toBe("connecting");

    const ws = FakeWebSocket.instances.at(-1)!;
    expect(ws.sent).toEqual([]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-draft",
          acp_session_id: "acp-draft-one",
        }),
      });
    });

    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "prompt",
      turn_id: expect.stringMatching(/^t-/),
      text: "hi",
    });
    expect(result.current.messages).toEqual([
      { id: expect.stringMatching(/^user-t-/), role: "user", parts: [{ type: "text", text: "hi" }] },
    ]);
    expect(result.current.status).toBe("sending");
    expect(result.current.currentSession).toMatchObject({
      id: "local-session-draft",
      threadId: "local-session-draft",
      runtimeId: "desktop-local",
      agentId: "codex-acp",
      projectId: "project-one",
      acpSessionId: "acp-draft-one",
    });
  });

  it("shows the runtime create error field from structured local API failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({
          error: "No local agent found. Install or enable an agent in Settings > Runtimes, then retry.",
          mutation: {
            operation: "runtime_session_create",
            entity: { kind: "session", id: "" },
            accepted: false,
          },
        }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe(
      "session create failed: No local agent found. Install or enable an agent in Settings > Runtimes, then retry.",
    );
  });

  it("hydrates persisted Cursor assistant chunks after session complete", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-cursor" }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-cursor/messages") && !init?.method) {
        return new Response(JSON.stringify({
          messages: [
            {
              id: "cursor-user-row",
              sender_kind: "user",
              sender_id: "local-user",
              turn_id: "turn-cursor",
              events: [{ type: "text", text: "Reply exactly: pong" }],
              created_at: 1,
            },
            {
              id: "cursor-agent-row",
              sender_kind: "agent",
              sender_id: "local-agent",
              turn_id: "turn-cursor",
              events: [
                {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "p" },
                },
                {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "ong" },
                },
              ],
              created_at: 2,
            },
          ],
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    act(() => {
      result.current.startDraft("desktop-local", undefined, {
        agentId: "cursor",
        projectId: "project-one",
      });
      result.current.sendMessage("Reply exactly: pong");
    });

    await waitFor(() => {
      expect(result.current.sessionId).toBe("local-session-cursor");
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-cursor",
          acp_session_id: "cursor-acp-session",
        }),
      });
    });

    const prompt = JSON.parse(ws.sent.find((frame) => JSON.parse(frame).type === "prompt")!);
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.complete",
          session_id: "local-session-cursor",
          turn_id: prompt.turn_id,
        }),
      });
    });

    await waitFor(() => {
      expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
      expect(result.current.messages.at(1)?.parts).toEqual([{ type: "text", text: "pong" }]);
    });
  });

  it("keeps streamed assistant text when persisted history is still lagging at session complete", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-lagging-history" }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-lagging-history/messages") && !init?.method) {
        return new Response(JSON.stringify({
          messages: [{
            id: "lagging-user-row",
            sender_kind: "user",
            sender_id: "local-user",
            turn_id: "turn-lagging",
            events: [{ type: "text", text: "hello" }],
            created_at: 1,
          }],
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    act(() => {
      result.current.startDraft("desktop-local", undefined, {
        agentId: "mock-acp",
        projectId: "project-one",
      });
      result.current.sendMessage("hello");
    });

    await waitFor(() => expect(result.current.sessionId).toBe("local-session-lagging-history"));
    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-lagging-history",
          acp_session_id: "mock-acp-session",
        }),
      });
    });
    const prompt = JSON.parse(ws.sent.find((frame) => JSON.parse(frame).type === "prompt")!);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-lagging-history",
          turn_id: prompt.turn_id,
          event: { type: "text", text: "Mock ACP reply: hello" },
        }),
      });
    });
    expect(result.current.messages.at(-1)?.parts).toEqual([
      { type: "text", text: "Mock ACP reply: hello" },
    ]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.complete",
          session_id: "local-session-lagging-history",
          turn_id: prompt.turn_id,
        }),
      });
    });

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith(
      "/api/v1/local-sessions/local-session-lagging-history/messages",
    ))).toBe(true));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.messages.at(-1)?.parts).toEqual([
      { type: "text", text: "Mock ACP reply: hello" },
    ]);
  });

  it("sends an explicit local ACP agent override when selecting a runtime", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-agent" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-agent",
      });
    });

    await waitFor(() => {
      const sessionCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(sessionCall).toBeTruthy();
      expect(JSON.parse(String(sessionCall?.[1]?.body))).toEqual({
        agent_id: "codex-acp",
        project_id: "project-agent",
      });
      expect(result.current.selectedAgentId).toBe("codex-acp");
    });
  });

  it("refreshes runtime probes when a session reports ACP auth_required", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/runtimes?") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-auth-needed" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "cursor" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.error",
          session_id: "local-session-auth-needed",
          code: "auth_required",
          agent_id: "cursor",
          message: "Cursor needs authentication before ACP can start.",
          auth: {
            status: "needs-auth",
            message: "Cursor requires ACP authentication.",
            command: "clash-acp-cursor",
          },
        }),
      });
    });

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/api/v1/runtimes?probe=config&refresh=1")
    ))).toBe(true));
    expect(result.current.errorMessage).toBe("Cursor needs authentication before ACP can start.");
  });

  it("refreshes runtime probes when session creation is blocked by auth", async () => {
    const runtimePayload = {
      runtimes: [{
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "This Mac",
        os: "darwin/arm64",
        agents: [{ id: "devin", label: "Devin", binary: "clash-acp-devin" }],
        version: "desktop",
        status: "online",
        last_heartbeat: 1,
        created_at: 1,
      }],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/runtimes?") && !init?.method) {
        return new Response(JSON.stringify(runtimePayload), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify(runtimePayload), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response("Devin needs authentication before ACP can start.", { status: 503 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "devin" });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toContain("Devin needs authentication before ACP can start.");
    expect(FakeWebSocket.instances).toHaveLength(0);
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => (
      String(input).includes("/api/v1/runtimes?probe=config&refresh=1")
    ))).toBe(true));
  });

  it("tracks ACP session config options and sends native config updates", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-config" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-config",
          config_options: [
            {
              id: "model",
              name: "Model",
              type: "select",
              category: "model",
              currentValue: "gpt-5.5",
              options: [{ value: "gpt-5.5", name: "GPT-5.5" }],
            },
          ],
        }),
      });
    });

    expect(result.current.sessionConfigOptions).toHaveLength(1);
    expect(result.current.sessionConfigOptions[0]?.category).toBe("model");

    act(() => {
      result.current.setConfigOption("model", "gpt-5.4");
    });

    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "set_config_option",
      config_id: "model",
      value: "gpt-5.4",
    });
  });

  it("tracks ACP session modes and sends native mode updates", async () => {
    const modes = {
      currentModeId: "ask",
      availableModes: [
        { id: "ask", name: "Ask" },
        { id: "code", name: "Code" },
      ],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({
          runtimes: [
            {
              id: "desktop-local",
              machine_id: "desktop-local",
              hostname: "local",
              os: "darwin",
              version: "desktop",
              status: "online",
              last_heartbeat: 1,
              created_at: 1,
              agents: [{ id: "codex-acp", label: "Codex", session_modes: modes }],
            },
          ],
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-mode" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await waitFor(() => {
      expect(result.current.runtimes[0]?.agents[0]?.session_modes).toEqual(modes);
    });

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-mode",
          modes,
        }),
      });
    });
    expect(result.current.sessionModes).toEqual(modes);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.mode",
          session_id: "local-session-mode",
          modes: { ...modes, currentModeId: "code" },
        }),
      });
    });
    expect(result.current.sessionModes?.currentModeId).toBe("code");

    act(() => {
      result.current.setSessionMode("ask");
    });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "set_session_mode",
      mode_id: "ask",
    });
  });

  it("can cancel a prompt before the agent emits the first event", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-cancel" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-cancel" }) });
    });
    act(() => {
      result.current.sendMessage("hi");
      result.current.cancel();
    });

    const prompt = JSON.parse(ws.sent.find((frame) => JSON.parse(frame).type === "prompt")!);
    const cancel = JSON.parse(ws.sent.find((frame) => JSON.parse(frame).type === "cancel")!);
    expect(cancel).toEqual({ type: "cancel", turn_id: prompt.turn_id });
  });

  it("submits queued runtime prompts to the backend and reflects backend queue updates", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-queue" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-queue" }) });
      result.current.sendMessage("first");
      result.current.sendMessage("second");
      result.current.sendMessage("third");
    });

    const promptFrames = () => ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "prompt");
    expect(promptFrames().map((frame) => frame.text)).toEqual(["first", "second", "third"]);
    expect(promptFrames().map((frame) => frame.queue_mode ?? null)).toEqual([null, "single", "single"]);
    expect(result.current.messages.filter((message) => message.role === "user").map((message) =>
      message.parts.map((part: any) => part.text).join("")
    )).toEqual(["first"]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-queue",
          mode: "single",
          active_turn_id: promptFrames()[0].turn_id,
          queued: [
            { turn_id: promptFrames()[1].turn_id, text: "second", created_at: 1 },
            { turn_id: promptFrames()[2].turn_id, text: "third", created_at: 2 },
          ],
        }),
      });
    });

    expect((result.current as any).promptQueue.map((item: { text: string }) => item.text)).toEqual(["second", "third"]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.complete",
          session_id: "local-session-queue",
          turn_id: promptFrames()[0].turn_id,
        }),
      });
    });

    expect(promptFrames().map((frame) => frame.text)).toEqual(["first", "second", "third"]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-queue",
          mode: "single",
          active_turn_id: null,
          queued: [
            { turn_id: promptFrames()[2].turn_id, text: "third", created_at: 2 },
          ],
        }),
      });
    });

    expect((result.current as any).promptQueue.map((item: { text: string }) => item.text)).toEqual(["third"]);
    expect(result.current.messages.filter((message) => message.role === "user").map((message) =>
      message.parts.map((part: any) => part.text).join("")
    )).toEqual(["first"]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-queue",
          mode: "single",
          active_turn_id: promptFrames()[1].turn_id,
          queued: [
            { turn_id: promptFrames()[2].turn_id, text: "third", created_at: 2 },
          ],
        }),
      });
    });

    expect((result.current as any).promptQueue.map((item: { text: string }) => item.text)).toEqual(["third"]);
    expect(result.current.messages.filter((message) => message.role === "user").map((message) =>
      message.parts.map((part: any) => part.text).join("")
    )).toEqual(["first", "second"]);
  });

  it("clears the active turn when the backend reports no active queued prompt", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-active-clear" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-active-clear" }) });
      result.current.sendMessage("first");
    });
    const firstPrompt = JSON.parse(ws.sent.find((frame) => JSON.parse(frame).type === "prompt")!);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-active-clear",
          mode: "single",
          active_turn_id: firstPrompt.turn_id,
          queued: [],
        }),
      });
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-active-clear",
          mode: "single",
          active_turn_id: null,
          queued: [],
        }),
      });
      result.current.sendMessage("after stop");
    });

    const promptFrames = ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "prompt");
    expect(promptFrames.map((frame) => frame.text)).toEqual(["first", "after stop"]);
    expect(promptFrames.map((frame) => frame.queue_mode ?? null)).toEqual([null, null]);
    expect(result.current.promptQueue).toEqual([]);
  });

  it("sends follow-up prompts immediately when the runtime prompt queue is disabled", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-no-queue" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-no-queue" }) });
      result.current.setPromptQueueEnabled(false);
      result.current.sendMessage("first");
      result.current.sendMessage("second");
    });

    const promptFrames = ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "prompt");
    expect(promptFrames.map((frame) => frame.text)).toEqual(["first", "second"]);
    expect(promptFrames.map((frame) => frame.queue_mode ?? null)).toEqual([null, null]);
    expect(result.current.promptQueue).toEqual([]);
    expect(result.current.messages.filter((message) => message.role === "user").map((message) =>
      message.parts.map((part: any) => part.text).join("")
    )).toEqual(["first", "second"]);
  });

  it("flushes all queued runtime prompts after the current agent loop when queue mode is flush", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-flush" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-flush" }) });
      (result.current as any).setPromptQueueMode("flush");
      result.current.sendMessage("first");
      result.current.sendMessage("second");
      result.current.sendMessage("third");
    });

    const promptFrames = () => ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "prompt");
    const queueModeFrames = ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "set_prompt_queue_mode");
    expect(queueModeFrames).toEqual([{ type: "set_prompt_queue_mode", queue_mode: "flush" }]);
    expect(promptFrames().map((frame) => frame.text)).toEqual(["first", "second", "third"]);
    expect(promptFrames().map((frame) => frame.queue_mode ?? null)).toEqual([null, "flush", "flush"]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.complete",
          session_id: "local-session-flush",
          turn_id: promptFrames()[0].turn_id,
        }),
      });
    });

    expect(promptFrames().map((frame) => frame.text)).toEqual(["first", "second", "third"]);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-flush",
          mode: "flush",
          active_turn_id: promptFrames()[1].turn_id,
          queued: [],
        }),
      });
    });

    expect((result.current as any).promptQueue).toEqual([]);
  });

  it("clears queued runtime prompts through the backend queue protocol", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-clear-queue" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-clear-queue" }) });
      result.current.sendMessage("first");
      result.current.sendMessage("second");
    });

    const promptFrames = () => ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "prompt");
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-clear-queue",
          mode: "single",
          active_turn_id: promptFrames()[0].turn_id,
          queued: [
            { turn_id: promptFrames()[1].turn_id, text: "second", created_at: 1 },
          ],
        }),
      });
    });
    expect((result.current as any).promptQueue.map((item: { text: string }) => item.text)).toEqual(["second"]);

    act(() => {
      result.current.clearPromptQueue();
    });

    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ type: "clear_prompt_queue" });
    expect((result.current as any).promptQueue).toEqual([]);
  });

  it("keeps the ACP transcript in chronological blocks when a queued prompt is steered", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-steer" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-steer" }) });
      result.current.sendMessage("first");
      result.current.sendMessage("steer after tool");
    });

    const promptFrames = () => ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "prompt");
    expect(promptFrames().map((frame) => frame.text)).toEqual(["first", "steer after tool"]);
    expect(promptFrames().map((frame) => frame.queue_mode ?? null)).toEqual([null, "single"]);
    expect(result.current.messages.filter((message) => message.role === "user").map((message) => message.parts.map((part: any) => part.text).join(""))).toEqual(["first"]);

    const firstTurnId = promptFrames()[0].turn_id;
    const steerTurnId = promptFrames()[1].turn_id;
    const sendSessionEvent = (event: unknown) => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-steer",
          turn_id: firstTurnId,
          event,
        }),
      });
    };

    act(() => {
      sendSessionEvent({
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-1",
        content: { type: "text", text: "before steer" },
      });
      sendSessionEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        title: "pwd",
        kind: "execute",
        status: "in_progress",
      });
    });

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-steer",
          mode: "single",
          active_turn_id: promptFrames()[0].turn_id,
          queued: [
            { turn_id: steerTurnId, text: "steer after tool", created_at: 1 },
          ],
        }),
      });
      result.current.steerQueuedPrompt(steerTurnId);
    });

    expect(promptFrames().map((frame) => frame.text)).toEqual(["first", "steer after tool"]);
    expect(ws.sent.map((frame) => JSON.parse(frame)).filter((frame) => frame.type === "steer_queued_prompt")).toEqual([
      {
        type: "steer_queued_prompt",
        turn_id: steerTurnId,
      },
    ]);
    expect(result.current.promptQueue).toEqual([]);
    expect(result.current.messages.filter((message) => message.role === "user").map((message) => message.parts.map((part: any) => part.text).join(""))).toEqual(["first", "steer after tool"]);

    act(() => {
      sendSessionEvent({
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        rawOutput: "/tmp/project\n",
      });
      sendSessionEvent({
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-1",
        content: { type: "text", text: "same message after steer" },
      });
      sendSessionEvent({
        sessionUpdate: "agent_message_chunk",
        messageId: "msg-1",
        content: { type: "text", text: " still contiguous" },
      });
      sendSessionEvent({
        sessionUpdate: "tool_call",
        toolCallId: "tool-2",
        title: "ls",
        kind: "execute",
      });
    });

    expect(promptFrames().map((frame) => frame.text)).toEqual(["first", "steer after tool"]);
    expect(result.current.messages.map((message) => ({
      role: message.role,
      text: message.parts.filter((part: any) => part.type === "text").map((part: any) => part.text).join(""),
      tools: message.parts.filter((part: any) => part.type === "tool_call").map((part: any) => ({
        id: part.toolCallId,
        status: part.status,
        output: part.rawOutput,
      })),
    }))).toEqual([
      { role: "user", text: "first", tools: [] },
      { role: "assistant", text: "before steer", tools: [] },
      { role: "assistant", text: "", tools: [{ id: "tool-1", status: "completed", output: "/tmp/project\n" }] },
      { role: "user", text: "steer after tool", tools: [] },
      { role: "assistant", text: "same message after steer still contiguous", tools: [] },
      { role: "assistant", text: "", tools: [{ id: "tool-2", status: undefined, output: undefined }] },
    ]);
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.complete",
          session_id: "local-session-steer",
          turn_id: firstTurnId,
        }),
      });
    });
    expect(result.current.status).toBe("connected");
    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.queue_update",
          session_id: "local-session-steer",
          mode: "single",
          active_turn_id: null,
          queued: [],
        }),
      });
    });
    expect((result.current as any).promptQueue).toEqual([]);
    expect(result.current.messages.filter((message) => message.role === "user").map((message) => message.parts.map((part: any) => part.text).join(""))).toEqual(["first", "steer after tool"]);
  });

  it("exposes transient agent retry status and clears it when the turn completes", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-retry" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    let turnId = "";
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-retry" }) });
      result.current.sendMessage("hi");
      turnId = JSON.parse(ws.sent.find((frame) => JSON.parse(frame).type === "prompt")!).turn_id;
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.status",
          session_id: "local-session-retry",
          turn_id: turnId,
          status: "reconnecting",
          message: "Reconnecting... 2/5",
          attempt: 2,
          maxAttempts: 5,
        }),
      });
    });

    expect(result.current.transientStatus).toEqual({
      kind: "reconnecting",
      message: "Reconnecting... 2/5",
      attempt: 2,
      maxAttempts: 5,
    });
    expect(result.current.status).toBe("sending");

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.complete",
          session_id: "local-session-retry",
          turn_id: turnId,
        }),
      });
    });

    expect(result.current.transientStatus).toBeNull();
    expect(result.current.status).toBe("connected");
  });

  it("stores stderr diagnostics and derives transient status from them", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-diagnostic" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-diagnostic" }) });
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.diagnostic",
          session_id: "local-session-diagnostic",
          turn_id: "turn-diagnostic",
          diagnostic: {
            stream: "stderr",
            severity: "warning",
            raw: "WARN stream disconnected - retrying sampling request (2/5 in 1.0s)...",
            message: "Reconnecting... 2/5",
            transientStatus: {
              status: "reconnecting",
              message: "Reconnecting... 2/5",
              detail: "stream disconnected",
              attempt: 2,
              maxAttempts: 5,
            },
          },
        }),
      });
    });

    expect(result.current.diagnostics).toHaveLength(1);
    expect(result.current.diagnostics[0]).toMatchObject({
      stream: "stderr",
      severity: "warning",
      message: "Reconnecting... 2/5",
      raw: "WARN stream disconnected - retrying sampling request (2/5 in 1.0s)...",
    });
    expect(result.current.transientStatus).toEqual({
      kind: "reconnecting",
      message: "Reconnecting... 2/5",
      detail: "stream disconnected",
      attempt: 2,
      maxAttempts: 5,
    });
  });

  it("renames a cold runtime session from the first user prompt", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-title" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-title",
        freshSession: true,
      });
    });
    expect(result.current.currentSession?.title).toBe("New session");

    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => {
      ws.onmessage?.({ data: JSON.stringify({ type: "session.ready", session_id: "local-session-title" }) });
      result.current.sendMessage("Run `pwd` with your shell tool, then answer with only the path.");
    });

    expect(result.current.currentSession?.title).toBe("Run `pwd` with your shell tool, then answer with onl...");
  });

  it("uses an explicit ACP resume id without restoring project-scoped transcript cache", async () => {
    let sessionSeq = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        sessionSeq += 1;
        return new Response(JSON.stringify({ session_id: `local-session-${sessionSeq}` }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const first = renderHook(() => useClashRuntime());
    await act(async () => {
      await first.result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
      });
    });

    const firstWs = FakeWebSocket.instances.at(-1)!;
    act(() => {
      firstWs.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-1",
          acp_session_id: "acp-thread-one",
        }),
      });
      first.result.current.sendMessage("where am i?");
    });
    const prompt = JSON.parse(firstWs.sent.find((frame) => JSON.parse(frame).type === "prompt")!);
    act(() => {
      firstWs.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-1",
          turn_id: prompt.turn_id,
          event: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "/Users/xiaoyang/.clash/projects/_default" },
          },
        }),
      });
      firstWs.onmessage?.({
        data: JSON.stringify({
          type: "session.complete",
          session_id: "local-session-1",
          turn_id: prompt.turn_id,
        }),
      });
    });

    await waitFor(() => {
      expect(first.result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    });
    first.unmount();

    const second = renderHook(() => useClashRuntime());
    await act(async () => {
      await second.result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
        resumeAcpSessionId: "acp-thread-one",
      });
    });

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCalls.at(-1)?.[1]?.body))).toMatchObject({
      agent_id: "codex-acp",
      project_id: "project-one",
      resume_session_id: "acp-thread-one",
    });
    expect(second.result.current.messages).toEqual([]);

    const secondWs = FakeWebSocket.instances.at(-1)!;
    act(() => {
      secondWs.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-2",
          acp_session_id: "acp-thread-two",
        }),
      });
    });
    second.unmount();

    const third = renderHook(() => useClashRuntime());
    await act(async () => {
      await third.result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
        resumeAcpSessionId: "acp-thread-two",
      });
    });

    const allPostCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(allPostCalls.at(-1)?.[1]?.body))).toMatchObject({
      agent_id: "codex-acp",
      project_id: "project-one",
      resume_session_id: "acp-thread-two",
    });
    expect(third.result.current.messages).toEqual([]);
  });

  it("cold-creates a local runtime session without resuming cached ACP state", async () => {
    let sessionSeq = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        sessionSeq += 1;
        return new Response(JSON.stringify({ session_id: `local-session-${sessionSeq}` }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const first = renderHook(() => useClashRuntime());
    await act(async () => {
      await first.result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
      });
    });

    const firstWs = FakeWebSocket.instances.at(-1)!;
    act(() => {
      firstWs.onmessage?.({
        data: JSON.stringify({
          type: "session.ready",
          session_id: "local-session-1",
          acp_session_id: "acp-thread-old",
        }),
      });
      first.result.current.sendMessage("where am i?");
    });

    await waitFor(() => {
      expect(first.result.current.messages.map((message) => message.role)).toEqual(["user"]);
    });

    await act(async () => {
      await first.result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
        freshSession: true,
      });
    });

    const postCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCalls.at(-1)?.[1]?.body))).toEqual({
      agent_id: "codex-acp",
      project_id: "project-one",
    });
    expect(first.result.current.messages).toEqual([]);

    const second = renderHook(() => useClashRuntime());
    await act(async () => {
      await second.result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
      });
    });

    const allPostCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(allPostCalls.at(-1)?.[1]?.body))).toEqual({
      agent_id: "codex-acp",
      project_id: "project-one",
    });
    expect(second.result.current.messages).toEqual([]);
  });

  it("does not treat project-scoped runtime cache as Clash session history", async () => {
    window.localStorage.setItem("clash:runtimeSession:project-one:desktop-local:master-clash:codex-acp", JSON.stringify({
      acpSessionId: "acp-thread-stale",
      messages: [{ id: "stale-user", role: "user", parts: [{ type: "text", text: "old prompt" }] }],
      updatedAt: Date.now(),
    }));
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-fresh" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
      });
    });

    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
    expect(JSON.parse(String(postCall?.[1]?.body))).toEqual({
      agent_id: "codex-acp",
      project_id: "project-one",
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.currentSession?.acpSessionId).toBeUndefined();
  });

  it("attaches an existing runtime session without creating a new ACP session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-old/messages") && !init?.method) {
        return new Response(JSON.stringify({
          messages: [
            {
              id: "user-row",
              sender_kind: "user",
              sender_id: "user",
              turn_id: "turn-old",
              events: [{ type: "text", text: "Run pwd" }],
              created_at: 1,
            },
            {
              id: "agent-row",
              sender_kind: "agent",
              sender_id: "master-clash",
              turn_id: "turn-old",
              events: [{
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "/Users/xiaoyang/project" },
              }],
              created_at: 2,
            },
          ],
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-old/_attach") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-old" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.attachSession({
        id: "local-session-old",
        threadId: "local-session-old",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        status: "active",
      });
    });

    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST"
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([input, init]) =>
      String(input).endsWith("/api/v1/local-sessions/local-session-old/_attach") && init?.method === "POST"
    )).toBe(true);
    expect(result.current.sessionId).toBe("local-session-old");
    expect(result.current.status).toBe("connected");
    expect(result.current.selectedRuntimeId).toBe("desktop-local");
    expect(result.current.selectedAgentId).toBe("codex-acp");
    expect(result.current.currentSession?.threadId).toBe("local-session-old");
    expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.current.messages.at(1)?.parts).toEqual([{ type: "text", text: "/Users/xiaoyang/project" }]);
    const stream = FakeWebSocket.instances.at(-1)!;
    expect(stream.url).toContain("/api/v1/local-sessions/local-session-old/_stream?replay=0");

    act(() => {
      stream.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-old",
          turn_id: "turn-old",
          event: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "/Users/xiaoyang/project" },
          },
        }),
      });
    });

    expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.current.messages.at(1)?.parts).toEqual([{ type: "text", text: "/Users/xiaoyang/project" }]);
  });

  it("shows the runtime attach error field from structured local API failures", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-old/messages") && !init?.method) {
        return new Response("not found", { status: 404 });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-old/_attach") && init?.method === "POST") {
        return new Response(JSON.stringify({
          error: "ACP session init timed out after 10ms",
          session_id: "local-session-old",
          mutation: {
            operation: "runtime_session_attach",
            entity: { kind: "session", id: "local-session-old" },
            accepted: true,
          },
        }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.attachSession({
        id: "local-session-old",
        threadId: "local-session-old",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        status: "active",
      });
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toBe("session attach failed: ACP session init timed out after 10ms");
  });

  it("treats loaded attach history as connected while ACP restore is still pending", async () => {
    let resolveAttach: ((response: Response) => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-slow/messages") && !init?.method) {
        return new Response(JSON.stringify({
          messages: [
            {
              id: "user-row",
              sender_kind: "user",
              sender_id: "user",
              turn_id: "turn-slow",
              events: [{ type: "text", text: "Reply exactly: pong" }],
              created_at: 1,
            },
            {
              id: "agent-row",
              sender_kind: "agent",
              sender_id: "cursor",
              turn_id: "turn-slow",
              events: [
                {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "p" },
                },
                {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "ong" },
                },
              ],
              created_at: 2,
            },
          ],
        }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-slow/_attach") && init?.method === "POST") {
        return new Promise<Response>((resolve) => {
          resolveAttach = resolve;
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    act(() => {
      void result.current.attachSession({
        id: "local-session-slow",
        threadId: "local-session-slow",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "cursor",
        status: "starting",
      });
    });

    await waitFor(() => {
      expect(result.current.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    });
    expect(result.current.status).toBe("connected");
    expect(result.current.messages.at(1)?.parts).toEqual([{ type: "text", text: "pong" }]);
    expect(FakeWebSocket.instances).toHaveLength(0);

    await act(async () => {
      resolveAttach?.(new Response(JSON.stringify({ session_id: "local-session-slow" }), {
        headers: { "content-type": "application/json" },
      }));
    });

    await waitFor(() => {
      expect(FakeWebSocket.instances.at(-1)?.url).toContain("/api/v1/local-sessions/local-session-slow/_stream?replay=0");
    });
  });

  it("replays runtime backlog when persisted history cannot be loaded during attach", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-live/messages") && !init?.method) {
        return new Response("local transcript unavailable", { status: 500 });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-live/_attach") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-live" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await act(async () => {
      await result.current.attachSession({
        id: "local-session-live",
        threadId: "local-session-live",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        status: "active",
      });
    });

    const stream = FakeWebSocket.instances.at(-1)!;
    expect(stream.url).toContain("/api/v1/local-sessions/local-session-live/_stream");
    expect(stream.url).not.toContain("replay=0");

    act(() => {
      stream.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-live",
          turn_id: "turn-live",
          event: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "replayed from local-api backlog" },
          },
        }),
      });
    });

    expect(result.current.messages.map((message) => message.role)).toEqual(["assistant"]);
    expect(result.current.messages.at(0)?.parts).toEqual([
      { type: "text", text: "replayed from local-api backlog" },
    ]);
  });
});
