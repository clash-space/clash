// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSessionHistory } from "./useSessionHistory";

describe("useSessionHistory", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("upserts already-created sessions without creating another server session", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/api/v1/sessions?projectId=project-one") &&
          !init?.method
        ) {
          return new Response(JSON.stringify({ sessions: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("unexpected request", { status: 500 });
      },
    );
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
        agentMemberId: "clash",
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
    expect(
      fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"),
    ).toHaveLength(0);
  });

  it("keeps locally upserted runtime sessions when the initial fetch returns later", async () => {
    let resolveFetch: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionHistory("project-one"));

    act(() => {
      result.current.upsertSession({
        threadId: "runtime-session-one",
        type: "runtime",
        title: "Run pwd",
        projectId: "project-one",
        runtimeId: "desktop-local",
        agentMemberId: "codex-acp",
      });
    });

    expect(result.current.sessions.map((session) => session.threadId)).toEqual([
      "runtime-session-one",
    ]);

    await act(async () => {
      resolveFetch(
        new Response(JSON.stringify({ sessions: [] }), {
          headers: { "content-type": "application/json" },
        }),
      );
    });

    expect(result.current.sessions.map((session) => session.threadId)).toEqual([
      "runtime-session-one",
    ]);
  });

  it("moves sessions through archive, restore, and permanent delete without mixing the active list", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (
          url.endsWith("/api/v1/sessions?projectId=project-one") &&
          !init?.method
        ) {
          return new Response(
            JSON.stringify({
              sessions: [
                {
                  id: "session-one",
                  threadId: "session-one",
                  type: "runtime",
                  title: "Storyboard pass",
                  projectId: "project-one",
                },
              ],
            }),
            { headers: { "content-type": "application/json" } },
          );
        }
        if (
          url.endsWith(
            "/api/v1/sessions?projectId=project-one&archived=only",
          ) &&
          !init?.method
        ) {
          return new Response(JSON.stringify({ sessions: [] }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (
          url.endsWith("/api/v1/sessions/session-one") &&
          init?.method === "PATCH"
        ) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }
        if (
          url.endsWith("/api/v1/sessions?threadId=session-one") &&
          init?.method === "DELETE"
        ) {
          return new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("unexpected request", { status: 500 });
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useSessionHistory("project-one"));
    await waitFor(() => expect(result.current.sessions).toHaveLength(1));

    await act(async () => {
      await result.current.loadArchivedSessions();
    });
    expect(result.current.archivedSessions).toEqual([]);

    await act(async () => {
      await result.current.archiveSession("session-one");
    });
    expect(result.current.sessions).toEqual([]);
    expect(result.current.archivedSessions).toEqual([
      expect.objectContaining({
        threadId: "session-one",
        archivedAt: expect.any(String),
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/sessions\/session-one$/),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ archived: true }),
      }),
    );

    await act(async () => {
      await result.current.restoreSession("session-one");
    });
    expect(result.current.archivedSessions).toEqual([]);
    expect(result.current.sessions).toEqual([
      expect.objectContaining({
        threadId: "session-one",
        archivedAt: undefined,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/sessions\/session-one$/),
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ archived: false }),
      }),
    );

    await act(async () => {
      await result.current.archiveSession("session-one");
      await result.current.deleteSession("session-one");
    });
    expect(result.current.sessions).toEqual([]);
    expect(result.current.archivedSessions).toEqual([]);
  });
});
