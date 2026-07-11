import { MODEL_CARDS } from "./models";

export type ActionBuildModality = "image" | "video" | "audio" | "text";
export type ActionBuildInvocationKind = "model" | "custom";

export interface ActionBuildPlanEntry {
  draftId: string;
  actionNodeId: string | null;
  actionDefinitionRef: string | null;
  actionDefinitionName: string;
  kind: ActionBuildInvocationKind | null;
  modality: ActionBuildModality;
  label: string;
  hasPrompt: boolean;
}

export interface ActionBuildInvocationEstimate {
  actionDefinitionRef: string;
  actionDefinitionName: string;
  kind: ActionBuildInvocationKind;
  count: number;
}

export interface ActionBuildPlan {
  entries: ActionBuildPlanEntry[];
  estimatedInvocations: ActionBuildInvocationEstimate[];
  blockers: string[];
  warnings: string[];
  cycle: boolean;
}

export interface ActionBuildGraphNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

export interface ActionBuildGraphEdge {
  source: string;
  target: string;
}

export interface ActionBuildGraphReader {
  getNode(nodeId: string): ActionBuildGraphNode | undefined;
  getIncomingEdges(nodeId: string): readonly ActionBuildGraphEdge[];
}

export interface CanvasActionBuildGraph {
  listNodes(): ActionBuildGraphNode[];
  listEdges(): ActionBuildGraphEdge[];
}

function isDraftStatus(status: unknown): boolean {
  return status === "draft" || status === "idle";
}

function sortedIncomingEdges(
  reader: ActionBuildGraphReader,
  nodeId: string,
): ActionBuildGraphEdge[] {
  return [...reader.getIncomingEdges(nodeId)].sort((left, right) => {
    const sourceOrder = left.source.localeCompare(right.source);
    return sourceOrder !== 0
      ? sourceOrder
      : left.target.localeCompare(right.target);
  });
}

/**
 * Computes the minimum reverse-DAG closure needed to realize a target draft.
 * The reader keeps the planner independent from ReactFlow, Loro, and transport.
 */
