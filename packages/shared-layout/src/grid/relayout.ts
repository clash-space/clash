/**
 * Graph-aware relayout using dagre (Sugiyama layered layout).
 *
 * Connected nodes (with edges) are laid out by dagre in topological layers.
 * Orphan nodes (no edges) are arranged in a type-based column grid.
 */
import dagre from '@dagrejs/dagre';
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

function computeOrigin(nodes: LayoutNode[]): Point {
  let minX = Infinity;
  let minY = Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.position.x);
    minY = Math.min(minY, n.position.y);
  }
  return {
    x: Number.isFinite(minX) ? minX : 0,
    y: Number.isFinite(minY) ? minY : 0,
  };
}

/** Determine column index for orphan nodes by type */
function getTypeColumn(type: string): number {
  switch (type) {
    case 'text': case 'prompt': case 'context': return 0;
    case 'action-badge': case 'image_gen': case 'video_gen': case 'video-editor': return 1;
    case 'image': case 'video': case 'audio': return 2;
    default: return 2;
  }
}

/**
 * Lay out nodes using dagre for connected subgraph + column grid for orphans.
 */
function layoutWithDagre(
  siblings: LayoutNode[],
  allNodes: LayoutNode[],
  origin: Point,
  opts: { gapX: number; gapY: number; rankdir: 'LR' | 'TB' },
  edges: LayoutEdge[],
): Map<string, Point> {
  const positions = new Map<string, Point>();
  const siblingIds = new Set(siblings.map(n => n.id));

  const groupNodes = siblings.filter(n => n.type === 'group');
  const nonGroupNodes = siblings.filter(n => n.type !== 'group');

  // Find edges within this sibling set
  const relevantEdges = edges.filter(e => siblingIds.has(e.source) && siblingIds.has(e.target));

  const connectedIds = new Set<string>();
  for (const e of relevantEdges) {
    connectedIds.add(e.source);
    connectedIds.add(e.target);
  }

  const connectedNodes = nonGroupNodes.filter(n => connectedIds.has(n.id));
  const orphanNodes = nonGroupNodes.filter(n => !connectedIds.has(n.id));

  let graphBottom = origin.y;
  let graphRight = origin.x;

  // ── 1. Layout connected nodes with dagre ───────────────

  if (connectedNodes.length > 0) {
    const g = new dagre.graphlib.Graph();
    g.setGraph({
      rankdir: opts.rankdir,
      // ranksep = distance between layers (horizontal in LR mode)
      ranksep: opts.gapX,
      // nodesep = distance between nodes in same layer (vertical in LR mode)
      nodesep: opts.gapY,
      marginx: 0,
      marginy: 0,
    });
    g.setDefaultEdgeLabel(() => ({}));

    for (const node of connectedNodes) {
      const size = getNodeSize(node, allNodes);
      g.setNode(node.id, { width: size.width, height: size.height });
    }

    for (const edge of relevantEdges) {
      g.setEdge(edge.source, edge.target);
    }

    dagre.layout(g);

    // dagre gives center coordinates → convert to top-left
    for (const node of connectedNodes) {
      const dn = g.node(node.id);
      if (!dn) continue;

      const pos = {
        x: origin.x + dn.x - dn.width / 2,
        y: origin.y + dn.y - dn.height / 2,
      };
      positions.set(node.id, pos);

      graphBottom = Math.max(graphBottom, pos.y + dn.height);
      graphRight = Math.max(graphRight, pos.x + dn.width);
    }
  }

  // ── 2. Layout orphan nodes in a grid below the dagre graph ──

  if (orphanNodes.length > 0) {
    const orphanStartY = connectedNodes.length > 0 ? graphBottom + opts.gapY * 2 : origin.y;

    // Sort orphans: text first, then badges, then media — for visual grouping
    const sorted = [...orphanNodes].sort((a, b) => getTypeColumn(a.type || '') - getTypeColumn(b.type || ''));

    // Lay out in a wrapping grid (max ~4 items per row)
    const maxRowWidth = 1600;
    let cursorX = origin.x;
    let cursorY = orphanStartY;
    let rowMaxHeight = 0;

    for (const node of sorted) {
      const size = getNodeSize(node, allNodes);

      if (cursorX + size.width > origin.x + maxRowWidth && cursorX > origin.x) {
        cursorX = origin.x;
        cursorY += rowMaxHeight + opts.gapY;
        rowMaxHeight = 0;
      }

      positions.set(node.id, { x: cursorX, y: cursorY });
      cursorX += size.width + opts.gapX;
      rowMaxHeight = Math.max(rowMaxHeight, size.height);
      graphBottom = Math.max(graphBottom, cursorY + size.height);
    }
  }

  // ── 3. Stack group nodes below everything ──────────────

  if (groupNodes.length > 0) {
    let groupY = graphBottom + opts.gapY * 2;
    for (const group of groupNodes) {
      const size = getNodeSize(group, allNodes);
      positions.set(group.id, { x: origin.x, y: groupY });
      groupY += size.height + opts.gapY;
    }
  }

  return positions;
}

/**
 * Relayout nodes using dagre-based graph layout.
 */
export function relayoutToGrid(nodes: LayoutNode[], options: RelayoutGridOptions = {}): LayoutNode[] {
  const hasScope = Object.prototype.hasOwnProperty.call(options, 'scopeParentId') && options.scopeParentId !== undefined;
  const opts = {
    gapX: options.gapX ?? 80,
    gapY: options.gapY ?? 40,
    rankdir: (options.rankdir ?? 'LR') as 'LR' | 'TB',
    scopeParentId: options.scopeParentId,
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
    ? [[opts.scopeParentId, byParent.get(opts.scopeParentId) ?? []] as const]
    : Array.from(byParent.entries());

  for (const [, siblings] of entries) {
    if (siblings.length === 0) continue;

    const origin = computeOrigin(siblings);

    const positions = layoutWithDagre(
      siblings,
      nodes,
      origin,
      { gapX: opts.gapX, gapY: opts.gapY, rankdir: opts.rankdir },
      options.edges || [],
    );

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
