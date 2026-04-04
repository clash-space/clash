/**
 * Smart relayout: preserves relative positions while tidying up.
 *
 * Strategy:
 *   1. Build edge-based groups: each source + its direct targets = one row
 *   2. Orphan nodes (no edges): each becomes its own row
 *   3. Sort rows by their original centroid Y (preserves vertical order)
 *   4. Within each row: source left, targets right, sorted by original X
 *   5. Assign positions with consistent spacing
 */
import type { LayoutNode, LayoutEdge } from '../types';
import type { Point } from '../types';
import { getAbsoluteRect } from '../core/geometry';

type RelayoutGridOptions = {
  gapX?: number;
  gapY?: number;
  rankdir?: 'LR' | 'TB';
  scopeParentId?: string | undefined;
  edges?: LayoutEdge[];
  compact?: boolean;
  rowOverlapThreshold?: number;
  colOverlapThreshold?: number;
  centerInCell?: boolean;
};

function getNodeSize(node: LayoutNode, all: LayoutNode[]): { width: number; height: number } {
  const r = getAbsoluteRect(node, all);
  return { width: r.width, height: r.height };
}

// ─── Edge-based row grouping ────────────────────────────

interface LayoutRow {
  nodeIds: string[];
  originalCentroidY: number;
}

/**
 * Group nodes into rows based on edges.
 *
 * Each source node and its direct targets form a row.
 * Nodes that are only targets (not sources) get merged into their source's row.
 * Orphan nodes (no edges) each form their own single-node row.
 *
 * Within a row: source nodes first (by original X), then target nodes (by original X).
 */
function buildEdgeRows(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): LayoutRow[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodesById = new Map(nodes.map(n => [n.id, n]));
  const relevantEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

  // Find sources: nodes that have outgoing edges
  const sourceToTargets = new Map<string, Set<string>>();
  const targetToSources = new Map<string, Set<string>>();

  for (const e of relevantEdges) {
    const tgts = sourceToTargets.get(e.source) ?? new Set();
    tgts.add(e.target);
    sourceToTargets.set(e.source, tgts);

    const srcs = targetToSources.get(e.target) ?? new Set();
    srcs.add(e.source);
    targetToSources.set(e.target, srcs);
  }

  // Build rows: each source + its targets
  const assigned = new Set<string>();
  const rows: LayoutRow[] = [];

  // Process source nodes (nodes with outgoing edges)
  const sourceNodes = [...sourceToTargets.keys()].sort((a, b) => {
    const na = nodesById.get(a)!, nb = nodesById.get(b)!;
    return na.position.y - nb.position.y;
  });

  for (const srcId of sourceNodes) {
    if (assigned.has(srcId)) continue;
    const targets = sourceToTargets.get(srcId) ?? new Set();

    const rowNodeIds = [srcId];
    assigned.add(srcId);

    // Add targets not yet assigned
    const sortedTargets = [...targets]
      .filter(t => !assigned.has(t))
      .sort((a, b) => {
        const na = nodesById.get(a)!, nb = nodesById.get(b)!;
        return na.position.x - nb.position.x;
      });

    for (const tgt of sortedTargets) {
      rowNodeIds.push(tgt);
      assigned.add(tgt);
    }

    // Compute centroid Y from original positions
    let sumY = 0;
    for (const id of rowNodeIds) {
      sumY += nodesById.get(id)!.position.y;
    }
    rows.push({
      nodeIds: rowNodeIds,
      originalCentroidY: sumY / rowNodeIds.length,
    });
  }

  // Remaining unassigned nodes (orphans or pure targets)
  for (const node of nodes) {
    if (assigned.has(node.id)) continue;
    assigned.add(node.id);
    rows.push({
      nodeIds: [node.id],
      originalCentroidY: node.position.y,
    });
  }

  // Sort rows by original centroid Y (preserves vertical order)
  rows.sort((a, b) => a.originalCentroidY - b.originalCentroidY);

  return rows;
}

// ─── Position assignment ────────────────────────────────

