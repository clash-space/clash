import type { Node as RFNode, Edge } from '@xyflow/react';
import { generateSemanticId } from '@clash/web-ui/lib/utils/semanticId';

export interface TrajectorySubgraph {
    /** Nodes to include in the preview: heads (reused from canvas) + cloneset (to be cloned). */
    nodeIds: Set<string>;
    /** Which of the nodeIds are heads — reused from canvas without duplication. */
    headIds: Set<string>;
    /** Leaf the user clicked on. */
    target: string;
}

function hasActionParent(nodeId: string, nodes: Map<string, RFNode>, incoming: Map<string, Edge[]>): boolean {
    const ins = incoming.get(nodeId) ?? [];
    return ins.some((e) => nodes.get(e.source)?.type === 'action-badge');
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
export function computeTrajectory(leafId: string, rfNodes: RFNode[], edges: Edge[]): TrajectorySubgraph {
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

    // If the leaf itself is a head (root upload), there's no trajectory.
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

            if (parent.type === 'action-badge') {
                queue.push(parent.id);
            } else {
                // Data node. Head if it has no action parent anywhere; otherwise
                // a waypoint to keep exploring.
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

/**
 * Turn the final preview graph into a clone payload.
 *
 * Fork semantics: the clone is a fully independent trajectory — **every**
 * node in the preview gets a fresh id, including heads. Heads (no incoming
 * edge in the preview) preserve their data verbatim (src / assetId / etc.)
 * so they start life as their own completed-material copy; non-heads are
 * stripped to `status: 'draft'` so they show as empty placeholders the
 * user will Build. The original canvas nodes are never touched — deleting
 * or mutating one side doesn't leak into the other.
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

    // Must have at least one cloneset node — otherwise we'd just copy a
    // completed material for no reason.
    if (clonesetIds.size === 0) return { newNodes: [], newEdges: [] };

    // Fresh id for every preview node (heads included).
    const idMap = new Map<string, string>();
    for (const id of [...headIds, ...clonesetIds]) {
        idMap.set(id, await generateSemanticId(projectId));
    }

    // Y offset — stack below the union bounding box so the clone doesn't collide.
    let bboxTop = Infinity;
    let bboxBottom = -Infinity;
    for (const n of previewNodes) {
        const src = originalNodeById.get(n.id);
        if (!src) continue;
        const y = src.position?.y ?? 0;
        const h = (typeof src.height === 'number' ? src.height : 0)
            || (typeof src.style?.height === 'number' ? (src.style.height as number) : 0)
            || 300;
        bboxTop = Math.min(bboxTop, y);
        bboxBottom = Math.max(bboxBottom, y + h);
    }
    const yOffset = bboxTop === Infinity ? 400 : (bboxBottom - bboxTop) + 80;

    const draftStatusTypes = new Set(['image', 'video', 'text']);

    const newNodes: RFNode[] = [];
    for (const oldId of [...headIds, ...clonesetIds]) {
        const old = originalNodeById.get(oldId);
        if (!old) continue;
        const newId = idMap.get(oldId)!;

        const origData = (old.data ?? {}) as Record<string, unknown>;
        const nextData: Record<string, unknown> = { ...origData };
        // Strip run-state flags regardless of role — these are tied to the
        // original execution, not to the content.
        delete nextData.runRequested;
        delete nextData.cascadeToken;
        delete nextData.cascadeCancel;
        delete nextData.cascadePropagated;
        delete nextData.failureReason;
        delete nextData.openPanel;

        if (headIds.has(oldId)) {
            // Head: fresh copy, retain completed content (src/assetId/thumbnails).
            // Clear `hasRun` defensively — a head isn't expected to be an
            // action, but if one sneaks through, don't carry the frozen flag.
            delete nextData.hasRun;
        } else if (old.type === 'action-badge') {
            delete nextData.hasRun;
            delete nextData.preAllocatedAssetId;
            delete nextData.status;
            delete nextData.referenceImageOrder;
        } else if (old.type && draftStatusTypes.has(old.type)) {
            nextData.status = 'draft';
            nextData.src = '';
            delete nextData.assetId;
            delete nextData.taskId;
            delete nextData.description;
            delete nextData.naturalWidth;
            delete nextData.naturalHeight;
            delete nextData.poster;
            delete nextData.coverUrl;
            delete nextData.thumbnail;
        }

        newNodes.push({
            ...old,
            id: newId,
            position: {
                x: old.position?.x ?? 0,
                y: (old.position?.y ?? 0) + yOffset,
            },
            data: nextData,
        });
    }

    // Every edge in the preview maps cleanly to the new id space — both
    // endpoints are guaranteed to be in `idMap` (heads + clonesets cover all
    // preview nodes).
    const newEdges: Edge[] = [];
    for (const e of previewEdges) {
        const newSource = idMap.get(e.source);
        const newTarget = idMap.get(e.target);
        if (!newSource || !newTarget) continue;
        const newId = `${newSource}-${newTarget}-${Math.random().toString(36).slice(2, 8)}`;
        newEdges.push({
            ...e,
            id: newId,
            source: newSource,
            target: newTarget,
        });
    }

    return { newNodes, newEdges };
}
