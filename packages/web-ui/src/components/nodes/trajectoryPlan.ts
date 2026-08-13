import type { Node as RFNode, Edge } from "@xyflow/react";
import { generateSemanticId } from "@clash/web-ui/lib/utils/semanticId";
import {
  getAbsoluteRect,
  getAbsolutePosition,
  rectUnion,
} from "@clash/shared-layout";
import type { LayoutNode } from "@clash/shared-layout";
import { getNodeSizeWithData } from "@clash/web-ui/lib/layout/hooks/useLayoutManager";

export interface TrajectorySubgraph {
  /** Nodes to include in the preview: heads (reused from canvas) + cloneset (to be cloned). */
  nodeIds: Set<string>;
  /** Which of the nodeIds are heads — reused from canvas without duplication. */
  headIds: Set<string>;
  /** Leaf the user clicked on. */
  target: string;
}

function hasActionParent(
  nodeId: string,
  nodes: Map<string, RFNode>,
  incoming: Map<string, Edge[]>,
): boolean {
  const ins = incoming.get(nodeId) ?? [];
  return ins.some((e) => nodes.get(e.source)?.type === "action-badge");
}

/**
 * Backward BFS from `leafId` to find the trajectory that produced it. Splits
 * visited nodes into **heads** (uploads / hand-placed material with no action
 * parent anywhere above — reused from canvas) and **cloneset** (action-badges
 * + intermediate outputs, which will be cloned as fresh drafts).
 *
 * Returns the combined `nodeIds` for easy preview rendering, plus the
 * `headIds` subset for classifying each preview node at render / apply time.
 */
export function computeTrajectory(
  leafId: string,
  rfNodes: RFNode[],
  edges: Edge[],
): TrajectorySubgraph {
  const nodeMap = new Map(rfNodes.map((n) => [n.id, n]));
  const incoming = new Map<string, Edge[]>();
  for (const e of edges) {
    const list = incoming.get(e.target);
    if (list) list.push(e);
    else incoming.set(e.target, [e]);
  }

  const nodeIds = new Set<string>([leafId]);
  const headIds = new Set<string>();
  const queue: string[] = [leafId];

  if (!hasActionParent(leafId, nodeMap, incoming)) {
    headIds.add(leafId);
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const ins = incoming.get(cur) ?? [];
    for (const e of ins) {
      const parent = nodeMap.get(e.source);
      if (!parent) continue;
      if (nodeIds.has(parent.id)) continue;
      nodeIds.add(parent.id);

      if (parent.type === "action-badge") {
        queue.push(parent.id);
      } else {
        if (hasActionParent(parent.id, nodeMap, incoming)) {
          queue.push(parent.id);
        } else {
          headIds.add(parent.id);
        }
      }
    }
  }

  return { nodeIds, headIds, target: leafId };
}

const DRAFT_CONTENT_TYPES = new Set(["image", "video", "audio", "text"]);

/**
 * Canonical action-badge data — mirrors what `ProjectEditor.addNode('action-badge-*', ...)`
 * writes when the user picks a fresh badge from the toolbar. Anything not in
 * this list (hasRun, preAllocatedAssetId, status, referenceImageOrder,
 * pendingTask, cascade flags, …) is intentionally dropped so the clone starts
 * from a clean execution state.
 */
function buildClonedActionBadgeData(
  orig: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (orig.label !== undefined) out.label = orig.label;
  if (orig.actionType !== undefined) out.actionType = orig.actionType;
  if (orig.modelId !== undefined) out.modelId = orig.modelId;
  if (orig.model !== undefined) out.model = orig.model;
  if (orig.modelParams && typeof orig.modelParams === "object") {
    out.modelParams = { ...(orig.modelParams as Record<string, unknown>) };
  }
  if (orig.content !== undefined) out.content = orig.content;
  if (orig.prompt !== undefined) out.prompt = orig.prompt;
  if (orig.customActionId !== undefined)
    out.customActionId = orig.customActionId;
  if (orig.customActionParams && typeof orig.customActionParams === "object") {
    out.customActionParams = {
      ...(orig.customActionParams as Record<string, unknown>),
    };
  }
  return out;
}

/**
 * Canonical fresh-draft data for image/video/audio/text — mirrors
 * `useSpawnPendingAsset.buildShape('draft', …)`. Refs/aspect/model are
 * re-resolved at adopt time from the upstream action-badge's live state, so
 * we don't carry them on the draft itself.
 */
function buildClonedDraftContentData(
  type: string,
  orig: Record<string, unknown>,
): Record<string, unknown> {
  const label = orig.label ?? `Draft ${type}`;
  const promptText = (orig.prompt as string) ?? "";
  if (type === "text") {
    return { label, content: "", status: "draft", prompt: promptText };
  }
  const out: Record<string, unknown> = {
    label,
    status: "draft",
    prompt: promptText,
  };
  // Carry the intended aspect ratio so the draft placeholder sizes the
  // same as the original — `getNodeSizeWithData` reads this when computing
  // node width/height. Adoption will overwrite it with whatever the
  // upstream action-badge resolves to at run time.
  if (orig.aspectRatio !== undefined) out.aspectRatio = orig.aspectRatio;
  return out;
}

/**
 * Canonical "completed content" data for a cloned head — only the display
 * fields a finished asset needs. Run-state, pendingTask, error, log etc.
 * never carry over.
 */
