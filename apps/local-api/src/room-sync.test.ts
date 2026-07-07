import { describe, expect, it, vi } from "vitest";
import { createHttpRemoteRoomSync } from "./room-sync";

describe("createHttpRemoteRoomSync", () => {
  it("preserves agent-member-only mentions when listing remote room messages", async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) =>
      new Response(JSON.stringify({
        messages: [
          {
            id: "room-1",
            project_id: "project-1",
            sender_kind: "user",
            sender_id: "user-1",
            sender_user_id: "user-1",
            mentions: [
              { agent_member_id: "agent-1" },
              { user_id: "user-2", agent_member_id: "agent-2" },
              {},
            ],
            text: "ping",
            at: 100,
          },
        ],
      }), { headers: { "content-type": "application/json" } }),
    );
    const sync = createHttpRemoteRoomSync({
      baseUrl: "https://api.example.com/",
      token: "token-1",
      fetch: fetchMock,
    });

    await expect(sync.listMessages("project-1")).resolves.toEqual([
      expect.objectContaining({
        id: "room-1",
        mentions: [
          { agent_member_id: "agent-1" },
          { user_id: "user-2", agent_member_id: "agent-2" },
        ],
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/projects/project-1/room/messages",
      expect.objectContaining({
        method: "GET",
        headers: expect.any(Headers),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token-1");
  });

  it("posts remote room messages with stable ids and mention payloads", async () => {
    const fetchMock = vi.fn(async (_input: string, _init?: RequestInit) => new Response(null, { status: 201 }));
    const sync = createHttpRemoteRoomSync({
      baseUrl: "https://api.example.com",
      token: "token-1",
      fetch: fetchMock,
    });

    await sync.postMessage("project/one", {
      id: "room-1",
      text: "ping",
      sender_kind: "agent",
      sender_id: "agent-1",
      mentions: [{ agent_member_id: "agent-2" }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/api/v1/projects/project%2Fone/room/messages",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          id: "room-1",
          text: "ping",
          sender_kind: "agent",
          sender_id: "agent-1",
          mentions: [{ agent_member_id: "agent-2" }],
        }),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.get("content-type")).toBe("application/json");
  });
});
