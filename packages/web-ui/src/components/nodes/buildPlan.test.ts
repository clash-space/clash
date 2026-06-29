import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import { computeBuildPlan, computeBuildPlanFromGraph } from "./buildPlan";

describe("build plan graph lookup", () => {
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
});
