// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useProjectRoom } from "./useProjectRoom";

describe("useProjectRoom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("exposes cloud room sync metadata from the history response", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({
        sync: {
          mode: "cloud-sync",
          remote_room: { enabled: true, status: "imported" },
        },
        messages: [
          {
            id: "room-message-1",
            project_id: "project-1",
            sender_kind: "user",
            sender_id: "web-user",
            sender_user_id: "web-user",
            mentions: [],
            text: "hello",
            at: 1_700_000_000,
          },
        ],
      }), { headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProjectRoom("project-1"));

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.sync).toEqual({
      mode: "cloud-sync",
      remote_room: { enabled: true, status: "imported" },
    });
  });

  it("keeps remote/local room sync conflict plans available for UI recovery hints", async () => {
    const conflictResponse = {
      error: "room sync conflict",
      sync: {
        mode: "cloud-sync",
        remote_room: {
          enabled: true,
          status: "failed",
          error: "room sync conflict",
        },
      },
      plan: {
        exportedIds: [],
        importedIds: [],
        matchedIds: [],
        conflicts: [
          {
            id: "room-conflict-1",
            reason: "content-mismatch",
            local: {
              id: "room-conflict-1",
              project_id: "project-1",
              sender_kind: "user",
              sender_id: "local-user",
              sender_user_id: "local-user",
              mentions: [],
              text: "local text",
              at: 1_700_000_000,
              contentHash: "local-hash",
            },
            remote: {
              id: "room-conflict-1",
              project_id: "project-1",
              sender_kind: "user",
              sender_id: "remote-user",
              sender_user_id: "remote-user",
              mentions: [],
              text: "remote text",
              at: 1_700_000_001,
              contentHash: "remote-hash",
            },
          },
        ],
        resolvedConflictIds: [],
      },
    };
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify(conflictResponse), { status: 409, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        sync: {
          mode: "cloud-sync",
          remote_room: { enabled: true, status: "pending" },
        },
        messages: [],
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProjectRoom("project-1"));

    await waitFor(() => expect(result.current.sync?.remote_room.status).toBe("pending"));
    await act(async () => {
      await result.current.syncRoom();
    });

    await waitFor(() => expect(result.current.sync?.remote_room.status).toBe("failed"));
    expect(result.current.error).toBe("room sync conflict");
    expect(result.current.syncPlan?.conflicts).toEqual([
      expect.objectContaining({
        id: "room-conflict-1",
        local: expect.objectContaining({ contentHash: "local-hash" }),
        remote: expect.objectContaining({ contentHash: "remote-hash" }),
      }),
    ]);
  });

  it("refreshes room history after successful explicit sync so imported messages appear", async () => {
    let historyReads = 0;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          sync: {
            mode: "cloud-sync",
            remote_room: { enabled: true, status: "mirrored" },
          },
          plan: {
            exportedIds: [],
            importedIds: ["remote-room-1"],
            matchedIds: [],
            conflicts: [],
          },
        }), { headers: { "content-type": "application/json" } });
      }
      historyReads += 1;
      return new Response(JSON.stringify({
        sync: {
          mode: "cloud-sync",
          remote_room: { enabled: true, status: historyReads === 1 ? "pending" : "mirrored" },
        },
        messages: historyReads === 1
          ? []
          : [
              {
                id: "remote-room-1",
                project_id: "project-1",
                sender_kind: "user",
                sender_id: "remote-user",
                sender_user_id: "remote-user",
                mentions: [],
                text: "remote imported text",
                at: 1_700_000_010,
              },
            ],
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProjectRoom("project-1"));

    await waitFor(() => expect(result.current.sync?.remote_room.status).toBe("pending"));
    await act(async () => {
      await result.current.syncRoom();
    });

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]).toMatchObject({
      id: "remote-room-1",
      type: "room.message",
      text: "remote imported text",
    });
    expect(result.current.syncPlan?.importedIds).toEqual(["remote-room-1"]);
    expect(result.current.sync?.remote_room.status).toBe("mirrored");
  });

  it("treats removed local room endpoints as hosted-room unavailable instead of emulating local room", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") throw new Error("local room POST should not be called once unavailable");
      return new Response(JSON.stringify({
        error: "not found",
      }), { status: 404, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProjectRoom("project-1"));
    await waitFor(() => expect(result.current.sync?.admission?.allowed).toBe(false));
    expect(result.current.sync).toEqual({
      mode: "local-only",
      remote_room: { enabled: false, status: "disabled" },
      admission: {
        allowed: false,
        reason: null,
        requirements: [],
      },
    });
    expect(result.current.error).toBeNull();

    await act(async () => {
      await result.current.send("hello removed room");
    });

    await act(async () => {
      await result.current.syncRoom();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.messages).toEqual([]);
    expect(result.current.error).toBe("Cloud room is unavailable in this local project");
  });
});
