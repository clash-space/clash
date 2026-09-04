export type TrajectoryActionValueType =
  "image" | "video" | "audio" | "model" | "text" | "unknown";

export interface TrajectoryActionGraphNode {
  id: string;
  type?: string;
  data?: Record<string, unknown>;
}

export interface TrajectoryActionGraphEdge {
  id?: string;
  source: string;
  target: string;
  type?: string;
}

export interface TrajectoryActionPort {
  slot: string;
  nodeId: string;
  valueType: TrajectoryActionValueType;
}

export interface TrajectoryActionInputRef {
  slot: string;
  nodeId: string;
}

export interface TrajectoryActionStep {
  nodeId: string;
  inputNodeIds: string[];
  outputNodeIds: string[];
}

/**
 * Derived boundary over an existing Canvas graph closure. This is an
 * invocation projection, not a persisted CompositeAction or second workflow
 * language: the referenced Canvas nodes remain the execution authority.
 */
export interface TrajectoryAction {
  targetNodeIds: string[];
  graph: {
    nodeIds: string[];
    edges: TrajectoryActionGraphEdge[];
  };
  inputs: TrajectoryActionPort[];
  steps: TrajectoryActionStep[];
  outputs: TrajectoryActionPort[];
}

export type CompileTrajectoryActionResult =
  | { ok: true; action: TrajectoryAction }
  | {
      ok: false;
      error: {
        code: "TARGET_NOT_FOUND" | "CYCLE";
        message: string;
        nodeId?: string;
      };
    };

export interface CompileTrajectoryActionInput {
  targetNodeIds: string[];
  nodes: TrajectoryActionGraphNode[];
  edges: TrajectoryActionGraphEdge[];
}

export type BindTrajectoryActionInputsResult =
  | { ok: true; inputRefs: TrajectoryActionInputRef[] }
  | {
      ok: false;
      error: {
        code: "UNKNOWN_INPUT_SLOT" | "DUPLICATE_INPUT_SLOT";
        message: string;
        slot: string;
      };
    };

const ACTION_NODE_TYPES = new Set([
  "action-badge",
  "image-editor",
  "video-clipper",
  "video-editor",
]);

function isActionNode(node: TrajectoryActionGraphNode): boolean {
  return Boolean(node.type && ACTION_NODE_TYPES.has(node.type));
}

function valueType(node: TrajectoryActionGraphNode): TrajectoryActionValueType {
  const candidate = node.type ?? node.data?.outputType;
  return candidate === "image" ||
    candidate === "video" ||
    candidate === "audio" ||
    candidate === "model" ||
    candidate === "text"
    ? candidate
    : "unknown";
}

