// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useClashRuntime } from "./useClashRuntime";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readonly url: string;
  readyState = FakeWebSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
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
      await result.current.select("desktop-local", "director", {
        agentId: "codex-cli",
        projectId: "project-agent",
      } as any);
    });

    await waitFor(() => {
      const sessionCall = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
      expect(sessionCall).toBeTruthy();
      expect(JSON.parse(String(sessionCall?.[1]?.body))).toEqual({
        crew_id: "director",
        agent_id: "codex-cli",
        project_id: "project-agent",
      });
    });
  });
});
