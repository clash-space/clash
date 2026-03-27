/**
 * Canvas backend using Loro CRDT document.
 *
 * Replaces the previous SQL-based backend. All reads/writes go through
 * doc.getMap('nodes') and doc.getMap('edges').
 */
import type { LoroDoc } from "loro-crdt";
import type { NodeInfo, CreateNodeResult, TaskStatusResult } from "../../domain/canvas";
import {
  NodeType,
  FrontendNodeType,
  ProposalType,
  Status,
  isGenerationNodeType,
} from "../../domain/canvas";
import type { LayoutNode, LayoutEdge } from "@clash/shared-layout";
import {
  NEEDS_LAYOUT_POSITION,
  autoInsertNode,
} from "@clash/shared-layout";

/**
 * Broadcast function type — sends Loro binary updates to connected clients.
 */
export type BroadcastFn = (data: Uint8Array) => void;

function parseLoroNode(nodeId: string, raw: Record<string, any>): NodeInfo {
  const data = raw.data ?? {};
  return {
    id: nodeId,
    type: raw.type ?? "text",
    data: typeof data === "object" ? { ...data } : {},
    parent_id: raw.parentId ?? raw.parent_id ?? null,
    position: raw.position ?? { x: 0, y: 0 },
  };
}

export function listNodes(
  doc: LoroDoc,
  nodeType?: string | null,
  parentId?: string | null
): NodeInfo[] {
  const nodesMap = doc.getMap("nodes");
  const allEntries = nodesMap.entries();
  let nodes: NodeInfo[] = [];

  for (const [id, raw] of allEntries) {
    const node = parseLoroNode(id, raw as Record<string, any>);
    nodes.push(node);
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

  edgesMap.set(edgeId, {
    source,
    target,
    type: edgeType ?? undefined,
  });

  const update = doc.export({ mode: "update", from: versionBefore });
  broadcast(update);
}

/**
 * Read all edges from the Loro document.
 */
export function listEdges(doc: LoroDoc): LayoutEdge[] {
  const edgesMap = doc.getMap("edges");
  const edges: LayoutEdge[] = [];
  for (const [, raw] of edgesMap.entries()) {
    const r = raw as Record<string, any>;
    if (r.source && r.target) {
      edges.push({ source: r.source, target: r.target });
    }
  }
  return edges;
}

/**
 * Convert a NodeInfo (snake_case) to LayoutNode (camelCase) for shared layout.
 */
function toLayoutNode(node: NodeInfo): LayoutNode {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    parentId: node.parent_id ?? undefined,
    data: node.data,
  };
}

/**
 * Batch-update node positions in the Loro document in a single transaction.
 * Emits one consolidated broadcast.
 */
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
    if (raw) {
      nodesMap.set(nodeId, { ...raw, position: pos });
    }
  }

  const update = doc.export({ mode: "update", from: versionBefore });
  broadcast(update);
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
  let frontendType = nodeType;
  let proposalType: ProposalType = ProposalType.Simple;
  let resolvedAssetId = assetId ?? null;

  if (nodeType === NodeType.ImageGen) {
    frontendType = FrontendNodeType.ImageGen;
    proposalType = ProposalType.Generative;
    resolvedAssetId = resolvedAssetId ?? crypto.randomUUID().slice(0, 8);
  } else if (nodeType === NodeType.VideoGen) {
    frontendType = FrontendNodeType.VideoGen;
    proposalType = ProposalType.Generative;
    resolvedAssetId = resolvedAssetId ?? crypto.randomUUID().slice(0, 8);
  } else if (nodeType === NodeType.Group) {
    proposalType = ProposalType.Group;
  }

  const nodeData: Record<string, unknown> = { ...data };
  if (resolvedAssetId) {
    nodeData.assetId = resolvedAssetId;
  }

  // Use NEEDS_LAYOUT_POSITION as placeholder when no explicit position given,
  // then immediately compute the real position via autoInsertNode.
  const pos = position ?? NEEDS_LAYOUT_POSITION;
  insertNode(doc, broadcast, nodeId, nodeType, nodeData, parentId ?? null, pos);

  // Auto-layout: compute a real position if none was explicitly provided
  if (!position) {
    const allNodes = listNodes(doc).map(toLayoutNode);
    const allEdges = listEdges(doc);
    const result = autoInsertNode(nodeId, allNodes, allEdges);

    // Collect all position updates (the new node + any pushed nodes)
    const posUpdates = new Map<string, { x: number; y: number }>();
    posUpdates.set(nodeId, result.position);
    for (const [id, pt] of result.pushedNodes) {
      posUpdates.set(id, pt);
    }
    batchUpdatePositions(doc, broadcast, posUpdates);
  }

  const upstreamNodeIds = (data.upstreamNodeIds ?? data.upstreamIds) as string[] | undefined;

  const proposalNodeData: Record<string, unknown> = { id: nodeId, ...data };
  const proposal: Record<string, unknown> = {
    id: `proposal-${crypto.randomUUID().slice(0, 8)}`,
    type: proposalType,
    nodeType: frontendType,
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

  return {
    node_id: nodeId,
    error: null,
    proposal,
    asset_id: resolvedAssetId,
  };
}

export function searchNodes(
  doc: LoroDoc,
  query: string,
  nodeTypes?: string[] | null
): NodeInfo[] {
  const queryLower = query.toLowerCase();
  const allNodes = listNodes(doc);

  return allNodes.filter((node) => {
    if (nodeTypes?.length && !nodeTypes.includes(node.type)) return false;
    const label = ((node.data.label as string) ?? "").toLowerCase();
    const content = String(node.data.content ?? "").toLowerCase();
    return label.includes(queryLower) || content.includes(queryLower);
  });
}

export function findNodeByIdOrAssetId(doc: LoroDoc, idOrAssetId: string): NodeInfo | null {
  const byId = readNode(doc, idOrAssetId);
  if (byId) return byId;

  const allNodes = listNodes(doc);
  return allNodes.find((n) => (n.data.assetId as string) === idOrAssetId) ?? null;
}

export function getNodeStatus(doc: LoroDoc, nodeIdOrAssetId: string): TaskStatusResult {
  const node = findNodeByIdOrAssetId(doc, nodeIdOrAssetId);
  if (!node) return { status: Status.NodeNotFound, error: "Node not found" };

  const defaultStatus = isGenerationNodeType(node.type)
    ? Status.Generating
    : Status.Completed;
  const status = (node.data.status as string as Status) ?? defaultStatus;
  return { status };
}