export function compileTrajectoryAction(
  input: CompileTrajectoryActionInput,
): CompileTrajectoryActionResult {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const orderById = new Map(input.nodes.map((node, index) => [node.id, index]));
  const compareNodeIds = (left: string, right: string): number =>
    (orderById.get(left) ?? Number.MAX_SAFE_INTEGER) -
      (orderById.get(right) ?? Number.MAX_SAFE_INTEGER) ||
    left.localeCompare(right);

  for (const targetNodeId of input.targetNodeIds) {
    if (!nodeById.has(targetNodeId)) {
      return {
        ok: false,
        error: {
          code: "TARGET_NOT_FOUND",
          message: `Trajectory Action target ${targetNodeId} was not found.`,
          nodeId: targetNodeId,
        },
      };
    }
  }

  const incoming = new Map<string, TrajectoryActionGraphEdge[]>();
  for (const edge of input.edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const current = incoming.get(edge.target) ?? [];
    current.push(edge);
    incoming.set(edge.target, current);
  }

  const included = new Set<string>();
  const pending = [...input.targetNodeIds];
  while (pending.length > 0) {
    const nodeId = pending.shift()!;
    if (included.has(nodeId)) continue;
    included.add(nodeId);
    const node = nodeById.get(nodeId)!;
    for (const edge of incoming.get(nodeId) ?? []) {
      const sourceNode = nodeById.get(edge.source)!;
      if (isActionNode(node) || isActionNode(sourceNode)) {
        pending.push(edge.source);
      }
    }
  }

  const graphEdges = input.edges.filter(
    (edge) => included.has(edge.source) && included.has(edge.target),
  );
  const outgoing = new Map<string, TrajectoryActionGraphEdge[]>();
  const inDegree = new Map<string, number>();
  for (const nodeId of included) inDegree.set(nodeId, 0);
  for (const edge of graphEdges) {
    const current = outgoing.get(edge.source) ?? [];
    current.push(edge);
    outgoing.set(edge.source, current);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const ready = [...included]
    .filter((nodeId) => (inDegree.get(nodeId) ?? 0) === 0)
    .sort(compareNodeIds);
  const orderedNodeIds: string[] = [];
  while (ready.length > 0) {
    const nodeId = ready.shift()!;
    orderedNodeIds.push(nodeId);
    for (const edge of outgoing.get(nodeId) ?? []) {
      const remaining = (inDegree.get(edge.target) ?? 1) - 1;
      inDegree.set(edge.target, remaining);
      if (remaining === 0) {
        ready.push(edge.target);
        ready.sort(compareNodeIds);
      }
    }
  }

  if (orderedNodeIds.length !== included.size) {
    return {
      ok: false,
      error: {
        code: "CYCLE",
        message: "Trajectory Action cannot contain a cycle.",
      },
    };
  }

  const inputs = orderedNodeIds
    .filter(
      (nodeId) =>
        (incoming.get(nodeId) ?? []).filter((edge) => included.has(edge.source))
          .length === 0 && !isActionNode(nodeById.get(nodeId)!),
    )
    .map((nodeId, index) => ({
      slot: `input:${index}`,
      nodeId,
      valueType: valueType(nodeById.get(nodeId)!),
    }));

  const steps = orderedNodeIds.flatMap((nodeId): TrajectoryActionStep[] => {
    const node = nodeById.get(nodeId)!;
    if (!isActionNode(node)) return [];
    return [
      {
        nodeId,
        inputNodeIds: (incoming.get(nodeId) ?? [])
          .filter((edge) => included.has(edge.source))
          .map((edge) => edge.source),
        outputNodeIds: (outgoing.get(nodeId) ?? []).map((edge) => edge.target),
      },
    ];
  });

  const targetNodeIds = [...new Set(input.targetNodeIds)];
  const outputs = targetNodeIds.map((nodeId, index) => ({
    slot: `output:${index}`,
    nodeId,
    valueType: valueType(nodeById.get(nodeId)!),
  }));

  return {
    ok: true,
    action: {
      targetNodeIds,
      graph: { nodeIds: orderedNodeIds, edges: graphEdges },
      inputs,
      steps,
      outputs,
    },
  };
}

/**
 * Resolve an Action invocation's input node references. Callers only send the
 * slots they want to replace; every other slot keeps the node captured from
 * the source trajectory. The Action definition itself is never mutated.
 */
export function bindTrajectoryActionInputs(
  action: TrajectoryAction,
  inputRefs: readonly TrajectoryActionInputRef[],
): BindTrajectoryActionInputsResult {
  const portsBySlot = new Map(action.inputs.map((port) => [port.slot, port]));
  const overrides = new Map<string, string>();

  for (const inputRef of inputRefs) {
    if (!portsBySlot.has(inputRef.slot)) {
      return {
        ok: false,
        error: {
          code: "UNKNOWN_INPUT_SLOT",
          message: `Trajectory Action input slot ${inputRef.slot} was not found.`,
          slot: inputRef.slot,
        },
      };
    }
    if (overrides.has(inputRef.slot)) {
      return {
        ok: false,
        error: {
          code: "DUPLICATE_INPUT_SLOT",
          message: `Trajectory Action input slot ${inputRef.slot} was bound more than once.`,
          slot: inputRef.slot,
        },
      };
    }
    overrides.set(inputRef.slot, inputRef.nodeId);
  }

  return {
    ok: true,
    inputRefs: action.inputs.map((port) => ({
      slot: port.slot,
      nodeId: overrides.get(port.slot) ?? port.nodeId,
    })),
  };
}
