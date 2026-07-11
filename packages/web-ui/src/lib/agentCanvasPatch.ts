export interface AgentCanvasNodePatch {
  id: string;
  type: string;
  data?: Record<string, unknown>;
  position?: { x: number; y: number };
  parentId?: string;
  width?: number;
  height?: number;
  style?: Record<string, unknown>;
}

export interface AgentCanvasAddNodeOperation {
  op: "add_node";
  node: AgentCanvasNodePatch;
}

export interface AgentCanvasDeleteNodeOperation {
  op: "delete_node";
  node: Pick<AgentCanvasNodePatch, "id">;
  ifMatch?: string;
}

export interface AgentCanvasEdgePatch {
  id: string;
  source: string;
  target: string;
  type?: string;
}

export interface AgentCanvasAddEdgeOperation {
  op: "add_edge";
  edge: AgentCanvasEdgePatch;
  ifMatch?: string;
}

export interface AgentCanvasUpdateEdgeOperation {
  op: "update_edge";
  edge: {
    id: string;
    patch: Record<string, unknown>;
  };
  ifMatch?: string;
}

export interface AgentCanvasDeleteEdgeOperation {
  op: "delete_edge";
  edge: Pick<AgentCanvasEdgePatch, "id">;
  ifMatch?: string;
}

export interface AgentTimelineApplyOperation {
  op: "timeline_apply";
  timeline: {
    nodeId: string;
    dsl: Record<string, unknown>;
    ifMatch?: string;
  };
}

export type AgentCanvasPatchOperation =
  | AgentCanvasAddNodeOperation
  | AgentCanvasDeleteNodeOperation
  | AgentCanvasAddEdgeOperation
  | AgentCanvasUpdateEdgeOperation
  | AgentCanvasDeleteEdgeOperation
  | AgentTimelineApplyOperation;

