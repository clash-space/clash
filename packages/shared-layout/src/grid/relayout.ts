/**
 * Smart relayout: preserves relative positions while tidying up.
 *
 * Strategy:
 *   1. Separate text/prompt nodes → left column
 *   2. Build edge-based rows: each source + its direct targets
 *   3. Wide rows (>3 targets) wrap into sub-rows
 *   4. Sort rows by original centroid Y (preserves vertical order)
 *   5. Group related rows (same text ancestor) with tighter spacing
 *   6. Assign positions with consistent spacing
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

const MAX_TARGETS_PER_ROW = 3;

function getNodeSize(node: LayoutNode, all: LayoutNode[]): { width: number; height: number } {
  const r = getAbsoluteRect(node, all);
  return { width: r.width, height: r.height };
}

function isTextType(type: string): boolean {
  return type === 'text' || type === 'prompt' || type === 'context';
}

// ─── Edge analysis ──────────────────────────────────────

interface LayoutRow {
  nodeIds: string[];
  /** ID of the source node (badge) if this is a connected row */
  sourceId?: string;
  /** ID of the text ancestor for grouping */
  familyId?: string;
  originalCentroidY: number;
}

/**
 * Find the text node ancestor of a source node via edges.
 * Walks backward through edges to find a text/prompt node.
 */
function findTextAncestor(
  nodeId: string,
  nodesById: Map<string, LayoutNode>,
  targetToSources: Map<string, Set<string>>,
  visited = new Set<string>(),
): string | undefined {
  if (visited.has(nodeId)) return undefined;
  visited.add(nodeId);

  const node = nodesById.get(nodeId);
  if (!node) return undefined;
  if (isTextType(node.type || '')) return nodeId;

  const sources = targetToSources.get(nodeId);
  if (!sources) return undefined;

  for (const srcId of sources) {
    const result = findTextAncestor(srcId, nodesById, targetToSources, visited);
    if (result) return result;
  }
  return undefined;
}

/**
 * Build rows from edges, with wrapping for wide fan-outs.
 */
function buildEdgeRows(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): { rows: LayoutRow[]; textNodeIds: Set<string> } {
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodesById = new Map(nodes.map(n => [n.id, n]));
  const relevantEdges = edges.filter(e => nodeIds.has(e.source) && nodeIds.has(e.target));

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

  // Identify text nodes (they go in the left column, not in rows)
  const textNodeIds = new Set<string>();
  for (const n of nodes) {
    if (isTextType(n.type || '')) textNodeIds.add(n.id);
  }

  const assigned = new Set<string>();
  const rows: LayoutRow[] = [];

  // Mark text nodes as assigned (handled separately)
  for (const id of textNodeIds) assigned.add(id);

  // Process source nodes (nodes with outgoing edges), excluding text nodes
  const sourceNodes = [...sourceToTargets.keys()]
    .filter(id => !textNodeIds.has(id))
    .sort((a, b) => {
      const na = nodesById.get(a)!, nb = nodesById.get(b)!;
      return na.position.y - nb.position.y;
    });

  for (const srcId of sourceNodes) {
    if (assigned.has(srcId)) continue;
    const targets = sourceToTargets.get(srcId) ?? new Set();

    assigned.add(srcId);

    const sortedTargets = [...targets]
      .filter(t => !assigned.has(t))
      .sort((a, b) => {
        const na = nodesById.get(a)!, nb = nodesById.get(b)!;
        return na.position.x - nb.position.x;
      });

    for (const tgt of sortedTargets) assigned.add(tgt);

    // Find text ancestor for family grouping
    const familyId = findTextAncestor(srcId, nodesById, targetToSources);

    // Split targets into chunks for wrapping
    if (sortedTargets.length <= MAX_TARGETS_PER_ROW) {
      // Single row: source + all targets
      const rowNodeIds = [srcId, ...sortedTargets];
      let sumY = 0;
      for (const id of rowNodeIds) sumY += nodesById.get(id)!.position.y;

      rows.push({
        nodeIds: rowNodeIds,
        sourceId: srcId,
        familyId,
        originalCentroidY: sumY / rowNodeIds.length,
      });
    } else {
      // First row: source + first chunk of targets
      const firstChunk = sortedTargets.slice(0, MAX_TARGETS_PER_ROW);
      const firstRowIds = [srcId, ...firstChunk];
      let sumY = 0;
      for (const id of firstRowIds) sumY += nodesById.get(id)!.position.y;

      rows.push({
        nodeIds: firstRowIds,
        sourceId: srcId,
        familyId,
        originalCentroidY: sumY / firstRowIds.length,
      });

      // Subsequent rows: just targets (indented, no source)
      for (let i = MAX_TARGETS_PER_ROW; i < sortedTargets.length; i += MAX_TARGETS_PER_ROW) {
        const chunk = sortedTargets.slice(i, i + MAX_TARGETS_PER_ROW);
        let chunkSumY = 0;
        for (const id of chunk) chunkSumY += nodesById.get(id)!.position.y;

        rows.push({
          nodeIds: chunk,
          sourceId: undefined,  // continuation row, indented
          familyId,
          originalCentroidY: chunkSumY / chunk.length,
        });
      }
    }
  }

  // Remaining unassigned non-text nodes (orphans)
  for (const node of nodes) {
    if (assigned.has(node.id)) continue;
    assigned.add(node.id);
    rows.push({
      nodeIds: [node.id],
      originalCentroidY: node.position.y,
    });
  }

  // Sort rows by original centroid Y
  rows.sort((a, b) => a.originalCentroidY - b.originalCentroidY);

  return { rows, textNodeIds };
}

