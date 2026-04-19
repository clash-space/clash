/**
 * Canvas — cohesive interface for all canvas operations.
 *
 * All clients (web, CLI, agent) should use this class instead of
 * importing individual functions. Takes a LoroDoc + BroadcastFn
 * and exposes clean business-level methods.
 */
import type { LoroDoc } from "loro-crdt";
import type { LayoutNode, LayoutEdge } from "@clash/shared-layout";
import { NEEDS_LAYOUT_POSITION, autoInsertNode } from "@clash/shared-layout";
import {
  AGENT_NODE_TYPE_MAP,
  NodeType,
  ProposalType,
  TaskStatus,
  ACTION_TYPE,
  RF_NODE_TYPE,
  validateGenerationInput,
  buildPendingAssetNode,
} from "./canvas";
import { MODEL_CARDS, type ModelCard } from "./models";

// ─── Types ───────────────────────────────────────────────

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

export interface CreateLinkedNodeResult {
  nodeId: string;
  position: { x: number; y: number };
  pushedNodeIds: string[];
}

export interface ExecuteGenerationResult {
  assetNodeId: string;
  assetNodeType: string;
  position: { x: number; y: number };
  error: string | null;
}

export interface TaskStatusResult {
  status: string;
  output?: Record<string, unknown>;
  error?: string;
}

// ─── Internal Helpers ────────────────────────────────────

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
    width: node.width ?? undefined,
    height: node.height ?? undefined,
    style: node.style ?? undefined,
  };
}

// ─── Canvas Class ────────────────────────────────────────

export class Canvas {
  constructor(
    private readonly doc: LoroDoc,
    private readonly broadcast: BroadcastFn,
  ) {}

  // ── Read ─────────────────────────────────────────────

  listNodes(nodeType?: string | null, parentId?: string | null): NodeInfo[] {
    const nodesMap = this.doc.getMap("nodes");
    let nodes: NodeInfo[] = [];
    for (const [id, raw] of nodesMap.entries()) {
      nodes.push(parseLoroNode(id, raw as Record<string, any>));
    }
    if (nodeType) nodes = nodes.filter((n) => n.type === nodeType);
    if (parentId) nodes = nodes.filter((n) => n.parent_id === parentId);
    return nodes;
  }

  readNode(nodeId: string): NodeInfo | null {
    const nodesMap = this.doc.getMap("nodes");
    const raw = nodesMap.get(nodeId) as Record<string, any> | undefined;
    if (!raw) return null;
    return parseLoroNode(nodeId, raw);
  }

  searchNodes(query: string, nodeTypes?: string[] | null): NodeInfo[] {
    const queryLower = query.toLowerCase();
    return this.listNodes().filter((node) => {
      if (nodeTypes?.length && !nodeTypes.includes(node.type)) return false;
      const label = ((node.data.label as string) ?? "").toLowerCase();
      const content = String(node.data.content ?? "").toLowerCase();
      return label.includes(queryLower) || content.includes(queryLower);
    });
  }

  findNode(idOrAssetId: string): NodeInfo | null {
    const byId = this.readNode(idOrAssetId);
    if (byId) return byId;
    return this.listNodes().find((n) => (n.data.assetId as string) === idOrAssetId) ?? null;
  }

  getNodeStatus(nodeIdOrAssetId: string): TaskStatusResult {
    const node = this.findNode(nodeIdOrAssetId);
    if (!node) return { status: TaskStatus.NodeNotFound, error: "Node not found" };
    const status = (node.data.status as string) ?? TaskStatus.Completed;
    const error = node.data.error as string | undefined;
    return error ? { status, error } : { status };
  }

  listEdges(): LayoutEdge[] {
    const edgesMap = this.doc.getMap("edges");
    const edges: LayoutEdge[] = [];
    for (const [, raw] of edgesMap.entries()) {
      const r = raw as Record<string, any>;
      if (r.source && r.target) edges.push({ source: r.source, target: r.target });
    }
    return edges;
  }

  // ── Write ────────────────────────────────────────────

  insertNode(
    nodeId: string,
    nodeType: string,
    data: Record<string, unknown>,
    parentId: string | null,
    position: { x: number; y: number },
  ): void {
    const versionBefore = this.doc.version();
    const nodesMap = this.doc.getMap("nodes");
    nodesMap.set(nodeId, {
      type: nodeType,
      data,
      parentId: parentId ?? undefined,
      position,
    });
    const update = this.doc.export({ mode: "update", from: versionBefore });
    this.broadcast(update);
  }

  insertEdge(
    edgeId: string,
    source: string,
    target: string,
    edgeType: string | null = "default",
  ): void {
    const versionBefore = this.doc.version();
    const edgesMap = this.doc.getMap("edges");
    edgesMap.set(edgeId, { source, target, type: edgeType ?? undefined });
    const update = this.doc.export({ mode: "update", from: versionBefore });
    this.broadcast(update);
  }

  updateNode(nodeId: string, updates: Record<string, unknown>): boolean {
    const nodesMap = this.doc.getMap("nodes");
    const raw = nodesMap.get(nodeId) as Record<string, any> | undefined;
    if (!raw) return false;
    const versionBefore = this.doc.version();
    nodesMap.set(nodeId, { ...raw, data: { ...(raw.data ?? {}), ...updates } });
    const update = this.doc.export({ mode: "update", from: versionBefore });
    this.broadcast(update);
    return true;
  }

  deleteNode(nodeId: string): boolean {
    const nodesMap = this.doc.getMap("nodes");
    if (!nodesMap.get(nodeId)) return false;
    const versionBefore = this.doc.version();
    nodesMap.delete(nodeId);
    const update = this.doc.export({ mode: "update", from: versionBefore });
    this.broadcast(update);
    return true;
  }

