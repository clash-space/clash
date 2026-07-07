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

  it("adds the returned local room message after send when no live echo is available", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "local-message-1",
          project_id: "project-1",
          sender_kind: "user",
          sender_id: "local-user",
          sender_user_id: "local-user",
          mentions: [],
          text: "hello local room",
          at: 1_700_000_001,
          sync: {
            mode: "local-only",
            remote_room: { enabled: false, status: "disabled" },
          },
        }), { status: 201, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({
        sync: {
          mode: "local-only",
          remote_room: { enabled: false, status: "disabled" },
        },
        messages: [],
      }), { headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useProjectRoom("project-1"));
    await waitFor(() => expect(result.current.sync?.mode).toBe("local-only"));

    await act(async () => {
      await result.current.send("hello local room");
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({
        id: "local-message-1",
        type: "room.message",
        text: "hello local room",
      }),
    ]);
  });
});
