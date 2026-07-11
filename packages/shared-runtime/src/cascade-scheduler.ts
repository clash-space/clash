export interface CascadeGraphNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

export interface CascadeGraphEdge {
  source: string;
  target: string;
}

export type CascadeClearReason = "cancel" | "failure" | "missing-action";

export interface CascadeClearDecision {
  kind: "clear";
  nodeId: string;
  reason: CascadeClearReason;
  causeNodeId?: string;
}

export interface CascadeAdoptDecision {
  kind: "adopt";
  draftNodeId: string;
  actionNodeId: string;
  cascadeToken?: string;
}

export type CascadeDecision = CascadeClearDecision | CascadeAdoptDecision;

export interface CascadeTickInput {
  nodes: readonly CascadeGraphNode[];
  edges: readonly CascadeGraphEdge[];
}

export interface CascadeTickPlan {
  decisions: CascadeDecision[];
}

type TerminalCohort = {
  reason: "cancel" | "failure";
  causeNodeId: string;
};

function textData(node: CascadeGraphNode, key: string): string | undefined {
  const value = node.data?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Plans one deterministic cascade tick without reading or mutating UI state.
 * Terminal cohort events always win over adoption in the same tick.
 */
export function planCascadeTick(input: CascadeTickInput): CascadeTickPlan {
  const nodes = [...input.nodes].sort((left, right) =>
    left.id.localeCompare(right.id),
  );
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, CascadeGraphEdge[]>();

  for (const edge of input.edges) {
    const current = incomingByTarget.get(edge.target);
    if (current) current.push(edge);
    else incomingByTarget.set(edge.target, [edge]);
  }
  for (const incoming of incomingByTarget.values()) {
    incoming.sort(
      (left, right) =>
        left.source.localeCompare(right.source) ||
        left.target.localeCompare(right.target),
    );
  }

  const cohortsByToken = new Map<string, CascadeGraphNode[]>();
  for (const node of nodes) {
    const token = textData(node, "cascadeToken");
    if (!token) continue;
    const current = cohortsByToken.get(token);
    if (current) current.push(node);
    else cohortsByToken.set(token, [node]);
  }

  const terminalByToken = new Map<string, TerminalCohort>();
  const decisions: CascadeDecision[] = [];

  for (const node of nodes) {
    if (!node.data?.cascadeCancel) continue;
    const token = textData(node, "cascadeToken");
    if (token) {
      if (!terminalByToken.has(token)) {
        terminalByToken.set(token, { reason: "cancel", causeNodeId: node.id });
      }
    } else {
      decisions.push({
        kind: "clear",
        nodeId: node.id,
        reason: "cancel",
        causeNodeId: node.id,
      });
    }
  }

  for (const node of nodes) {
    if (node.data?.status !== "failed") continue;
    const token = textData(node, "cascadeToken");
    if (!token || terminalByToken.has(token)) continue;
    terminalByToken.set(token, { reason: "failure", causeNodeId: node.id });
  }

  for (const [token, terminal] of Array.from(terminalByToken.entries()).sort(
    ([left], [right]) => left.localeCompare(right),
  )) {
    for (const node of cohortsByToken.get(token) ?? []) {
      if (!node.data?.runRequested && !node.data?.cascadeCancel) continue;
      decisions.push({
        kind: "clear",
        nodeId: node.id,
        reason: terminal.reason,
        causeNodeId: terminal.causeNodeId,
      });
    }
  }

  for (const draft of nodes) {
    const data = draft.data;
    if (!data || (data.status !== "draft" && data.status !== "idle")) continue;
    if (!data.runRequested) continue;
    const token = textData(draft, "cascadeToken");
    if (token && terminalByToken.has(token)) continue;

    const actionEdge = (incomingByTarget.get(draft.id) ?? []).find(
      (edge) => nodeById.get(edge.source)?.type === "action-badge",
    );
    const action = actionEdge ? nodeById.get(actionEdge.source) : undefined;
    if (!action) {
      decisions.push({
        kind: "clear",
        nodeId: draft.id,
        reason: "missing-action",
      });
      continue;
    }

    const allInputsCompleted = (incomingByTarget.get(action.id) ?? []).every(
      (edge) => nodeById.get(edge.source)?.data?.status === "completed",
    );
    if (!allInputsCompleted) continue;

    decisions.push({
      kind: "adopt",
      draftNodeId: draft.id,
      actionNodeId: action.id,
      ...(token ? { cascadeToken: token } : {}),
    });
  }

  return { decisions };
}