// ─── Position assignment ────────────────────────────────

function assignPositions(
  rows: LayoutRow[],
  textNodeIds: Set<string>,
  nodesById: Map<string, LayoutNode>,
  allNodes: LayoutNode[],
  originX: number,
  opts: { gapX: number; gapY: number },
): Map<string, Point> {
  const positions = new Map<string, Point>();

  // Reserve left column for text nodes
  let textColWidth = 0;
  for (const id of textNodeIds) {
    const n = nodesById.get(id);
    if (n) textColWidth = Math.max(textColWidth, getNodeSize(n, allNodes).width);
  }
  const contentX = textNodeIds.size > 0 ? originX + textColWidth + opts.gapX : originX;

  // Indentation for continuation rows (no source node)
  const sourceWidth = 320 + opts.gapX;  // approximate badge width + gap

  // Starting Y
  let minOriginalY = Infinity;
  for (const row of rows) {
    for (const id of row.nodeIds) {
      const n = nodesById.get(id);
      if (n) minOriginalY = Math.min(minOriginalY, n.position.y);
    }
  }
  for (const id of textNodeIds) {
    const n = nodesById.get(id);
    if (n) minOriginalY = Math.min(minOriginalY, n.position.y);
  }
  let cursorY = Number.isFinite(minOriginalY) ? minOriginalY : 0;

  // Track Y ranges for each family (for text node alignment)
  const familyYStart = new Map<string, number>();
  const familyYEnd = new Map<string, number>();

  let prevFamilyId: string | undefined;

  for (const row of rows) {
    // Add extra spacing between different families
    if (row.familyId && prevFamilyId && row.familyId !== prevFamilyId) {
      cursorY += opts.gapY;  // extra gap between families
    }
    prevFamilyId = row.familyId;

    const rowNodes = row.nodeIds.map(id => nodesById.get(id)!).filter(Boolean);
    if (rowNodes.length === 0) continue;

    // Row height
    let rowHeight = 0;
    for (const node of rowNodes) {
      rowHeight = Math.max(rowHeight, getNodeSize(node, allNodes).height);
    }

    // Track family Y range
    if (row.familyId) {
      if (!familyYStart.has(row.familyId)) familyYStart.set(row.familyId, cursorY);
      familyYEnd.set(row.familyId, cursorY + rowHeight);
    }

    // X position: indented if continuation row (no source)
    let cursorX = row.sourceId ? contentX : contentX + sourceWidth;

    for (const node of rowNodes) {
      const size = getNodeSize(node, allNodes);
      positions.set(node.id, {
        x: cursorX,
        y: cursorY + (rowHeight - size.height) / 2,
      });
      cursorX += size.width + opts.gapX;
    }

    cursorY += rowHeight + opts.gapY;
  }

  // ── Place text nodes in left column ────────────────────

  // For each text node, try to align it with its family's Y range
  const textNodes = [...textNodeIds].map(id => nodesById.get(id)!).filter(Boolean);
  textNodes.sort((a, b) => a.position.y - b.position.y);

  // Build text→family map via edges
  const textFamilyMap = new Map<string, string>();
  for (const row of rows) {
    if (row.familyId && row.sourceId) {
      // This family is anchored to a text node
      textFamilyMap.set(row.familyId, row.familyId);
    }
  }

  let textCursorY = Number.isFinite(minOriginalY) ? minOriginalY : 0;

  for (const textNode of textNodes) {
    const size = getNodeSize(textNode, allNodes);

    // Try to align with family Y range
    const famStart = familyYStart.get(textNode.id);
    const famEnd = familyYEnd.get(textNode.id);

    if (famStart !== undefined && famEnd !== undefined) {
      // Center text node vertically within its family's range
      const famMidY = (famStart + famEnd) / 2;
      const textY = famMidY - size.height / 2;
      positions.set(textNode.id, { x: originX, y: Math.max(textCursorY, textY) });
      textCursorY = Math.max(textCursorY, textY) + size.height + opts.gapY;
    } else {
      // No family — place sequentially
      positions.set(textNode.id, { x: originX, y: textCursorY });
      textCursorY += size.height + opts.gapY;
    }
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
  const groupNodes = siblings.filter(n => n.type === 'group');
  const nonGroupNodes = siblings.filter(n => n.type !== 'group');

  if (nonGroupNodes.length === 0) {
    const positions = new Map<string, Point>();
    groupNodes.forEach(n => positions.set(n.id, { ...n.position }));
    return positions;
  }

  const nodesById = new Map(nonGroupNodes.map(n => [n.id, n]));
  const { rows, textNodeIds } = buildEdgeRows(nonGroupNodes, edges);

  let originX = Infinity;
  for (const n of nonGroupNodes) originX = Math.min(originX, n.position.x);
  if (!Number.isFinite(originX)) originX = 0;

  const positions = assignPositions(rows, textNodeIds, nodesById, allNodes, originX, opts);

  for (const g of groupNodes) positions.set(g.id, { ...g.position });

  return positions;
}

// ─── Public API ─────────────────────────────────────────

export function relayoutToGrid(nodes: LayoutNode[], options: RelayoutGridOptions = {}): LayoutNode[] {
  const hasScope = Object.prototype.hasOwnProperty.call(options, 'scopeParentId') && options.scopeParentId !== undefined;
  const opts = { gapX: options.gapX ?? 60, gapY: options.gapY ?? 40 };

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
    for (const [id, pos] of positions.entries()) nextPosById.set(id, pos);
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
