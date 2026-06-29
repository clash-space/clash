// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionHistory } from "./useSessionHistory";

describe("useSessionHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("upserts already-created sessions without creating another server session", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/sessions?projectId=project-one") && !init?.method) {
        return new Response(JSON.stringify({ sessions: [] }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("unexpected request", { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionHistory("project-one"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    act(() => {
      result.current.upsertSession({
        threadId: "local-session-one",
        type: "runtime",
        title: "Run pwd",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentMemberId: "master-clash",
      });
      result.current.upsertSession({
        threadId: "cloud-session-one",
        type: "cloud",
        title: "Cloud draft",
        projectId: "project-one",
      });
    });

    expect(result.current.sessions.map((session) => session.threadId)).toEqual([
      "cloud-session-one",
      "local-session-one",
    ]);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