  // ── Create with auto-layout ──────────────────────────

  createNode(
    nodeId: string,
    nodeType: string,
    data: Record<string, unknown>,
    position?: { x: number; y: number } | null,
    parentId?: string | null,
    assetId?: string | null,
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
      const existingNodes = this.listNodes().map(toLayoutNode);
      const virtualNode: LayoutNode = {
        id: nodeId,
        type: rfType,
        position: NEEDS_LAYOUT_POSITION,
        parentId: parentId ?? undefined,
        data: nodeData,
      };
      const result = autoInsertNode(nodeId, [...existingNodes, virtualNode], this.listEdges());
      finalPos = result.position;

      this.insertNode(nodeId, rfType, nodeData, parentId ?? null, finalPos);

      if (result.pushedNodes.size > 0) {
        this.batchUpdatePositions(result.pushedNodes);
      }
    } else {
      this.insertNode(nodeId, rfType, nodeData, parentId ?? null, finalPos);
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

  createLinkedNode(opts: {
    nodeId: string;
    nodeType: string;
    data: Record<string, unknown>;
    parentId: string | null;
    sourceNodeId: string;
    edgeId?: string;
    edgeType?: string;
  }): CreateLinkedNodeResult {
    const { nodeId, nodeType, data, parentId, sourceNodeId } = opts;
    const edgeId = opts.edgeId ?? `${sourceNodeId}-${nodeId}`;
    const edgeType = opts.edgeType ?? "default";

    // Insert edge first so autoInsertNode can find the reference
    this.insertEdge(edgeId, sourceNodeId, nodeId, edgeType);

    // Calculate position
    const existingNodes = this.listNodes().map(toLayoutNode);
    const virtualNode: LayoutNode = {
      id: nodeId,
      type: nodeType,
      position: NEEDS_LAYOUT_POSITION,
      parentId: parentId ?? undefined,
      data,
    };
    const result = autoInsertNode(nodeId, [...existingNodes, virtualNode], this.listEdges());

    // Insert node + push siblings
    this.insertNode(nodeId, nodeType, data, parentId, result.position);
    if (result.pushedNodes.size > 0) {
      this.batchUpdatePositions(result.pushedNodes);
    }

    return {
      nodeId,
      position: result.position,
      pushedNodeIds: Array.from(result.pushedNodes.keys()),
    };
  }

  /**
   * Execute a generation node: validate, build pending asset, insert with edge.
   *
   * This is the single entry point for triggering generation from any client.
   * Replaces the duplicated logic in agent runGenerationNode, CLI execute, etc.
   */
  executeGeneration(
    nodeId: string,
    generateId: () => string,
  ): ExecuteGenerationResult {
    const node = this.readNode(nodeId);
    if (!node) {
      return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: `Node ${nodeId} not found` };
    }

    const nodeData = node.data || {};
    const nodeType = node.type;
    const actionType = (nodeData.actionType as string) || "";

    // Validate node is a generation type
    const isActionBadge = nodeType === RF_NODE_TYPE.ActionBadge;
    const isGenAction = actionType === ACTION_TYPE.ImageGen || actionType === ACTION_TYPE.VideoGen;
    if (!isActionBadge || !isGenAction) {
      return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: `Node ${nodeId} is not a generation node` };
    }

    // Extract prompt
    const prompt = (nodeData.content as string) || (nodeData.prompt as string) || "";
    if (!prompt.trim()) {
      return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: "No prompt provided" };
    }

    // Resolve model
    const modelId = (nodeData.modelId as string) || (nodeData.model as string) || "";
    const modelCard = MODEL_CARDS.find((c: ModelCard) => c.id === modelId);
    const modelParams = (nodeData.modelParams as Record<string, string | number | boolean>) || {};

    // Validate against model card
    if (modelCard) {
      const validationError = validateGenerationInput({
        prompt,
        referenceImageUrls: (nodeData.referenceImageUrls as string[]) || [],
        modelCard,
      });
      if (validationError) {
        return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: validationError };
      }
    }

    // Build pending asset node
    const assetNodeId = generateId();
    const pendingNode = buildPendingAssetNode({
      nodeId: assetNodeId,
      prompt,
      modelId,
      modelParams,
      actionType: actionType as typeof ACTION_TYPE.ImageGen | typeof ACTION_TYPE.VideoGen,
      label: nodeData.label as string | undefined,
      referenceImageUrls: nodeData.referenceImageUrls as string[] | undefined,
      referenceMode: (nodeData.referenceMode as string) || undefined,
    });

    // Create linked node with edge + auto-layout
    const linked = this.createLinkedNode({
      nodeId: pendingNode.id,
      nodeType: pendingNode.type,
      data: pendingNode.data,
      parentId: node.parent_id,
      sourceNodeId: nodeId,
    });

    return {
      assetNodeId: pendingNode.id,
      assetNodeType: pendingNode.type,
      position: linked.position,
      error: null,
    };
  }

  // ── Private ──────────────────────────────────────────

  private batchUpdatePositions(updates: Map<string, { x: number; y: number }>): void {
    if (updates.size === 0) return;
    const versionBefore = this.doc.version();
    const nodesMap = this.doc.getMap("nodes");
    for (const [nodeId, pos] of updates) {
      const raw = nodesMap.get(nodeId) as Record<string, any> | undefined;
      if (raw) nodesMap.set(nodeId, { ...raw, position: pos });
    }
    const update = this.doc.export({ mode: "update", from: versionBefore });
    this.broadcast(update);
  }
}