export function computeActionBuildPlan(
  targetId: string,
  reader: ActionBuildGraphReader,
): ActionBuildPlan {
  const visited = new Set<string>();
  const inProgress = new Set<string>();
  const orderedDraftIds: string[] = [];
  let cycle = false;

  const visit = (nodeId: string): void => {
    if (cycle) return;
    if (inProgress.has(nodeId)) {
      cycle = true;
      return;
    }
    if (visited.has(nodeId)) return;

    inProgress.add(nodeId);
    const node = reader.getNode(nodeId);
    if (!node) {
      inProgress.delete(nodeId);
      visited.add(nodeId);
      return;
    }

    const status = node.data?.status;
    const isAction = node.type === "action-badge";
    const isDraft = !isAction && isDraftStatus(status);

    if (isAction || isDraft) {
      for (const edge of sortedIncomingEdges(reader, nodeId))
        visit(edge.source);
      if (cycle) {
        inProgress.delete(nodeId);
        return;
      }
      if (isDraft) orderedDraftIds.push(nodeId);
    }

    inProgress.delete(nodeId);
    visited.add(nodeId);
  };

  visit(targetId);

  if (cycle) {
    return {
      entries: [],
      estimatedInvocations: [],
      blockers: ["Cycle detected in dependency graph."],
      warnings: [],
      cycle: true,
    };
  }

  const entries: ActionBuildPlanEntry[] = [];
  const estimates = new Map<string, ActionBuildInvocationEstimate>();
  const blockers: string[] = [];
  const warnings: string[] = [];

  for (const draftId of orderedDraftIds) {
    const draft = reader.getNode(draftId);
    if (!draft) continue;
    const draftData = draft.data ?? {};

    const actionEdge = sortedIncomingEdges(reader, draftId).find(
      (edge) => reader.getNode(edge.source)?.type === "action-badge",
    );
    const action = actionEdge ? reader.getNode(actionEdge.source) : undefined;
    const actionData = action?.data ?? {};

    const actionType =
      typeof actionData.actionType === "string" ? actionData.actionType : "";
    const customActionId =
      typeof actionData.customActionId === "string"
        ? actionData.customActionId
        : "";
    const isCustom =
      actionType.startsWith("custom:") || customActionId.length > 0;
    const modelId =
      typeof actionData.modelId === "string" ? actionData.modelId : "";
    const actionDefinitionRef = isCustom
      ? actionType.startsWith("custom:")
        ? actionType
        : `custom:${customActionId}`
      : modelId
        ? `model:${modelId}`
        : null;
    const kind: ActionBuildInvocationKind | null = action
      ? isCustom
        ? "custom"
        : "model"
      : null;
    const actionLabel =
      typeof actionData.label === "string" ? actionData.label.trim() : "";
    const actionDefinitionName = isCustom
      ? actionLabel ||
        customActionId ||
        actionType.replace(/^custom:/, "") ||
        "Custom action"
      : modelId
        ? (MODEL_CARDS.find((card) => card.id === modelId)?.name ?? modelId)
        : "Unknown";
    const rawLabel =
      typeof draftData.label === "string" ? draftData.label : draft.id;
    const label = rawLabel.trim() || draft.id;
    const content =
      typeof actionData.content === "string" ? actionData.content : "";
    const prompt =
      typeof actionData.prompt === "string" ? actionData.prompt : "";
    const hasPrompt = (content || prompt).trim().length > 0;
    const modality: ActionBuildModality =
      draft.type === "video" || draft.type === "audio" || draft.type === "text"
        ? draft.type
        : "image";

    entries.push({
      draftId,
      actionNodeId: action?.id ?? null,
      actionDefinitionRef,
      actionDefinitionName,
      kind,
      modality,
      label,
      hasPrompt,
    });

    if (!action) {
      warnings.push(`"${label}" has no upstream action — skipped at run time.`);
      continue;
    }
    if (!actionDefinitionRef) {
      blockers.push(`"${label}": no model selected on upstream action.`);
    } else {
      const current = estimates.get(actionDefinitionRef);
      if (current) current.count += 1;
      else {
        estimates.set(actionDefinitionRef, {
          actionDefinitionRef,
          actionDefinitionName,
          kind: kind ?? "model",
          count: 1,
        });
      }
    }
    if (kind === "model" && !hasPrompt) {
      blockers.push(`"${label}": upstream action has no prompt.`);
    }
  }

  if (entries.length === 0) {
    warnings.push("Nothing to build — target is not a draft.");
  }

  return {
    entries,
    estimatedInvocations: Array.from(estimates.values()).sort((left, right) =>
      left.actionDefinitionRef.localeCompare(right.actionDefinitionRef),
    ),
    blockers,
    warnings,
    cycle: false,
  };
}

export function computeCanvasActionBuildPlan(
  targetId: string,
  canvas: CanvasActionBuildGraph,
): ActionBuildPlan {
  const nodes = canvas.listNodes();
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, ActionBuildGraphEdge[]>();

  for (const edge of canvas.listEdges()) {
    const current = incoming.get(edge.target);
    if (current) current.push(edge);
    else incoming.set(edge.target, [edge]);
  }

  return computeActionBuildPlan(targetId, {
    getNode: (nodeId) => nodeById.get(nodeId),
    getIncomingEdges: (nodeId) => incoming.get(nodeId) ?? [],
  });
}

export function summarizeActionBuildInvocations(
  estimates: readonly ActionBuildInvocationEstimate[],
): ActionBuildInvocationEstimate[] {
  return [...estimates].sort(
    (left, right) =>
      right.count - left.count ||
      left.actionDefinitionName.localeCompare(right.actionDefinitionName) ||
      left.actionDefinitionRef.localeCompare(right.actionDefinitionRef),
  );
}
