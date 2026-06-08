import { describe, expect, it, vi } from "vitest";
import { createConfiguredLocalAcpAdapter } from "./server";

describe("local API server configuration", () => {
  it("can expose a deterministic mock ACP agent for desktop smoke tests", async () => {
    const adapter = createConfiguredLocalAcpAdapter({ CLASH_LOCAL_ACP_MOCK: "1" });

    await expect(adapter.listRuntimes()).resolves.toMatchObject({
      runtimes: [
        {
          id: "desktop-local",
          agents: [{ id: "mock-acp", binary: "mock-acp" }],
          status: "online",
        },
      ],
    });

    const created = await adapter.createSession({
      runtimeId: "desktop-local",
      crewId: "director",
      crewMemberId: "mock-crew",
      projectId: "mock-project",
    });
    const handlers = new Map<string, (raw?: unknown) => void>();
    const sent: unknown[] = [];
    const ws = {
      OPEN: 1,
      readyState: 1,
      send: vi.fn((raw: string) => sent.push(JSON.parse(raw) as unknown)),
      on: vi.fn((event: string, handler: (raw?: unknown) => void) => {
        handlers.set(event, handler);
      }),
      close: vi.fn(),
    };

    adapter.bindSessionSocket(created.session_id, ws as never);
    handlers.get("message")?.(JSON.stringify({
      type: "prompt",
      turn_id: "turn-smoke",
      text: "hello local agent",
    }));

    await vi.waitFor(() => {
      expect(sent).toContainEqual({
        type: "session.complete",
        session_id: created.session_id,
        turn_id: "turn-smoke",
      });
    });
    expect(sent).toContainEqual({
      type: "session.event",
      session_id: created.session_id,
      turn_id: "turn-smoke",
      event: {
        sessionUpdate: "clash.canvas.patch",
        operations: [
          {
            op: "add_node",
            node: {
              id: "mock-agent-stage-turn-smoke",
              type: "group",
              data: { label: "Agent Stage" },
              position: { x: 480, y: 140 },
              width: 620,
              height: 360,
              style: { width: 620, height: 360 },
            },
          },
          {
            op: "add_node",
            node: {
              id: "mock-agent-brief-turn-smoke",
              type: "action-badge",
              data: {
                label: "Agent Brief",
                actionType: "text-gen",
                content: "# Agent Brief\nhello local agent",
              },
              position: { x: 530, y: 210 },
              width: 260,
              height: 48,
            },
          },
          {
            op: "add_node",
            node: {
              id: "mock-agent-action-turn-smoke",
              type: "action-badge",
              data: {
                label: "Agent Image Pass",
                actionType: "image-gen",
                content: "# Prompt\nhello local agent",
              },
              position: { x: 530, y: 320 },
              width: 260,
              height: 48,
            },
          },
        ],
      },
    });

    await expect(adapter.listSessionMessages(created.session_id)).resolves.toMatchObject({
      messages: [
        {
          id: "turn-smoke-user",
          sender_kind: "user",
          sender_id: "local-user",
          turn_id: "turn-smoke",
          events: [{ type: "text", text: "hello local agent" }],
        },
        {
          id: "turn-smoke-crew",
          sender_kind: "crew",
          sender_id: "mock-crew",
          turn_id: "turn-smoke",
          events: [
            { type: "text", text: "Mock ACP reply: hello local agent" },
            { sessionUpdate: "clash.canvas.patch" },
          ],
        },
      ],
    });
  });
});
