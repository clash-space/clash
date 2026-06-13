import { describe, expect, it } from "vitest";
import { applyAgentAttribution, parseAgentCanvasPatch } from "./agentCanvasPatch";

describe("parseAgentCanvasPatch", () => {
  it("parses agent canvas add-node operations from ACP events", () => {
    expect(parseAgentCanvasPatch({
      sessionUpdate: "clash.canvas.patch",
      operations: [
        {
          op: "add_node",
          node: {
            id: "agent-node-1",
            type: "text",
            data: { label: "Agent node", content: "Created by agent" },
            position: { x: 120, y: 240 },
            width: 300,
            height: 180,
          },
        },
      ],
    })).toEqual([
      {
        op: "add_node",
        node: {
          id: "agent-node-1",
          type: "text",
          data: { label: "Agent node", content: "Created by agent" },
          position: { x: 120, y: 240 },
          width: 300,
          height: 180,
        },
      },
    ]);
  });

  it("accepts ACP events wrapped under update and ignores invalid operations", () => {
    expect(parseAgentCanvasPatch({
      update: {
        sessionUpdate: "clash.canvas.patch",
        operations: [
          { op: "delete_everything" },
          {
            op: "add_node",
            node: {
              id: "wrapped-node",
              type: "group",
              data: { label: "Wrapped" },
              position: { x: 10, y: 20 },
              style: { width: 400, height: 240 },
            },
          },
        ],
      },
    })).toEqual([
      {
        op: "add_node",
        node: {
          id: "wrapped-node",
          type: "group",
          data: { label: "Wrapped" },
          position: { x: 10, y: 20 },
          style: { width: 400, height: 240 },
        },
      },
    ]);
  });

  it("stamps local runtime patch nodes as the user's agent when attribution is missing", () => {
    expect(applyAgentAttribution(
      { label: "Agent node", actorType: "user" },
      { actorUserId: "local-user", actorAgentId: "codex-cli" },
    )).toEqual({
      label: "Agent node",
      actorType: "agent",
      actorUserId: "local-user",
      actorAgentId: "codex-cli",
    });

    expect(applyAgentAttribution(
      { label: "Explicit agent", actorType: "agent", actorUserId: "other-user", actorAgentId: "explicit-agent" },
      { actorUserId: "local-user", actorAgentId: "codex-cli" },
    )).toEqual({
      label: "Explicit agent",
      actorType: "agent",
      actorUserId: "other-user",
      actorAgentId: "explicit-agent",
    });
  });
});
