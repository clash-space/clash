import { describe, expect, it } from "vitest";
import {
  planCascadeTick,
  type CascadeGraphEdge,
  type CascadeGraphNode,
} from "./cascade-scheduler";

describe("cascade scheduler", () => {
  it("gives cancellation precedence over adoption for the whole cohort", () => {
    const nodes: CascadeGraphNode[] = [
      { id: "action", type: "action-badge", data: {} },
      {
        id: "draft-a",
        type: "image",
        data: {
          status: "draft",
          runRequested: true,
          cascadeToken: "cohort-1",
          cascadeCancel: true,
        },
      },
      {
        id: "draft-b",
        type: "image",
        data: { status: "draft", runRequested: true, cascadeToken: "cohort-1" },
      },
    ];
    const edges: CascadeGraphEdge[] = [
      { source: "action", target: "draft-a" },
      { source: "action", target: "draft-b" },
    ];

    expect(planCascadeTick({ nodes, edges }).decisions).toEqual([
      {
        kind: "clear",
        nodeId: "draft-a",
        reason: "cancel",
        causeNodeId: "draft-a",
      },
      {
        kind: "clear",
        nodeId: "draft-b",
        reason: "cancel",
        causeNodeId: "draft-a",
      },
    ]);
  });

  it("short-circuits a failed cohort before a ready peer can adopt", () => {
    const nodes: CascadeGraphNode[] = [
      { id: "action", type: "action-badge", data: {} },
      {
        id: "failed",
        type: "image",
        data: { status: "failed", cascadeToken: "cohort-1" },
      },
      {
        id: "waiting",
        type: "image",
        data: { status: "draft", runRequested: true, cascadeToken: "cohort-1" },
      },
    ];

    expect(
      planCascadeTick({
        nodes,
        edges: [{ source: "action", target: "waiting" }],
      }).decisions,
    ).toEqual([
      {
        kind: "clear",
        nodeId: "waiting",
        reason: "failure",
        causeNodeId: "failed",
      },
    ]);
  });

  it("waits until every Action input is completed", () => {
    const nodes: CascadeGraphNode[] = [
      { id: "source-a", type: "image", data: { status: "completed" } },
      { id: "source-b", type: "image", data: { status: "draft" } },
      { id: "action", type: "action-badge", data: {} },
      {
        id: "draft",
        type: "video",
        data: { status: "draft", runRequested: true },
      },
    ];

    expect(
      planCascadeTick({
        nodes,
        edges: [
          { source: "source-a", target: "action" },
          { source: "source-b", target: "action" },
          { source: "action", target: "draft" },
        ],
      }).decisions,
    ).toEqual([]);
  });

  it("returns a framework-neutral adoption decision when the gate is ready", () => {
    const nodes: CascadeGraphNode[] = [
      { id: "source", type: "image", data: { status: "completed" } },
      { id: "action", type: "action-badge", data: {} },
      {
        id: "draft",
        type: "video",
        data: { status: "draft", runRequested: true, cascadeToken: "cohort-1" },
      },
    ];

    expect(
      planCascadeTick({
        nodes,
        edges: [
          { source: "source", target: "action" },
          { source: "action", target: "draft" },
        ],
      }).decisions,
    ).toEqual([
      {
        kind: "adopt",
        draftNodeId: "draft",
        actionNodeId: "action",
        cascadeToken: "cohort-1",
      },
    ]);
  });

  it("clears an orphaned run request instead of waiting forever", () => {
    const nodes: CascadeGraphNode[] = [
      {
        id: "draft",
        type: "image",
        data: { status: "draft", runRequested: true },
      },
    ];

    expect(planCascadeTick({ nodes, edges: [] }).decisions).toEqual([
      { kind: "clear", nodeId: "draft", reason: "missing-action" },
    ]);
  });
});
