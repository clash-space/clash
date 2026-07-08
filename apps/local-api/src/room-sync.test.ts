import { describe, expect, it, vi } from "vitest";
import {
  createHttpRemoteRoomSync,
  planRoomMirror,
  type RemoteRoomMessage,
} from "./room-sync";

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
      sender_user_id: "local-user",
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
          sender_user_id: "local-user",
          mentions: [{ agent_member_id: "agent-2" }],
        }),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token-1");
    expect(headers.get("content-type")).toBe("application/json");
  });
});

function roomMessage(
  overrides: Partial<RemoteRoomMessage> & { id: string; text?: string; at?: number },
): RemoteRoomMessage {
  return {
    id: overrides.id,
    project_id: overrides.project_id ?? "project-1",
    sender_kind: overrides.sender_kind ?? "user",
    sender_id: overrides.sender_id ?? "user-1",
    sender_user_id: overrides.sender_user_id ?? "user-1",
    mentions: overrides.mentions ?? [],
    text: overrides.text ?? "ping",
    at: overrides.at ?? 100,
  };
}

describe("planRoomMirror", () => {
  it("plans missing local and remote room messages in append order", () => {
    const plan = planRoomMirror({
      localMessages: [
        roomMessage({ id: "local-newer", text: "local newer", at: 30 }),
        roomMessage({ id: "local-older", text: "local older", at: 20 }),
      ],
      remoteMessages: [
        roomMessage({ id: "remote-newer", text: "remote newer", at: 40 }),
        roomMessage({ id: "remote-older", text: "remote older", at: 10 }),
      ],
    });

    expect(plan.exportToRemote.map((message) => message.id)).toEqual(["local-older", "local-newer"]);
    expect(plan.importToLocal.map((message) => message.id)).toEqual(["remote-older", "remote-newer"]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.matchedIds).toEqual([]);
  });

  it("treats identical id replays as already mirrored independent of mention order", () => {
    const plan = planRoomMirror({
      localMessages: [
        roomMessage({
          id: "room-1",
          mentions: [{ agent_member_id: "agent-1" }, { user_id: "user-2" }],
        }),
      ],
      remoteMessages: [
        roomMessage({
          id: "room-1",
          mentions: [{ user_id: "user-2" }, { agent_member_id: "agent-1" }],
        }),
      ],
    });

    expect(plan.exportToRemote).toEqual([]);
    expect(plan.importToLocal).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.matchedIds).toEqual(["room-1"]);
  });

  it("surfaces same-id content conflicts without planning an overwrite", () => {
    const plan = planRoomMirror({
      localMessages: [
        roomMessage({ id: "room-1", text: "local text" }),
        roomMessage({ id: "local-only", text: "safe local", at: 110 }),
      ],
      remoteMessages: [
        roomMessage({ id: "room-1", text: "remote text" }),
        roomMessage({ id: "remote-only", text: "safe remote", at: 90 }),
      ],
    });

    expect(plan.exportToRemote.map((message) => message.id)).toEqual(["local-only"]);
    expect(plan.importToLocal.map((message) => message.id)).toEqual(["remote-only"]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        id: "room-1",
        reason: "content-mismatch",
      }),
    ]);
    expect(plan.matchedIds).toEqual([]);
  });

  it("surfaces same-id mention conflicts without planning an overwrite", () => {
    const plan = planRoomMirror({
      localMessages: [
        roomMessage({ id: "room-1", mentions: [{ agent_member_id: "agent-1" }] }),
      ],
      remoteMessages: [
        roomMessage({ id: "room-1", mentions: [{ agent_member_id: "agent-2" }] }),
      ],
    });

    expect(plan.exportToRemote).toEqual([]);
    expect(plan.importToLocal).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({
        id: "room-1",
        reason: "content-mismatch",
      }),
    ]);
  });
});
