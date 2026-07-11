import { describe, expect, it } from "vitest";
import { LoroDoc } from "loro-crdt";
import { Canvas } from "./canvas-ops";
import {
  computeActionBuildPlan,
  computeCanvasActionBuildPlan,
  type ActionBuildGraphEdge,
  type ActionBuildGraphNode,
} from "./action-build-plan";

function graphReader(
  nodes: ActionBuildGraphNode[],
  edges: ActionBuildGraphEdge[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return {
    getNode: (nodeId: string) => nodeById.get(nodeId),
    getIncomingEdges: (nodeId: string) =>
      edges.filter((edge) => edge.target === nodeId),
  };
}

describe("headless Action build planner", () => {
  it("builds the minimum upstream draft closure in deterministic order", () => {
    const nodes: ActionBuildGraphNode[] = [
      { id: "completed-source", type: "image", data: { status: "completed" } },
      {
        id: "action-z",
        type: "action-badge",
        data: { content: "Generate Z", modelId: "nano-banana-2" },
      },
      { id: "draft-z", type: "image", data: { label: "Z", status: "draft" } },
      {
        id: "action-a",
        type: "action-badge",
        data: { content: "Generate A", modelId: "nano-banana-2" },
      },
      { id: "draft-a", type: "image", data: { label: "A", status: "idle" } },
      {
        id: "action-target",
        type: "action-badge",
        data: { prompt: "Combine", modelId: "sora-2" },
      },
      {
        id: "draft-target",
        type: "video",
        data: { label: "Final", status: "draft" },
      },
    ];
    const edges: ActionBuildGraphEdge[] = [
      { source: "action-target", target: "draft-target" },
      { source: "draft-z", target: "action-target" },
      { source: "completed-source", target: "action-target" },
      { source: "draft-a", target: "action-target" },
      { source: "action-z", target: "draft-z" },
      { source: "action-a", target: "draft-a" },
    ];

    const plan = computeActionBuildPlan(
      "draft-target",
      graphReader(nodes, edges),
    );

    expect(plan.entries.map((entry) => entry.draftId)).toEqual([
      "draft-a",
      "draft-z",
      "draft-target",
    ]);
    expect(plan.entries.map((entry) => entry.actionNodeId)).toEqual([
      "action-a",
      "action-z",
      "action-target",
    ]);
    expect(plan.estimatedInvocations).toEqual([
      {
        actionDefinitionRef: "model:nano-banana-2",
        actionDefinitionName: "Nano Banana 2",
        kind: "model",
        count: 2,
      },
      {
        actionDefinitionRef: "model:sora-2",
        actionDefinitionName: "Sora 2",
        kind: "model",
        count: 1,
      },
    ]);
    expect(plan.blockers).toEqual([]);
    expect(plan.cycle).toBe(false);
  });

  it("reports cycles without returning a partial execution plan", () => {
    const nodes: ActionBuildGraphNode[] = [
      {
        id: "action-1",
        type: "action-badge",
        data: { content: "Generate", modelId: "nano-banana-2" },
      },
      { id: "draft-1", type: "image", data: { status: "draft" } },
    ];
    const edges: ActionBuildGraphEdge[] = [
      { source: "action-1", target: "draft-1" },
      { source: "draft-1", target: "action-1" },
    ];

    expect(
      computeActionBuildPlan("draft-1", graphReader(nodes, edges)),
    ).toMatchObject({
      entries: [],
      blockers: ["Cycle detected in dependency graph."],
      cycle: true,
    });
  });

  it("plans custom Actions without inventing a model or prompt requirement", () => {
    const nodes: ActionBuildGraphNode[] = [
      {
        id: "custom-action",
        type: "action-badge",
        data: {
          actionType: "custom:grid-split",
          customActionId: "grid-split",
          label: "Grid split",
        },
      },
      { id: "custom-output", type: "image", data: { status: "draft" } },
    ];
    const edges = [{ source: "custom-action", target: "custom-output" }];

    const plan = computeActionBuildPlan(
      "custom-output",
      graphReader(nodes, edges),
    );

    expect(plan.blockers).toEqual([]);
    expect(plan.entries[0]).toMatchObject({
      actionNodeId: "custom-action",
      actionDefinitionRef: "custom:grid-split",
      actionDefinitionName: "Grid split",
      kind: "custom",
      hasPrompt: false,
    });
    expect(plan.estimatedInvocations).toEqual([
      {
        actionDefinitionRef: "custom:grid-split",
        actionDefinitionName: "Grid split",
        kind: "custom",
        count: 1,
      },
    ]);
  });

  it("produces the same plan from downstream-owned Canvas upstream references", () => {
    const doc = new LoroDoc();
    const canvas = new Canvas(doc, () => {}, "main");
    canvas.insertNode("source", "image", { status: "completed" }, null, {
      x: 0,
      y: 0,
    });
    canvas.insertNode(
      "action",
      "action-badge",
      { content: "Generate", modelId: "nano-banana-2" },
      null,
      { x: 100, y: 0 },
    );
    canvas.insertNode(
      "draft",
      "image",
      { label: "Draft", status: "draft" },
      null,
      { x: 200, y: 0 },
    );
    canvas.insertEdge("source-action", "source", "action");
    canvas.insertEdge("action-draft", "action", "draft");

    const nodes = canvas.listNodes();
    const edges = canvas.listEdges();

    expect(computeCanvasActionBuildPlan("draft", canvas)).toEqual(
      computeActionBuildPlan("draft", graphReader(nodes, edges)),
    );
  });
});
