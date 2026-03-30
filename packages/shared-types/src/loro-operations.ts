/**
 * Canvas operations using Loro CRDT document.
 *
 * All reads/writes go through doc.getMap('nodes') and doc.getMap('edges').
 * Type definitions live in ./canvas.ts — this file is runtime-only.
 */
import type { LoroDoc } from "loro-crdt";
import type { LayoutNode, LayoutEdge } from "@clash/shared-layout";
import { NEEDS_LAYOUT_POSITION, autoInsertNode } from "@clash/shared-layout";
import { AGENT_NODE_TYPE_MAP, NodeType, ProposalType, TaskStatus } from "./canvas";

// ─── Runtime Types ────────────────────────────────────────

export type BroadcastFn = (data: Uint8Array) => void;

export interface NodeInfo {
  id: string;
  type: string;
  data: Record<string, unknown>;
  parent_id: string | null;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  style?: Record<string, unknown> | null;
}

export interface CreateNodeResult {
  node_id: string | null;
  error: string | null;
  proposal: Record<string, unknown> | null;
  asset_id: string | null;
}

export interface TaskStatusResult {
  status: string;
  output?: Record<string, unknown>;
  error?: string;
}

// ─── Internal Helpers ─────────────────────────────────────

function parseLoroNode(nodeId: string, raw: Record<string, any>): NodeInfo {
  const data = raw.data ?? {};
  return {
    id: nodeId,
    type: raw.type ?? "text",
    data: typeof data === "object" ? { ...data } : {},
    parent_id: raw.parentId ?? raw.parent_id ?? null,
    position: raw.position ?? { x: 0, y: 0 },
    width: typeof raw.width === "number" ? raw.width : null,
    height: typeof raw.height === "number" ? raw.height : null,
    style: raw.style ?? null,
  };
}

function toLayoutNode(node: NodeInfo): LayoutNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    parentId: node.parent_id ?? undefined,
    data: node.data,
    width: node.width,
    height: node.height,
    style: node.style ?? undefined,
  };
}

function batchUpdatePositions(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  updates: Map<string, { x: number; y: number }>
): void {
  if (updates.size === 0) return;
  const versionBefore = doc.version();
  const nodesMap = doc.getMap("nodes");
  for (const [nodeId, pos] of updates) {
    const raw = nodesMap.get(nodeId) as Record<string, any> | undefined;
    if (raw) nodesMap.set(nodeId, { ...raw, position: pos });
  }
  const update = doc.export({ mode: "update", from: versionBefore });
  broadcast(update);
}

// ─── Public API ───────────────────────────────────────────

export function listNodes(
  doc: LoroDoc,
  nodeType?: string | null,
  parentId?: string | null
): NodeInfo[] {
  const nodesMap = doc.getMap("nodes");
  let nodes: NodeInfo[] = [];
  for (const [id, raw] of nodesMap.entries()) {
    nodes.push(parseLoroNode(id, raw as Record<string, any>));
  }
  if (nodeType) nodes = nodes.filter((n) => n.type === nodeType);
  if (parentId) nodes = nodes.filter((n) => n.parent_id === parentId);
  return nodes;
}

export function readNode(doc: LoroDoc, nodeId: string): NodeInfo | null {
  const nodesMap = doc.getMap("nodes");
  const raw = nodesMap.get(nodeId) as Record<string, any> | undefined;
  if (!raw) return null;
  return parseLoroNode(nodeId, raw);
}

export function insertNode(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  nodeId: string,
  nodeType: string,
  data: Record<string, unknown>,
  parentId: string | null,
  position: { x: number; y: number }
): void {
  const versionBefore = doc.version();
  const nodesMap = doc.getMap("nodes");
  nodesMap.set(nodeId, {
    type: nodeType,
    data,
    parentId: parentId ?? undefined,
    position,
  });
  const update = doc.export({ mode: "update", from: versionBefore });
  broadcast(update);
}

export function insertEdge(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  edgeId: string,
  source: string,
  target: string,
  edgeType: string | null
): void {
  const versionBefore = doc.version();
  const edgesMap = doc.getMap("edges");
  edgesMap.set(edgeId, { source, target, type: edgeType ?? undefined });
  const update = doc.export({ mode: "update", from: versionBefore });
  broadcast(update);
}

export function listEdges(doc: LoroDoc): LayoutEdge[] {
  const edgesMap = doc.getMap("edges");
  const edges: LayoutEdge[] = [];
  for (const [, raw] of edgesMap.entries()) {
    const r = raw as Record<string, any>;
    if (r.source && r.target) edges.push({ source: r.source, target: r.target });
  }
  return edges;
}

