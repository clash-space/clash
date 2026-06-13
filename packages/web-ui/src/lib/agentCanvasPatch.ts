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

export type AgentCanvasPatchOperation = AgentCanvasAddNodeOperation;

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
    .map(parseAddNodeOperation)
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
