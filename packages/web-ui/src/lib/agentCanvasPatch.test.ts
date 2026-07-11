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

  it("parses agent canvas edge operations from ACP events", () => {
    expect(parseAgentCanvasPatch({
      sessionUpdate: "clash.canvas.patch",
      operations: [
        {
          op: "add_edge",
          edge: {
            id: "agent-edge-1",
            source: "agent-node-1",
            target: "agent-node-2",
            type: "default",
            if_match: "edges-v1:graph-read",
          },
          force: true,
        },
      ],
    })).toEqual([
      {
        op: "add_edge",
        edge: {
          id: "agent-edge-1",
          source: "agent-node-1",
          target: "agent-node-2",
          type: "default",
        },
        ifMatch: "edges-v1:graph-read",
      },
    ]);
  });

  it("parses agent canvas edge update operations from ACP events", () => {
    expect(parseAgentCanvasPatch({
      sessionUpdate: "clash.canvas.patch",
      operations: [
        {
          op: "update_edge",
          edge: {
            id: "agent-edge-1",
            patch: {
              label: "primary",
              animated: true,
            },
            if_match: "edge-v1:update-read",
          },
          force: true,
        },
      ],
    })).toEqual([
      {
        op: "update_edge",
        edge: {
          id: "agent-edge-1",
          patch: {
            label: "primary",
            animated: true,
          },
        },
        ifMatch: "edge-v1:update-read",
      },
    ]);
  });

  it("parses agent canvas node delete operations from ACP events", () => {
    expect(parseAgentCanvasPatch({
      sessionUpdate: "clash.canvas.patch",
      operations: [
        {
          op: "delete_node",
          node: {
            id: "agent-node-1",
          },
          ifMatch: "node-v1:delete-read",
          force: true,
        },
      ],
    })).toEqual([
      {
        op: "delete_node",
        node: {
          id: "agent-node-1",
        },
        ifMatch: "node-v1:delete-read",
      },
    ]);
  });

  it("parses agent canvas edge delete operations from ACP events", () => {
    expect(parseAgentCanvasPatch({
      sessionUpdate: "clash.canvas.patch",
      operations: [
        {
          op: "delete_edge",
          edge: {
            id: "agent-edge-1",
            readToken: "edge-v1:delete-read",
          },
          force: true,
        },
      ],
    })).toEqual([
      {
        op: "delete_edge",
        edge: {
          id: "agent-edge-1",
        },
        ifMatch: "edge-v1:delete-read",
      },
    ]);
  });

  it("parses timeline apply operations from ACP events", () => {
    expect(parseAgentCanvasPatch({
      sessionUpdate: "clash.canvas.patch",
      operations: [
        {
          op: "timeline_apply",
          timeline: {
            nodeId: "timeline-node-1",
            dsl: {
              fps: 30,
              durationInFrames: 90,
              tracks: [{ id: "main", type: "video", items: [] }],
            },
            force: true,
            if_match: "node-v1:timeline-read",
          },
        },
      ],
    })).toEqual([
      {
        op: "timeline_apply",
        timeline: {
          nodeId: "timeline-node-1",
          dsl: {
            fps: 30,
            durationInFrames: 90,
            tracks: [{ id: "main", type: "video", items: [] }],
          },
          ifMatch: "node-v1:timeline-read",
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