function assignPositions(
  rows: LayoutRow[],
  nodesById: Map<string, LayoutNode>,
  allNodes: LayoutNode[],
  originX: number,
  opts: { gapX: number; gapY: number },
): Map<string, Point> {
  const positions = new Map<string, Point>();

  // Starting Y from the topmost node's original position
  let minOriginalY = Infinity;
  for (const row of rows) {
    for (const id of row.nodeIds) {
      const n = nodesById.get(id);
      if (n) minOriginalY = Math.min(minOriginalY, n.position.y);
    }
  }
  let cursorY = Number.isFinite(minOriginalY) ? minOriginalY : 0;

  for (const row of rows) {
    const rowNodes = row.nodeIds.map(id => nodesById.get(id)!).filter(Boolean);
    if (rowNodes.length === 0) continue;

    // Compute row height (tallest node)
    let rowHeight = 0;
    for (const node of rowNodes) {
      rowHeight = Math.max(rowHeight, getNodeSize(node, allNodes).height);
    }

    // Assign X positions left to right
    let cursorX = originX;
    for (const node of rowNodes) {
      const size = getNodeSize(node, allNodes);
      positions.set(node.id, {
        x: cursorX,
        y: cursorY + (rowHeight - size.height) / 2,  // vertically center in row
      });
      cursorX += size.width + opts.gapX;
    }

    cursorY += rowHeight + opts.gapY;
  }

  return positions;
}

// ─── Main ───────────────────────────────────────────────

function smartLayout(
  siblings: LayoutNode[],
  allNodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: { gapX: number; gapY: number },
): Map<string, Point> {
  // Separate groups
  const groupNodes = siblings.filter(n => n.type === 'group');
  const nonGroupNodes = siblings.filter(n => n.type !== 'group');

  if (nonGroupNodes.length === 0) {
    const positions = new Map<string, Point>();
    groupNodes.forEach(n => positions.set(n.id, { ...n.position }));
    return positions;
  }

  const nodesById = new Map(nonGroupNodes.map(n => [n.id, n]));

  // Build rows from edges
  const rows = buildEdgeRows(nonGroupNodes, edges);

  // Compute origin X
  let originX = Infinity;
  for (const n of nonGroupNodes) {
    originX = Math.min(originX, n.position.x);
  }
  if (!Number.isFinite(originX)) originX = 0;

  // Assign positions
  const positions = assignPositions(rows, nodesById, allNodes, originX, opts);

  // Groups keep their position
  for (const g of groupNodes) {
    positions.set(g.id, { ...g.position });
  }

  return positions;
}

// ─── Public API ─────────────────────────────────────────

export function relayoutToGrid(nodes: LayoutNode[], options: RelayoutGridOptions = {}): LayoutNode[] {
  const hasScope = Object.prototype.hasOwnProperty.call(options, 'scopeParentId') && options.scopeParentId !== undefined;
  const opts = {
    gapX: options.gapX ?? 60,
    gapY: options.gapY ?? 40,
  };

  const byParent = new Map<string | undefined, LayoutNode[]>();
  for (const n of nodes) {
    const key = (n as unknown as { parentId?: string | null }).parentId ?? undefined;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }

  const nextPosById = new Map<string, Point>();

  const entries = hasScope
    ? [[options.scopeParentId, byParent.get(options.scopeParentId) ?? []] as const]
    : Array.from(byParent.entries());

  for (const [, siblings] of entries) {
    if (siblings.length === 0) continue;
    const positions = smartLayout(siblings, nodes, options.edges || [], opts);
    for (const [id, pos] of positions.entries()) {
      nextPosById.set(id, pos);
    }
  }

  let changed = false;
  const next = nodes.map(n => {
    const pos = nextPosById.get(n.id);
    if (!pos) return n;
    if (pos.x === n.position.x && pos.y === n.position.y) return n;
    changed = true;
    return { ...n, position: pos };
  });

  return changed ? next : nodes;
}

export type { RelayoutGridOptions };
