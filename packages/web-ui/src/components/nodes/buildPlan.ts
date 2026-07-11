import type { Edge, Node as RFNode } from "@xyflow/react";
import {
  computeActionBuildPlan,
  summarizeActionBuildInvocations,
  type ActionBuildGraphEdge,
  type ActionBuildGraphNode,
  type ActionBuildPlan,
  type ActionBuildPlanEntry,
} from "@clash/shared-types";

export type PlanEntry = ActionBuildPlanEntry;
export type BuildPlan = ActionBuildPlan;

type BuildPlanNode = Pick<RFNode, "id" | "type" | "data">;
type BuildPlanEdge = Pick<Edge, "source" | "target">;

/** ReactFlow array adapter over the shared, surface-independent planner. */
export function computeBuildPlan(
  targetId: string,
  nodes: RFNode[],
  edges: Edge[],
): BuildPlan {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Edge[]>();

  for (const edge of edges) {
    const current = incoming.get(edge.target);
    if (current) current.push(edge);
    else incoming.set(edge.target, [edge]);
  }

  return computeBuildPlanFromGraph(
    targetId,
    (nodeId) => nodeById.get(nodeId),
    (nodeId) => incoming.get(nodeId) ?? [],
  );
}

/** ReactFlow lookup adapter used by store selectors without materializing all nodes. */
export function computeBuildPlanFromGraph(
  targetId: string,
  getNode: (nodeId: string) => BuildPlanNode | undefined,
  getIncomingEdges: (nodeId: string) => readonly BuildPlanEdge[],
): BuildPlan {
  return computeActionBuildPlan(targetId, {
    getNode: (nodeId): ActionBuildGraphNode | undefined => getNode(nodeId),
    getIncomingEdges: (nodeId): readonly ActionBuildGraphEdge[] =>
      getIncomingEdges(nodeId),
  });
}

export function summarizeInvocations(
  estimates: BuildPlan["estimatedInvocations"],
): BuildPlan["estimatedInvocations"] {
  return summarizeActionBuildInvocations(estimates);
}