export interface AgentAttribution {
  actorUserId?: string;
  actorAgentId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readWritePrecondition(value: Record<string, unknown>, nested?: Record<string, unknown>): string | undefined {
  const raw =
    value.ifMatch ??
    value.if_match ??
    value.readToken ??
    value.read_token ??
    nested?.ifMatch ??
    nested?.if_match ??
    nested?.readToken ??
    nested?.read_token;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

function parsePosition(value: unknown): { x: number; y: number } | undefined {
  if (!isRecord(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === undefined || y === undefined ? undefined : { x, y };
}

function parseAddNodeOperation(value: unknown): AgentCanvasAddNodeOperation | null {
  if (!isRecord(value) || value.op !== "add_node" || !isRecord(value.node)) return null;
  const id = typeof value.node.id === "string" ? value.node.id.trim() : "";
  const type = typeof value.node.type === "string" ? value.node.type.trim() : "";
  if (!id || !type) return null;

  const data = isRecord(value.node.data) ? value.node.data : undefined;
  const position = parsePosition(value.node.position);
  const parentId = typeof value.node.parentId === "string"
    ? value.node.parentId.trim()
    : typeof value.node.parent_id === "string"
      ? value.node.parent_id.trim()
      : undefined;
  const width = finiteNumber(value.node.width);
  const height = finiteNumber(value.node.height);
  const style = isRecord(value.node.style) ? value.node.style : undefined;

  return {
    op: "add_node",
    node: {
      id,
      type,
      ...(data ? { data } : {}),
      ...(position ? { position } : {}),
      ...(parentId ? { parentId } : {}),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(style ? { style } : {}),
    },
  };
}

function parseDeleteNodeOperation(value: unknown): AgentCanvasDeleteNodeOperation | null {
  if (!isRecord(value) || value.op !== "delete_node" || !isRecord(value.node)) return null;
  const id = typeof value.node.id === "string" ? value.node.id.trim() : "";
  if (!id) return null;
  const ifMatch = readWritePrecondition(value, value.node);
  return {
    op: "delete_node",
    node: { id },
    ...(ifMatch ? { ifMatch } : {}),
  };
}

function parseAddEdgeOperation(value: unknown): AgentCanvasAddEdgeOperation | null {
  if (!isRecord(value) || value.op !== "add_edge" || !isRecord(value.edge)) return null;
  const id = typeof value.edge.id === "string" ? value.edge.id.trim() : "";
  const source = typeof value.edge.source === "string" ? value.edge.source.trim() : "";
  const target = typeof value.edge.target === "string" ? value.edge.target.trim() : "";
  if (!id || !source || !target) return null;
  const type = typeof value.edge.type === "string" ? value.edge.type.trim() : "";
  const ifMatch = readWritePrecondition(value, value.edge);
  return {
    op: "add_edge",
    edge: {
      id,
      source,
      target,
      ...(type ? { type } : {}),
    },
    ...(ifMatch ? { ifMatch } : {}),
  };
}

function parseUpdateEdgeOperation(value: unknown): AgentCanvasUpdateEdgeOperation | null {
  if (!isRecord(value) || value.op !== "update_edge" || !isRecord(value.edge)) return null;
  const id = typeof value.edge.id === "string" ? value.edge.id.trim() : "";
  if (!id || !isRecord(value.edge.patch)) return null;
  const ifMatch = readWritePrecondition(value, value.edge);
  return {
    op: "update_edge",
    edge: {
      id,
      patch: value.edge.patch,
    },
    ...(ifMatch ? { ifMatch } : {}),
  };
}

function parseDeleteEdgeOperation(value: unknown): AgentCanvasDeleteEdgeOperation | null {
  if (!isRecord(value) || value.op !== "delete_edge" || !isRecord(value.edge)) return null;
  const id = typeof value.edge.id === "string" ? value.edge.id.trim() : "";
  if (!id) return null;
  const ifMatch = readWritePrecondition(value, value.edge);
  return {
    op: "delete_edge",
    edge: { id },
    ...(ifMatch ? { ifMatch } : {}),
  };
}

function parseTimelineApplyOperation(value: unknown): AgentTimelineApplyOperation | null {
  if (!isRecord(value) || value.op !== "timeline_apply" || !isRecord(value.timeline)) return null;
  const nodeId = typeof value.timeline.nodeId === "string"
    ? value.timeline.nodeId.trim()
    : typeof value.timeline.node_id === "string"
      ? value.timeline.node_id.trim()
      : "";
  if (!nodeId || !isRecord(value.timeline.dsl)) return null;
  const ifMatch = readWritePrecondition(value, value.timeline);
  return {
    op: "timeline_apply",
    timeline: {
      nodeId,
      dsl: value.timeline.dsl,
      ...(ifMatch ? { ifMatch } : {}),
    },
  };
}

function parsePatchOperation(value: unknown): AgentCanvasPatchOperation | null {
  return parseAddNodeOperation(value)
    ?? parseDeleteNodeOperation(value)
    ?? parseAddEdgeOperation(value)
    ?? parseUpdateEdgeOperation(value)
    ?? parseDeleteEdgeOperation(value)
    ?? parseTimelineApplyOperation(value);
}

export function parseAgentCanvasPatch(event: unknown): AgentCanvasPatchOperation[] {
  if (!isRecord(event)) return [];
  const inner = isRecord(event.update) ? event.update : event;
  if (inner.sessionUpdate !== "clash.canvas.patch") return [];
  const rawOperations = Array.isArray(inner.operations)
    ? inner.operations
    : isRecord(inner.operation)
      ? [inner.operation]
      : [];
  return rawOperations
    .map(parsePatchOperation)
    .filter((operation): operation is AgentCanvasPatchOperation => operation !== null);
}

export function applyAgentAttribution(
  data: Record<string, unknown> | undefined,
  attribution: AgentAttribution,
): Record<string, unknown> {
  const current = data ?? {};
  if (current.actorType === "agent" && typeof current.actorUserId === "string") {
    return current;
  }

  return {
    ...current,
    actorType: "agent",
    ...(attribution.actorUserId ? { actorUserId: attribution.actorUserId } : {}),
    ...(attribution.actorAgentId ? { actorAgentId: attribution.actorAgentId } : {}),
  };
}