function buildClonedHeadContentData(
  type: string,
  orig: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    label: orig.label,
    status: orig.status ?? "completed",
  };
  if (orig.prompt !== undefined) out.prompt = orig.prompt;
  if (type === "text") {
    out.content = orig.content ?? "";
    return out;
  }
  if (orig.assetId !== undefined) out.assetId = orig.assetId;
  if (orig.description !== undefined) out.description = orig.description;
  if (orig.naturalWidth !== undefined) out.naturalWidth = orig.naturalWidth;
  if (orig.naturalHeight !== undefined) out.naturalHeight = orig.naturalHeight;
  if (orig.duration !== undefined) out.duration = orig.duration;
  if (orig.aspectRatio !== undefined) out.aspectRatio = orig.aspectRatio;
  return out;
}

/**
 * Turn the final preview graph into a clone payload.
 *
 * Each new node is built one-by-one through the same canonical field set its
 * normal "+" / spawn-draft pipeline would write — never via bulk `{...old}`
 * spread. That keeps clones independent of whatever ad-hoc fields the
 * original execution accumulated (pendingTask, log, hasRun, …) and means
 * adding a new field elsewhere doesn't silently leak into clones.
 *
 * Heads (no preview-incoming edge) are cloned too: action-badges as fresh
 * badges with the same prompt/model, content nodes as completed assets
 * pointing at the same R2 src.
 */
export async function applyTrajectory(
  previewNodes: RFNode[],
  previewEdges: Edge[],
  originalNodeById: Map<string, RFNode>,
  projectId: string,
): Promise<{ newNodes: RFNode[]; newEdges: Edge[] }> {
  if (previewNodes.length === 0) return { newNodes: [], newEdges: [] };

  const hasIncoming = new Set<string>();
  for (const e of previewEdges) hasIncoming.add(e.target);

  const headIds = new Set<string>();
  const clonesetIds = new Set<string>();
  for (const n of previewNodes) {
    if (hasIncoming.has(n.id)) clonesetIds.add(n.id);
    else headIds.add(n.id);
  }

  if (clonesetIds.size === 0) return { newNodes: [], newEdges: [] };

  const idMap = new Map<string, string>();
  for (const id of [...headIds, ...clonesetIds]) {
    idMap.set(id, await generateSemanticId(projectId));
  }

  // Compute the union bounding box of the originals via the canonical
  // layout helpers — they walk parent hierarchy (group offsets) and use
  // the same per-type default sizes (`getNodeSize`) the rest of the
  // canvas uses, so a chain entirely made of unmeasured drafts still
  // gets a realistic 400×400-per-node bbox instead of the old 300×300
  // fallback that caused clones to overlap their originals.
  const allCanvasNodes = Array.from(
    originalNodeById.values(),
  ) as unknown as LayoutNode[];
  const previewRects = previewNodes
    .map((n) => originalNodeById.get(n.id))
    .filter((n): n is RFNode => !!n)
    .map((n) => getAbsoluteRect(n as unknown as LayoutNode, allCanvasNodes));
  const bbox = rectUnion(previewRects);
  const yOffset = bbox ? bbox.height + 80 : 400;

  const newNodes: RFNode[] = [];
  for (const oldId of [...headIds, ...clonesetIds]) {
    const old = originalNodeById.get(oldId);
    if (!old || !old.type) continue;
    const newId = idMap.get(oldId)!;
    const origData = (old.data ?? {}) as Record<string, unknown>;

    let nextData: Record<string, unknown> | null = null;
    if (old.type === "action-badge") {
      nextData = buildClonedActionBadgeData(origData);
    } else if (DRAFT_CONTENT_TYPES.has(old.type)) {
      nextData = headIds.has(oldId)
        ? buildClonedHeadContentData(old.type, origData)
        : buildClonedDraftContentData(old.type, origData);
    } else {
      // Unsupported type for clone (e.g. group, video-editor) — skip.
      continue;
    }

    // Cloned nodes live at top level (no parentId — see canonical builders),
    // so the original's coordinates have to be resolved to absolute first;
    // a relative position from inside a group would otherwise land the
    // clone at the wrong canvas spot.
    const absPos = getAbsolutePosition(
      old as unknown as LayoutNode,
      allCanvasNodes,
    );
    const position = {
      x: absPos.x,
      y: absPos.y + yOffset,
    };

    // Same sizing logic the canonical addNodeWithAutoLayout uses: lets
    // image/video drafts size by aspectRatio (or naturalWidth/Height for
    // heads), with a per-type default fallback. Without this, RF
    // measures the node at content min-size and the placeholder collapses
    // to a few-pixel box.
    const size = getNodeSizeWithData(old.type, nextData);

    newNodes.push({
      id: newId,
      type: old.type,
      position,
      data: nextData,
      width: size.width,
      height: size.height,
    });
  }

  const newEdges: Edge[] = [];
  for (const e of previewEdges) {
    const newSource = idMap.get(e.source);
    const newTarget = idMap.get(e.target);
    if (!newSource || !newTarget) continue;
    const newId = `${newSource}-${newTarget}-${Math.random().toString(36).slice(2, 8)}`;
    newEdges.push({
      id: newId,
      source: newSource,
      target: newTarget,
      type: e.type ?? "default",
    });
  }

  return { newNodes, newEdges };
}
