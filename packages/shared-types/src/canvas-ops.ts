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
  buildPendingAssetNode,
  buildGenerationPayload,
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

/**
 * Unified result for `Canvas.execute`. `kind` discriminates which
 * pipeline fired so callers can phrase their UI/log message
 * appropriately (e.g. "generating asset" vs "rendering video"). On
 * failure `error` is non-null and the other fields are empty.
 *
 * `generation` — action-badge node spawned a pending asset child.
 * `render`     — video-editor node spawned a pending render-video child.
 */
export interface ExecuteResult {
  kind: "generation" | "render" | null;
  childNodeId: string;
  childNodeType: string;
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

  /** Lookup a marketplace custom-action definition from the Loro doc's
   *  `customActions` map. Returns `null` if no action with that id has
   *  been installed in this project. Same map NodeProcessor reads
   *  later when it dispatches the pending task — keeping the readers
   *  aligned avoids drift. */
  getCustomAction(actionId: string): import("./canvas").CustomActionDefinition | null {
    try {
      const map = this.doc.getMap("customActions");
      const raw = map.get(actionId);
      if (!raw || typeof raw !== "object") return null;
      return raw as import("./canvas").CustomActionDefinition;
    } catch {
      return null;
    }
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

    if (
      nodeType === NodeType.ImageGen ||
      nodeType === NodeType.VideoGen ||
      nodeType === NodeType.AudioGen ||
      nodeType === NodeType.TextGen
    ) {
      proposalType = ProposalType.Generative;
      resolvedAssetId = resolvedAssetId ?? crypto.randomUUID().slice(0, 8);
    } else if (nodeType === NodeType.Group) {
      proposalType = ProposalType.Group;
    }

    const nodeData: Record<string, unknown> = { ...data };
    if (resolvedAssetId) nodeData.assetId = resolvedAssetId;
    // Honor a caller-provided `custom:*` actionType — that's a custom
    // marketplace action and the type-map's built-in actionType would
    // overwrite our routing hint. Built-in types still get the
    // canonical actionType from the map so renames don't leak into
    // CLI / agent callers.
    const callerActionType = typeof nodeData.actionType === "string" ? nodeData.actionType : undefined;
    if (mapping && "actionType" in mapping) {
      if (!callerActionType?.startsWith("custom:")) {
        nodeData.actionType = mapping.actionType;
      }
    }

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
   * Execute a node — the single "do this node's thing" entry point.
   * Branches on node type so callers (CLI, daemon, agent tools) don't
   * re-implement the same readNode + dispatch logic.
   *
   *   action-badge  → spawn a pending asset child (image/video/audio
   *                   gen). Same flow as the legacy executeGeneration.
   *   video-editor  → spawn a pending render-video child carrying the
   *                   editor's timelineDsl. Server's NodeProcessor
   *                   sweeps `type:'video' + status:'pending' +
   *                   timelineDsl` and dispatches the render task.
   *
   * Returns the discriminated `ExecuteResult` so the caller can
   * phrase its log line ("created pending asset" vs "created pending
   * render-video") without re-reading the node.
   */
  execute(nodeId: string, generateId: () => string): ExecuteResult {
    const node = this.readNode(nodeId);
    if (!node) {
      return { kind: null, childNodeId: "", childNodeType: "", position: { x: 0, y: 0 }, error: `Node ${nodeId} not found` };
    }
    if (node.type === "video-editor") {
      const r = this.executeRender(nodeId, generateId);
      if (r.error) {
        return { kind: null, childNodeId: "", childNodeType: "", position: { x: 0, y: 0 }, error: r.error };
      }
      return { kind: "render", childNodeId: r.renderNodeId, childNodeType: "video", position: r.position, error: null };
    }
    const r = this.executeGeneration(nodeId, generateId);
    if (r.error) {
      return { kind: null, childNodeId: "", childNodeType: "", position: { x: 0, y: 0 }, error: r.error };
    }
    return { kind: "generation", childNodeId: r.assetNodeId, childNodeType: r.assetNodeType, position: r.position, error: null };
  }

  /**
   * Execute a generation node: validate, build pending asset, insert with edge.
   *
   * Public for back-compat (api-cf agent tool + tests call this directly);
   * new code should prefer `execute()` which dispatches by node type.
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

    // Validate node is a generation type. Both built-in actionTypes
    // (image-gen / video-gen / audio-gen / text-gen) and custom-action
    // actionTypes (`custom:<id>`) are accepted — they unify through
    // buildGenerationPayload below.
    const isActionBadge = nodeType === RF_NODE_TYPE.ActionBadge;
    const isBuiltInGen =
      actionType === ACTION_TYPE.ImageGen ||
      actionType === ACTION_TYPE.VideoGen ||
      actionType === ACTION_TYPE.AudioGen ||
      actionType === ACTION_TYPE.TextGen;
    const isCustomGen = typeof actionType === "string" && actionType.startsWith("custom:");
    if (!isActionBadge || (!isBuiltInGen && !isCustomGen)) {
      return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: `Node ${nodeId} is not a generation node` };
    }

    // Extract prompt
    const prompt = (nodeData.content as string) || (nodeData.prompt as string) || "";
    if (!prompt.trim()) {
      return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: "No prompt provided" };
    }

    // Resolve the generation config — built-in model or custom action.
    // Both surface as `GenerationConfig` so the same payload builder
    // handles them (partitionRefs / validateRefs work off the unified
    // Capability shape under the hood).
    let config: import("./canvas").GenerationConfig;
    if (isCustomGen) {
      const customActionId = (nodeData.customActionId as string) || actionType.replace("custom:", "");
      const customDef = this.getCustomAction(customActionId);
      if (!customDef) {
        return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: `Custom action not installed: ${customActionId}` };
      }
      const customActionParams = (nodeData.customActionParams as Record<string, string | number | boolean>) || {};
      config = { kind: "custom", customDef, customActionParams };
    } else {
      const modelId = (nodeData.modelId as string) || (nodeData.model as string) || "";
      const modelCard = MODEL_CARDS.find((c: ModelCard) => c.id === modelId);
      const modelParams = (nodeData.modelParams as Record<string, string | number | boolean>) || {};
      config = { kind: "model", modelCard, modelParams };
    }

    // Resolve incoming refs from canvas edges. ActionBadge in the web
    // UI uses the same shape (`refNodeIds = edges.filter(target === id).map(source)`)
    // and additionally orders them by `data.referenceImageOrder` so
    // the user's drag-reorder choice survives into "this ref is the
    // start frame, this one is the end frame" semantics. Mirror that
    // ordering here so server-side execute produces an identical
    // sequence; otherwise models like Kling i2v that interpret refs
    // positionally would pick different frames depending on whether
    // the user hit Run via the UI or via the CLI.
    const attachedSourceIds = this.listEdges()
      .filter((e) => e.target === nodeId)
      .map((e) => e.source);
    const orderHint = Array.isArray(nodeData.referenceImageOrder)
      ? (nodeData.referenceImageOrder as string[])
      : [];
    const attachedSet = new Set(attachedSourceIds);
    const ordered = orderHint.filter((nid) => attachedSet.has(nid));
    const seenOrdered = new Set(ordered);
    const extras = attachedSourceIds.filter((nid) => !seenOrdered.has(nid));
    const sortedSourceIds = [...ordered, ...extras];
    const refNodes = sortedSourceIds
      .map((sid) => this.readNode(sid))
      .filter((n): n is NonNullable<typeof n> => !!n);

    // Backward-compat: action-badges created before the edge-based
    // ref model (or by agents that wrote the asset-id array
    // directly) carry their refs as bare `referenceImageAssetIds` on
    // the action-badge data. Synthesize stand-in ref nodes so the
    // unified payload builder can partition them too.
    if (refNodes.length === 0 && Array.isArray(nodeData.referenceImageAssetIds)) {
      for (const aid of nodeData.referenceImageAssetIds as string[]) {
        refNodes.push({
          id: aid,
          type: RF_NODE_TYPE.Image,
          parent_id: null,
          position: { x: 0, y: 0 },
          data: { assetId: aid },
        } as any);
      }
    }

    const configId =
      config.kind === "model"
        ? ((nodeData.modelId as string) || (nodeData.model as string) || "")
        : config.customDef.id;
    const { pendingInput, validationError } = buildGenerationPayload({
      prompt,
      refNodes,
      configId,
      config,
      actionType: actionType as
        | typeof ACTION_TYPE.ImageGen
        | typeof ACTION_TYPE.VideoGen
        | typeof ACTION_TYPE.AudioGen
        | typeof ACTION_TYPE.TextGen
        | `custom:${string}`,
      label: nodeData.label as string | undefined,
      referenceMode: nodeData.referenceMode as string | undefined,
    });

    if (validationError) {
      return { assetNodeId: "", assetNodeType: "", position: { x: 0, y: 0 }, error: validationError };
    }

    // Build pending asset node
    const assetNodeId = generateId();
    const pendingNode = buildPendingAssetNode({ ...pendingInput, nodeId: assetNodeId });

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

  /**
   * Execute a video-editor node: spawn a pending render-video child
   * carrying the editor's `timelineDsl`. Mirrors the web UI's "Render"
   * button (see `pendingRenderVideo.buildPendingRenderVideoNodePayload`
   * + `VideoEditorNode.handleRender`) so an agent driving the canvas
   * via CLI can trigger the same pipeline without a browser.
   *
   * Server-side `NodeProcessor.poll` then sees a `video` node with
   * `data.status === "pending"` AND `data.timelineDsl != null` and
   * dispatches the render task to the render-server.
   */
  executeRender(
    editorNodeId: string,
    generateId: () => string,
  ): { renderNodeId: string; position: { x: number; y: number }; error: string | null } {
    const node = this.readNode(editorNodeId);
    if (!node) {
      return { renderNodeId: "", position: { x: 0, y: 0 }, error: `Node ${editorNodeId} not found` };
    }
    // Loose match on type — UI uses "video-editor"; we accept any node
    // that carries a `timelineDsl` blob, since that's the actual
    // contract the render dispatcher reads.
    const timelineDsl = (node.data ?? {}).timelineDsl as
      | { tracks?: Array<{ items?: Array<{ from?: number; durationInFrames?: number }> }>; compositionWidth?: number; compositionHeight?: number; fps?: number; durationInFrames?: number }
      | undefined;
    if (!timelineDsl || typeof timelineDsl !== "object") {
      return { renderNodeId: "", position: { x: 0, y: 0 }, error: `Node ${editorNodeId} has no timelineDsl — pull / edit / push one first.` };
    }
    const tracks = Array.isArray(timelineDsl.tracks) ? timelineDsl.tracks : [];
    const totalItems = tracks.reduce((n, t) => n + (Array.isArray(t.items) ? t.items.length : 0), 0);
    if (totalItems === 0) {
      return { renderNodeId: "", position: { x: 0, y: 0 }, error: `Node ${editorNodeId} timelineDsl has no items — nothing to render.` };
    }

    // Compute the actual playable length (max item end). Falls back to
    // the timeline's declared durationInFrames so the render always
    // covers every item even if the agent forgot to update the top-level
    // value after appending a clip.
    let maxEnd = 0;
    for (const track of tracks) {
      for (const item of track.items ?? []) {
        const from = typeof item.from === "number" ? item.from : 0;
        const dur = typeof item.durationInFrames === "number" ? item.durationInFrames : 0;
        if (from + dur > maxEnd) maxEnd = from + dur;
      }
    }
    const declaredDuration = typeof timelineDsl.durationInFrames === "number" ? timelineDsl.durationInFrames : 0;
    const renderDurationInFrames = Math.max(maxEnd, declaredDuration, 1);

    const naturalWidth = typeof timelineDsl.compositionWidth === "number" && timelineDsl.compositionWidth > 0 ? timelineDsl.compositionWidth : 1920;
    const naturalHeight = typeof timelineDsl.compositionHeight === "number" && timelineDsl.compositionHeight > 0 ? timelineDsl.compositionHeight : 1080;

    const renderNodeId = generateId();
    const data: Record<string, unknown> = {
      label: "Rendered Video",
      status: TaskStatus.Pending,
      timelineDsl: { ...timelineDsl, durationInFrames: renderDurationInFrames },
      pendingTask: null,
      naturalWidth,
      naturalHeight,
      aspectRatio: `${naturalWidth}:${naturalHeight}`,
    };

    const linked = this.createLinkedNode({
      nodeId: renderNodeId,
      nodeType: RF_NODE_TYPE.Video ?? "video",
      data,
      parentId: node.parent_id,
      sourceNodeId: editorNodeId,
    });

    return { renderNodeId, position: linked.position, error: null };
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