export function createNode(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  nodeId: string,
  nodeType: string,
  data: Record<string, unknown>,
  position?: { x: number; y: number } | null,
  parentId?: string | null,
  assetId?: string | null
): CreateNodeResult {
  const mapping = AGENT_NODE_TYPE_MAP[nodeType as keyof typeof AGENT_NODE_TYPE_MAP];
  const rfType = mapping?.rfType ?? nodeType;
  let proposalType: string = ProposalType.Simple;
  let resolvedAssetId = assetId ?? null;

  if (nodeType === NodeType.ImageGen || nodeType === NodeType.VideoGen) {
    proposalType = ProposalType.Generative;
    resolvedAssetId = resolvedAssetId ?? crypto.randomUUID().slice(0, 8);
  } else if (nodeType === NodeType.Group) {
    proposalType = ProposalType.Group;
  }

  const nodeData: Record<string, unknown> = { ...data };
  if (resolvedAssetId) nodeData.assetId = resolvedAssetId;
  if (mapping && "actionType" in mapping) nodeData.actionType = mapping.actionType;

  let finalPos = position ?? null;

  if (!finalPos) {
    const existingNodes = listNodes(doc).map(toLayoutNode);
    const virtualNode: LayoutNode = {
      id: nodeId,
      type: rfType,
      position: NEEDS_LAYOUT_POSITION,
      parentId: parentId ?? undefined,
      data: nodeData,
    };
    const allNodes = [...existingNodes, virtualNode];
    const allEdges = listEdges(doc);
    const result = autoInsertNode(nodeId, allNodes, allEdges);
    finalPos = result.position;

    insertNode(doc, broadcast, nodeId, rfType, nodeData, parentId ?? null, finalPos);

    if (result.pushedNodes.size > 0) {
      batchUpdatePositions(doc, broadcast, result.pushedNodes);
    }
  } else {
    insertNode(doc, broadcast, nodeId, rfType, nodeData, parentId ?? null, finalPos);
  }

  const upstreamNodeIds = (data.upstreamNodeIds ?? data.upstreamIds) as string[] | undefined;
  const proposalNodeData: Record<string, unknown> = { id: nodeId, ...data };
  const proposal: Record<string, unknown> = {
    id: `proposal-${crypto.randomUUID().slice(0, 8)}`,
    type: proposalType,
    nodeType: rfType,
    nodeData: proposalNodeData,
    groupId: parentId ?? null,
    message: `Proposed ${nodeType} node: ${(data.label as string) || "Untitled"}`,
  };

  if (resolvedAssetId) {
    proposal.assetId = resolvedAssetId;
    proposalNodeData.assetId = resolvedAssetId;
  }

  if (upstreamNodeIds && Array.isArray(upstreamNodeIds)) {
    const deduped = [...new Set(upstreamNodeIds.filter(Boolean))];
    if (deduped.length) proposal.upstreamNodeIds = deduped;
  }

  return { node_id: nodeId, error: null, proposal, asset_id: resolvedAssetId };
}

export function searchNodes(
  doc: LoroDoc,
  query: string,
  nodeTypes?: string[] | null
): NodeInfo[] {
  const queryLower = query.toLowerCase();
  return listNodes(doc).filter((node) => {
    if (nodeTypes?.length && !nodeTypes.includes(node.type)) return false;
    const label = ((node.data.label as string) ?? "").toLowerCase();
    const content = String(node.data.content ?? "").toLowerCase();
    return label.includes(queryLower) || content.includes(queryLower);
  });
}

export function findNodeByIdOrAssetId(doc: LoroDoc, idOrAssetId: string): NodeInfo | null {
  const byId = readNode(doc, idOrAssetId);
  if (byId) return byId;
  return listNodes(doc).find((n) => (n.data.assetId as string) === idOrAssetId) ?? null;
}

export function getNodeStatus(doc: LoroDoc, nodeIdOrAssetId: string): TaskStatusResult {
  const node = findNodeByIdOrAssetId(doc, nodeIdOrAssetId);
  if (!node) return { status: TaskStatus.NodeNotFound, error: "Node not found" };
  const status = (node.data.status as string) ?? TaskStatus.Completed;
  return { status };
}

export function deleteNode(doc: LoroDoc, broadcast: BroadcastFn, nodeId: string): boolean {
  const nodesMap = doc.getMap("nodes");
  if (!nodesMap.get(nodeId)) return false;
  const versionBefore = doc.version();
  nodesMap.delete(nodeId);
  const update = doc.export({ mode: "update", from: versionBefore });
  broadcast(update);
  return true;
}

export function updateNode(
  doc: LoroDoc,
  broadcast: BroadcastFn,
  nodeId: string,
  updates: Record<string, unknown>
): boolean {
  const nodesMap = doc.getMap("nodes");
  const raw = nodesMap.get(nodeId) as Record<string, any> | undefined;
  if (!raw) return false;
  const versionBefore = doc.version();
  nodesMap.set(nodeId, { ...raw, data: { ...(raw.data ?? {}), ...updates } });
  const update = doc.export({ mode: "update", from: versionBefore });
  broadcast(update);
  return true;
}
