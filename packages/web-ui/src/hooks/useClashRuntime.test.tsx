// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
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
    cleanup();
    vi.unstubAllGlobals();
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
    FakeWebSocket.instances = [];
    window.localStorage.clear();
  });

  it("surfaces an installed harness update and restarts a busy session after its turn", async () => {
    const restartModes: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-update" }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-update/runtime-status")) {
        return new Response(JSON.stringify({
          session_id: "local-session-update",
          harness_id: "codex-acp",
          harness_label: "Codex",
          running_version: "1.0.1",
          installed_version: "1.0.2",
          restart_required: true,
          busy: true,
          restart_pending: restartModes.includes("after-turn"),
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-update/restart") && init?.method === "POST") {
        const mode = (JSON.parse(String(init.body)) as { mode: string }).mode;
        restartModes.push(mode);
        return new Response(JSON.stringify({
          session_id: "local-session-update",
          status: mode === "after-turn" ? "pending" : "restarted",
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());
    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });
    await waitFor(() => expect(result.current.sessionRuntimeStatus).toMatchObject({
      installed_version: "1.0.2",
      restart_required: true,
      busy: true,
    }));

    await act(async () => {
      await result.current.restartSession("after-turn");
    });
    expect(result.current.sessionRestartPhase).toBe("pending");
    expect(restartModes).toEqual(["after-turn"]);

    const firstSocket = FakeWebSocket.instances.at(-1)!;
    act(() => {
      firstSocket.onmessage?.({ data: JSON.stringify({
        type: "session.restart_ready",
        session_id: "local-session-update",
      }) });
    });

    await waitFor(() => {
      expect(restartModes).toEqual(["after-turn", "now"]);
      expect(FakeWebSocket.instances).toHaveLength(2);
      expect(result.current.sessionRestartPhase).toBe("complete");
    });
  });

  it("uses the server-owned startup readiness barrier when loading runtimes", async () => {
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
      !init?.method && String(input).includes("probe=")
    ))).toBe(false);
  });

  it("keeps the startup snapshot pending until the server readiness barrier settles", async () => {
    let resolveSnapshot!: (response: Response) => void;
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveSnapshot = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.startupStatus).toBe("loading");

    await act(async () => {
      resolveSnapshot(new Response(JSON.stringify({ runtimes: [] }), {
        headers: { "content-type": "application/json" },
      }));
    });

    await waitFor(() => expect(result.current.startupStatus).toBe("ready"));
  });

  it("restores only valid recent choices from the startup snapshot and records the effective run", async () => {
    let createBody: Record<string, unknown> | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({
          runtimes: [{
            id: "desktop-local",
            machine_id: "desktop-local",
            hostname: "local",
            os: "darwin",
            version: "desktop",
            status: "online",
            last_heartbeat: 1,
            created_at: 1,
            preferences: {
              agent_id: "codex-acp",
              config_by_agent: {
                "codex-acp": {
                  model: "gpt-5.6-terra",
                  effort: "removed",
                  "fast-mode": true,
                },
              },
              mode_by_agent: {
                "codex-acp": "plan",
              },
            },
            agents: [{
              id: "claude-acp",
              config_options: [],
            }, {
              id: "codex-acp",
              config_options: [{
                id: "model",
                name: "Model",
                type: "select",
                category: "model",
                currentValue: "gpt-5.6-sol",
                options: [
                  { value: "gpt-5.6-sol", name: "GPT-5.6-Sol" },
                  { value: "gpt-5.6-terra", name: "GPT-5.6-Terra" },
                ],
              }, {
                id: "effort",
                name: "Effort",
                type: "select",
                category: "thought_level",
                currentValue: "medium",
                options: [
                  { value: "medium", name: "Medium" },
                  { value: "high", name: "High" },
                ],
              }, {
                id: "fast-mode",
                name: "Fast mode",
                type: "boolean",
                currentValue: false,
              }],
              session_modes: {
                currentModeId: "default",
                availableModes: [
                  { id: "default", name: "Default" },
                  { id: "plan", name: "Plan" },
                ],
              },
            }],
          }],
        }), { headers: { "content-type": "application/json" } });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        createBody = JSON.parse(String(init.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ session_id: "recent-session" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());
    await waitFor(() => expect(result.current.runtimes).toHaveLength(1));

    act(() => {
      result.current.startDraft("desktop-local", undefined, {
        projectId: "project-one",
      });
    });

    expect(result.current.selectedAgentId).toBe("codex-acp");
    expect(result.current.sessionConfigOptions).toEqual([
      expect.objectContaining({ id: "model", currentValue: "gpt-5.6-terra" }),
      expect.objectContaining({ id: "effort", currentValue: "medium" }),
      expect.objectContaining({ id: "fast-mode", currentValue: true }),
    ]);
    expect(result.current.sessionModes?.currentModeId).toBe("plan");

    act(() => {
      result.current.sendMessage("hello");
    });
    await waitFor(() => expect(createBody).not.toBeNull());
    expect(createBody).toMatchObject({
      agent_id: "codex-acp",
      permission_mode: "plan",
      config_values: {
        model: "gpt-5.6-terra",
        effort: "medium",
        "fast-mode": true,
      },
    });
  });

  it("rejects an explicit refresh when the runtime snapshot cannot be loaded", async () => {
    let requestCount = 0;
    const fetchMock = vi.fn(async () => {
      requestCount += 1;
      if (requestCount === 1) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("startup snapshot unavailable", { status: 503 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());
    await waitFor(() => expect(requestCount).toBe(1));

    await expect(result.current.refresh()).rejects.toThrow(
      "Runtime snapshot request failed: HTTP 503",
    );
  });

  it("keeps ACP permission requests out of the transcript and sends the selected option", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-permission" }), {
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
          type: "session.permission_request",
          session_id: "local-session-permission",
          request_id: "permission-1",
          tool_call: { toolCallId: "tool-1", title: "Edit file" },
          options: [
            { optionId: "reject", name: "Reject", kind: "reject_once" },
            { optionId: "allow", name: "Allow", kind: "allow_once" },
          ],
        }),
      });
    });

    expect(result.current.permissionRequests).toEqual([{
      requestId: "permission-1",
      sessionId: "local-session-permission",
      toolCall: { toolCallId: "tool-1", title: "Edit file" },
      options: [
        { optionId: "reject", name: "Reject", kind: "reject_once" },
        { optionId: "allow", name: "Allow", kind: "allow_once" },
      ],
    }]);
    expect(result.current.messages).toEqual([]);

    act(() => {
      result.current.respondPermission("permission-1", "allow");
    });

    expect(ws.sent.map((frame) => JSON.parse(frame))).toContainEqual({
      type: "permission_response",
      request_id: "permission-1",
      option_id: "allow",
    });
    expect(result.current.permissionRequests).toHaveLength(1);

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.permission_resolved",
          session_id: "local-session-permission",
          request_id: "permission-1",
        }),
      });
    });
    expect(result.current.permissionRequests).toEqual([]);
  });

  it("replaces stale draft config when a fresh startup probe completes", async () => {
    let runtimeRead = 0;
    const runtimeWithModel = (value: string, name: string) => ({
      runtimes: [{
        id: "desktop-local",
        machine_id: "desktop-local",
        hostname: "local",
        os: "darwin",
        version: "desktop",
        status: "online",
        last_heartbeat: 1,
        created_at: 1,
        agents: [{
          id: "codex-acp",
          label: "Codex",
          config_options: [{
            id: "model",
            name: "Model",
            type: "select",
            category: "model",
            currentValue: value,
            options: [{ value, name }],
          }, {
            id: "fast-mode",
            name: "Fast mode",
            type: "boolean",
            currentValue: true,
          }],
        }],
      }],
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!init?.method && String(input).includes("/api/v1/runtimes")) {
        runtimeRead += 1;
        const payload = runtimeRead === 1
          ? runtimeWithModel("gpt-5.5", "GPT-5.5")
          : runtimeWithModel("gpt-5.6-sol", "GPT-5.6-Sol");
        return new Response(JSON.stringify(payload), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());
    await waitFor(() => {
      expect(result.current.runtimes[0]?.agents[0]?.config_options?.[0]?.currentValue).toBe("gpt-5.5");
    });

    act(() => {
      result.current.startDraft("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-one",
      });
    });
    expect(result.current.sessionConfigOptions[0]?.currentValue).toBe("gpt-5.5");
    act(() => {
      result.current.setConfigOption("fast-mode", false);
    });

    await act(async () => {
      await result.current.refresh({ probe: "config", refresh: true });
    });

    expect(result.current.runtimes[0]?.agents[0]?.config_options?.[0]?.currentValue).toBe("gpt-5.6-sol");
    expect(result.current.sessionConfigOptions[0]?.currentValue).toBe("gpt-5.6-sol");
    expect(
      result.current.sessionConfigOptions.find((option) => option.id === "fast-mode")?.currentValue,
    ).toBe(false);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
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

  it("seeds slash commands from the cold-start runtime snapshot without creating a session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({
          runtimes: [
            {
              id: "desktop-local",
              machine_id: "desktop-local",
              hostname: "This Mac",
              os: "darwin/arm64",
              version: "desktop",
              status: "online",
              created_at: 1,
              last_heartbeat: 1,
              agents: [
                {
                  id: "codex-acp",
                  label: "Codex",
                  available_commands: [
                    {
                      name: "review",
                      description: "Review the current project",
                      _meta: {
                        commandAction: {
                          kind: "prefixPrompt",
                          presentation: "state",
                        },
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }), { headers: { "content-type": "application/json" } });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { result } = renderHook(() => useClashRuntime());
    await waitFor(() => expect(result.current.runtimes).toHaveLength(1));
    act(() => {
      result.current.startDraft("desktop-local", undefined, {
        agentId: "codex-acp",
      });
    });

    expect(result.current.availableCommands).toEqual([
      {
        name: "review",
        description: "Review the current project",
        _meta: {
          commandAction: {
            kind: "prefixPrompt",
            presentation: "state",
          },
        },
      },
    ]);
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
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
            {
              id: "fast-mode",
              name: "Fast mode",
              type: "boolean",
              currentValue: true,
            },
            {
              id: "collaboration_mode",
              name: "Collaboration mode",
              type: "select",
              currentValue: "plan",
              options: [
                { value: "default", name: "Default" },
                { value: "plan", name: "Plan" },
              ],
            },
          ],
        }),
      });
    });

    expect(result.current.sessionConfigOptions).toHaveLength(3);
    expect(result.current.sessionConfigOptions[0]?.category).toBe("model");
    expect(result.current.sessionConfigOptions[1]?.currentValue).toBe(true);

    act(() => {
      result.current.setConfigOption("model", "gpt-5.4");
    });

    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "set_config_option",
      config_id: "model",
      value: "gpt-5.4",
    });

    act(() => {
      result.current.setConfigOption("fast-mode", false);
    });

    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "set_config_option",
      config_id: "fast-mode",
      value: false,
    });

    act(() => {
      result.current.setConfigOption("collaboration_mode", "default");
    });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({
      type: "set_config_option",
      config_id: "collaboration_mode",
      value: "default",
    });
    expect(
      result.current.sessionConfigOptions.find((option) => option.id === "collaboration_mode")?.currentValue,
    ).toBe("plan");

    act(() => {
      ws.onmessage?.({
        data: JSON.stringify({
          type: "session.config_options",
          session_id: "local-session-config",
          config_options: [
            {
              id: "collaboration_mode",
              name: "Collaboration mode",
              type: "select",
              currentValue: "default",
              options: [
                { value: "default", name: "Default" },
                { value: "plan", name: "Plan" },
              ],
            },
          ],
        }),
      });
    });
    expect(
      result.current.sessionConfigOptions.find((option) => option.id === "collaboration_mode")?.currentValue,
    ).toBe("default");
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
      if (url.includes("/api/v1/runtimes") && !init?.method) {
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
      {
        role: "assistant",
        text: "before steer",
        tools: [{ id: "tool-1", status: "completed", output: "/tmp/project\n" }],
      },
      { role: "user", text: "steer after tool", tools: [] },
      {
        role: "assistant",
        text: "same message after steer still contiguous",
        tools: [{ id: "tool-2", status: undefined, output: undefined }],
      },
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
      result.current.sendMessage([
        '<!-- clash-workspace-context {"version":1,"projectId":"project-title"} -->',
        "Run `pwd` with your shell tool, then answer with only the path.",
      ].join("\n"));
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
    window.localStorage.setItem("clash:runtimeSession:project-one:desktop-local:clash:codex-acp", JSON.stringify({
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
              sender_id: "clash",
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

  it("keeps every streamed event in one stable assistant turn container", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-stable/messages") && !init?.method) {
        return new Response(JSON.stringify({ messages: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-stable/_attach") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-stable" }), {
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
        id: "local-session-stable",
        threadId: "local-session-stable",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        status: "active",
      });
    });

    const stream = FakeWebSocket.instances.at(-1)!;
    const sendEvent = (event: unknown) => {
      stream.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-stable",
          turn_id: "turn-stable",
          event,
        }),
      });
    };

    act(() => {
      sendEvent({
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-one",
        content: { type: "text", text: "**Planning**" },
      });
      sendEvent({
        sessionUpdate: "agent_message_chunk",
        messageId: "commentary-one",
        content: { type: "text", text: "我先读取当前画布。" },
        _meta: { codex: { phase: "commentary" } },
      });
      sendEvent({
        sessionUpdate: "tool_call",
        toolCallId: "canvas-list",
        title: "List Canvas",
        status: "in_progress",
      });
      sendEvent({
        sessionUpdate: "agent_thought_chunk",
        messageId: "thought-two",
        content: { type: "text", text: "**Summarizing**" },
      });
      sendEvent({
        sessionUpdate: "agent_message_chunk",
        messageId: "answer-one",
        content: { type: "text", text: "画布里有 1 个节点。" },
        _meta: { codex: { phase: "final_answer" } },
      });
    });

    const assistantMessages = result.current.messages.filter((message) => message.role === "assistant");
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.id).toBe("asst-turn-stable");
    expect(assistantMessages[0]?.parts.map((part) => part.type)).toEqual([
      "thought",
      "text",
      "tool_call",
      "thought",
      "text",
    ]);
  });

  it("tracks Goal and usage state from turnless ACP updates without transcript noise", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-goal/messages") && !init?.method) {
        return new Response(JSON.stringify({ messages: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/local-sessions/local-session-goal/_attach") && init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "local-session-goal" }), {
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
        id: "local-session-goal",
        threadId: "local-session-goal",
        type: "runtime",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentId: "codex-acp",
        status: "active",
      });
    });

    const stream = FakeWebSocket.instances.at(-1)!;
    act(() => {
      stream.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-goal",
          turn_id: "",
          event: {
            sessionUpdate: "session_info_update",
            _meta: {
              codex: {
                goal: {
                  objective: "Ship the Goal bar",
                  status: "active",
                  tokenBudget: 24_000,
                  timeUsedSeconds: 90,
                  controlMethod: "_codex/session/goal_control",
                },
              },
            },
          },
        }),
      });
    });

    expect(result.current.goal).toEqual(expect.objectContaining({
      objective: "Ship the Goal bar",
      status: "active",
      timeUsedSeconds: 90,
    }));
    expect(result.current.sessionInfoMeta).toEqual({
      codex: {
        goal: expect.objectContaining({
          objective: "Ship the Goal bar",
          status: "active",
        }),
      },
    });
    expect(result.current.messages).toEqual([]);

    act(() => {
      stream.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-goal",
          turn_id: "",
          event: {
            sessionUpdate: "usage_update",
            used: 12_500,
            size: 200_000,
            cost: { amount: 0.42, currency: "USD" },
            _meta: { "_claude/origin": "first_party" },
          },
        }),
      });
    });

    expect(result.current.sessionUsage).toEqual({
      used: 12_500,
      size: 200_000,
      cost: { amount: 0.42, currency: "USD" },
      metadata: { "_claude/origin": "first_party" },
    });
    expect(result.current.messages).toEqual([]);

    act(() => {
      stream.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-goal",
          turn_id: "",
          event: {
            sessionUpdate: "session_info_update",
            title: "Goal session",
            _meta: {
              codex: {
                threadStatus: { type: "idle" },
              },
              claude: {
                branch: "preserved-for-a-future-adapter",
              },
            },
          },
        }),
      });
    });

    expect(result.current.goal).toEqual(expect.objectContaining({
      objective: "Ship the Goal bar",
      status: "active",
    }));
    expect(result.current.sessionInfoMeta).toEqual({
      codex: {
        goal: expect.objectContaining({
          objective: "Ship the Goal bar",
          status: "active",
        }),
        threadStatus: { type: "idle" },
      },
      claude: {
        branch: "preserved-for-a-future-adapter",
      },
    });
    expect(result.current.currentSession?.title).toBe("Goal session");

    act(() => {
      stream.onmessage?.({
        data: JSON.stringify({
          type: "session.event",
          session_id: "local-session-goal",
          turn_id: "",
          event: {
            sessionUpdate: "session_info_update",
            _meta: { codex: { goal: null } },
          },
        }),
      });
    });

    expect(result.current.goal).toBeNull();
  });

  it("ignores late lifecycle events from a detached session socket", async () => {
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
        return new Response(JSON.stringify({ session_id: `session-${sessionSeq}` }), {
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
    const oldSocket = FakeWebSocket.instances.at(-1)!;
    const lateHandler = oldSocket.onmessage;
    await act(async () => {
      await result.current.select("desktop-local", undefined, { agentId: "codex-acp" });
    });
    const currentSocket = FakeWebSocket.instances.at(-1)!;
    act(() => {
      currentSocket.onmessage?.({
        data: JSON.stringify({ type: "session.ready", session_id: "session-2" }),
      });
      lateHandler?.({
        data: JSON.stringify({ type: "session.disposed", session_id: "session-1" }),
      });
    });

    expect(result.current.sessionId).toBe("session-2");
    expect(result.current.status).toBe("connected");
  });

  it("lets the newest session selection win an out-of-order create response", async () => {
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let postCount = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/runtimes") && !init?.method) {
        return new Response(JSON.stringify({ runtimes: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/v1/runtimes/desktop-local/sessions") && init?.method === "POST") {
        postCount += 1;
        if (postCount === 1) return firstResponse;
        return new Response(JSON.stringify({ session_id: "session-newest" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const { result } = renderHook(() => useClashRuntime());

    let first!: Promise<void>;
    act(() => {
      first = result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-old",
      });
    });
    await waitFor(() => expect(postCount).toBe(1));
    await act(async () => {
      await result.current.select("desktop-local", undefined, {
        agentId: "codex-acp",
        projectId: "project-new",
      });
    });
    await act(async () => {
      releaseFirst(new Response(JSON.stringify({ session_id: "session-stale" }), {
        headers: { "content-type": "application/json" },
      }));
      await first;
    });

    expect(result.current.sessionId).toBe("session-newest");
    expect(result.current.currentSession?.projectId).toBe("project-new");
    expect(FakeWebSocket.instances.at(-1)?.url).toContain("session-newest");
  });
});
