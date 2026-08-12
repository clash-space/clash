// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGroupChat } from "./useGroupChat";

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = MockWebSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send(raw: string) {
    this.sent.push(raw);
  }

  close() {
    this.onclose?.();
  }

  emit(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
}

describe("useGroupChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    MockWebSocket.instances = [];
    localStorage.clear();
  });

  it("surfaces raw session events so the project canvas can consume agent operations", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "session-1" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ messages: [] }), {
        headers: { "content-type": "application/json" },
      });
    }));
    const onSessionEvent = vi.fn();

    const { result } = renderHook(() =>
      useGroupChat("project-1", { onSessionEvent }),
    );

    await act(async () => {
      await result.current.addAgent({
        id: "agent-1",
        template_id: "clash",
        runtime_id: "desktop-local",
        display_name: "Clash",
      });
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.emit({ type: "session.ready", session_id: "session-1" });
    });
    await waitFor(() => expect(result.current.focusedAgent?.status).toBe("connected"));

    act(() => {
      result.current.sendToFocused("build the canvas");
    });
    const prompt = JSON.parse(ws.sent.at(-1) ?? "{}") as { turn_id: string };
    const canvasPatch = {
      sessionUpdate: "clash.canvas.patch",
      operations: [
        {
          op: "add_node",
          node: {
            id: "agent-node-1",
            type: "text",
            data: { label: "Agent node", content: "Created by agent" },
            position: { x: 140, y: 220 },
          },
        },
      ],
    };

    act(() => {
      ws.emit({
        type: "session.event",
        session_id: "session-1",
        turn_id: prompt.turn_id,
        event: canvasPatch,
      });
    });

    expect(onSessionEvent).toHaveBeenCalledWith({
      agentMemberId: "agent-1",
      sessionId: "session-1",
      turnId: prompt.turn_id,
      event: canvasPatch,
    });
  });

  it("dispatches idle room mentions immediately instead of leaving them pending", async () => {
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ session_id: "session-mention" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ messages: [] }), {
        headers: { "content-type": "application/json" },
      });
    }));

    const { result } = renderHook(() => useGroupChat("project-mention"));

    await act(async () => {
      await result.current.addAgent({
        id: "agent-clash",
        template_id: "clash",
        runtime_id: "desktop-local",
        display_name: "Clash",
      });
    });

    const ws = MockWebSocket.instances[0];
    act(() => {
      ws.emit({ type: "session.ready", session_id: "session-mention" });
    });
    await waitFor(() => expect(result.current.focusedAgent?.status).toBe("connected"));

    act(() => {
      ws.emit({
        type: "room.mention",
        message_id: "room-message-1",
        from_kind: "user",
        from_id: "local-user",
        from_user_id: "local-user",
        text: "@clash choreograph the canvas",
      });
    });

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toMatchObject({
      type: "prompt",
      text: "[room from human] @clash choreograph the canvas",
    });
    expect(result.current.focusedAgent?.pendingPrompts).toEqual([]);
  });
});
