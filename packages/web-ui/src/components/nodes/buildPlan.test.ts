import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Edge, Node } from "@xyflow/react";

import { computeBuildPlan, computeBuildPlanFromGraph } from "./buildPlan";

describe("build plan graph lookup", () => {
  it("keeps ReactFlow as an adapter over the shared headless planner", () => {
    const source = readFileSync(
      new URL("./buildPlan.ts", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(
      /computeActionBuildPlan[\s\S]*from ['"]@clash\/shared-types['"]/,
    );
    expect(source).not.toContain("const dfs =");
  });

  it("matches the array-based build plan result", () => {
    const nodes: Node<Record<string, unknown>>[] = [
      {
        id: "source-1",
        type: "image",
        position: { x: 0, y: 0 },
        data: { status: "completed" },
      },
      {
        id: "action-1",
        type: "action-badge",
        position: { x: 100, y: 0 },
        data: { content: "Generate", modelId: "nano-banana-2" },
      },
      {
        id: "draft-1",
        type: "image",
        position: { x: 200, y: 0 },
        data: { label: "Draft", status: "draft" },
      },
    ];
    const edges: Edge[] = [
      { id: "source-action", source: "source-1", target: "action-1" },
      { id: "action-draft", source: "action-1", target: "draft-1" },
    ];
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, Edge[]>();
    for (const edge of edges) {
      const list = incoming.get(edge.target);
      if (list) list.push(edge);
      else incoming.set(edge.target, [edge]);
    }

    const arrayPlan = computeBuildPlan("draft-1", nodes, edges);
    const lookupPlan = computeBuildPlanFromGraph(
      "draft-1",
      (nodeId) => nodeById.get(nodeId),
      (nodeId) => incoming.get(nodeId) ?? [],
    );

    expect(lookupPlan).toEqual(arrayPlan);
  });

  it("preserves custom Action invocation semantics through the ReactFlow adapter", () => {
    const nodes: Node<Record<string, unknown>>[] = [
      {
        id: "custom-action",
        type: "action-badge",
        position: { x: 0, y: 0 },
        data: {
          actionType: "custom:grid-split",
          customActionId: "grid-split",
          label: "Grid split",
        },
      },
      {
        id: "draft",
        type: "image",
        position: { x: 100, y: 0 },
        data: { status: "draft" },
      },
    ];

    const plan = computeBuildPlan("draft", nodes, [
      { id: "custom-output", source: "custom-action", target: "draft" },
    ]);

    expect(plan.blockers).toEqual([]);
    expect(plan.estimatedInvocations).toEqual([
      {
        actionDefinitionRef: "custom:grid-split",
        actionDefinitionName: "Grid split",
        kind: "custom",
        count: 1,
      },
    ]);
  });
});
