/**
 * Relayout: distance-based clustering + horizontal tree expansion.
 *
 * 1. Cluster nodes by spatial proximity (nearby nodes = one cluster)
 * 2. Within each cluster, expand as horizontal trees via edges (root left → children right)
 * 3. Clusters stack top to bottom
 * 4. Orphan nodes (no edges, no cluster) stack at the bottom
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

// ─── Distance-based clustering ──────────────────────────

function nodeCenter(n: LayoutNode, all: LayoutNode[]): Point {
  const size = getNodeSize(n, all);
  return { x: n.position.x + size.width / 2, y: n.position.y + size.height / 2 };
}

function dist(a: Point, b: Point): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

/**
 * Clustering: first merge edge-connected nodes, then merge nearby clusters by distance.
 */
function clusterByDistance(
  nodes: LayoutNode[],
  allNodes: LayoutNode[],
  edges: LayoutEdge[],
  threshold: number,
): LayoutNode[][] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Union-Find: start by merging edge-connected nodes
  const parent = new Map<string, string>();
  for (const n of nodes) parent.set(n.id, n.id);

  function find(x: string): string {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) { const next = parent.get(c)!; parent.set(c, r); c = next; }
    return r;
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // Merge edge-connected nodes first (so badge + its images are always together)
  for (const e of edges) {
    if (nodeIds.has(e.source) && nodeIds.has(e.target)) {
      union(e.source, e.target);
    }
  }

  // Build initial clusters from union-find
  const groupMap = new Map<string, LayoutNode[]>();
  for (const n of nodes) {
    const root = find(n.id);
    const list = groupMap.get(root) ?? [];
    list.push(n);
    groupMap.set(root, list);
  }

  let clusters: { nodes: LayoutNode[]; center: Point }[] = [...groupMap.values()].map(group => {
    let cx = 0, cy = 0;
    for (const n of group) {
      const c = nodeCenter(n, allNodes);
      cx += c.x; cy += c.y;
    }
    return { nodes: group, center: { x: cx / group.length, y: cy / group.length } };
  });

  // Then merge nearby clusters by distance
  let merged = true;
  while (merged && clusters.length > 1) {
    merged = false;
    let bestDist = Infinity;
    let bestI = -1, bestJ = -1;

    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = dist(clusters[i].center, clusters[j].center);
        if (d < bestDist) { bestDist = d; bestI = i; bestJ = j; }
      }
    }

    if (bestDist < threshold && bestI >= 0 && bestJ >= 0) {
      const a = clusters[bestI], b = clusters[bestJ];
      const total = a.nodes.length + b.nodes.length;
      clusters[bestI] = {
        nodes: [...a.nodes, ...b.nodes],
        center: {
          x: (a.center.x * a.nodes.length + b.center.x * b.nodes.length) / total,
          y: (a.center.y * a.nodes.length + b.center.y * b.nodes.length) / total,
        },
      };
      clusters.splice(bestJ, 1);
      merged = true;
    }
  }

  clusters.sort((a, b) => a.center.y - b.center.y);
  return clusters.map(c => c.nodes);
}

// ─── Horizontal tree expansion ──────────────────────────

interface TreeNode {
  id: string;
  children: TreeNode[];
}

/**
 * Build forest of trees from edges within a node set.
 * Roots = nodes with no incoming edges (within the set).
 * Isolated nodes = single-node trees.
 */
function buildForest(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): TreeNode[] {
  const ids = new Set(nodes.map(n => n.id));
  const relevantEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target));

  const childrenMap = new Map<string, string[]>();
  const hasIncoming = new Set<string>();

  for (const e of relevantEdges) {
    const children = childrenMap.get(e.source) ?? [];
    children.push(e.target);
    childrenMap.set(e.source, children);
    hasIncoming.add(e.target);
  }

  // Roots: nodes with no incoming edge
  const roots = nodes.filter(n => !hasIncoming.has(n.id));
  // If no roots (cycle), just use all nodes as roots
  if (roots.length === 0) return nodes.map(n => ({ id: n.id, children: [] }));

  const visited = new Set<string>();

  function buildTree(id: string): TreeNode {
    visited.add(id);
    const children = (childrenMap.get(id) ?? [])
      .filter(c => !visited.has(c))
      .map(c => buildTree(c));
    return { id, children };
  }

  const forest: TreeNode[] = [];
  for (const root of roots) {
    if (!visited.has(root.id)) {
      forest.push(buildTree(root.id));
    }
  }

  // Add any remaining unvisited nodes as isolated trees
  for (const n of nodes) {
    if (!visited.has(n.id)) {
      forest.push({ id: n.id, children: [] });
    }
  }

  return forest;
}

/**
 * Lay out a tree horizontally: root on the left, children to the right.
 * Returns positions relative to (0, 0) and the bounding box height.
 */
function layoutTree(
  tree: TreeNode,
  nodesById: Map<string, LayoutNode>,
  allNodes: LayoutNode[],
  gapX: number,
  gapY: number,
): { positions: Map<string, Point>; width: number; height: number } {
  const positions = new Map<string, Point>();

  function measure(node: TreeNode, x: number, y: number): { width: number; height: number } {
    const layoutNode = nodesById.get(node.id);
    if (!layoutNode) return { width: 0, height: 0 };
    const size = getNodeSize(layoutNode, allNodes);

    if (node.children.length === 0) {
      positions.set(node.id, { x, y });
      return { width: size.width, height: size.height };
    }

    // Lay out children vertically, to the right
    const childX = x + size.width + gapX;
    let childY = y;
    let maxChildWidth = 0;
    let totalChildHeight = 0;

    for (let i = 0; i < node.children.length; i++) {
      if (i > 0) {
        childY += gapY;
        totalChildHeight += gapY;
      }
      const childResult = measure(node.children[i], childX, childY);
      maxChildWidth = Math.max(maxChildWidth, childResult.width);
      childY += childResult.height;
      totalChildHeight += childResult.height;
    }

    // Center the root vertically relative to its children
    const subtreeHeight = Math.max(size.height, totalChildHeight);
    const rootY = totalChildHeight > size.height
      ? y + (totalChildHeight - size.height) / 2
      : y;

    positions.set(node.id, { x, y: rootY });

    return {
      width: size.width + gapX + maxChildWidth,
      height: subtreeHeight,
    };
  }

  const result = measure(tree, 0, 0);
  return { positions, ...result };
}

// ─── Main layout ────────────────────────────────────────

function smartLayout(
  siblings: LayoutNode[],
  allNodes: LayoutNode[],
  edges: LayoutEdge[],
  opts: { gapX: number; gapY: number },
): Map<string, Point> {
  const positions = new Map<string, Point>();

  const groupNodes = siblings.filter(n => n.type === 'group');
  const nonGroupNodes = siblings.filter(n => n.type !== 'group');

  if (nonGroupNodes.length === 0) {
    groupNodes.forEach(n => positions.set(n.id, { ...n.position }));
    return positions;
  }

  const nodesById = new Map(nonGroupNodes.map(n => [n.id, n]));

  // Origin from current positions
  let originX = Infinity, originY = Infinity;
  for (const n of nonGroupNodes) {
    originX = Math.min(originX, n.position.x);
    originY = Math.min(originY, n.position.y);
  }
  if (!Number.isFinite(originX)) originX = 0;
  if (!Number.isFinite(originY)) originY = 0;

  // Cluster: first merge edge-connected nodes, then by distance (~800px)
  const siblingEdges = edges.filter(e => {
    const ids = new Set(nonGroupNodes.map(n => n.id));
    return ids.has(e.source) && ids.has(e.target);
  });
  const clusters = clusterByDistance(nonGroupNodes, allNodes, siblingEdges, 1500);

  let cursorY = originY;

  for (const cluster of clusters) {
    // Build trees within this cluster
    const forest = buildForest(cluster, edges);

    // Sort trees by original Y of their root
    forest.sort((a, b) => {
      const na = nodesById.get(a.id), nb = nodesById.get(b.id);
      return (na?.position.y ?? 0) - (nb?.position.y ?? 0);
    });

    // Layout each tree, stack vertically.
    // Merge consecutive isolated text nodes into one horizontal row.
    let i = 0;
    while (i < forest.length) {
      const tree = forest[i];
      const treeNode = nodesById.get(tree.id);
      const isIsolatedText = tree.children.length === 0 && treeNode &&
        (treeNode.type === 'text' || treeNode.type === 'context');

      if (isIsolatedText) {
        // Collect consecutive isolated text nodes
        const textGroup: TreeNode[] = [tree];
        let j = i + 1;
        while (j < forest.length) {
          const next = forest[j];
          const nextNode = nodesById.get(next.id);
          if (next.children.length === 0 && nextNode &&
            (nextNode.type === 'text' || nextNode.type === 'prompt' || nextNode.type === 'context')) {
            textGroup.push(next);
            j++;
          } else {
            break;
          }
        }

        // Place text group horizontally
        let textX = originX;
        let maxTextHeight = 0;
        for (const t of textGroup) {
          const n = nodesById.get(t.id)!;
          const size = getNodeSize(n, allNodes);
          maxTextHeight = Math.max(maxTextHeight, size.height);
        }
        for (const t of textGroup) {
          const n = nodesById.get(t.id)!;
          const size = getNodeSize(n, allNodes);
          positions.set(t.id, {
            x: textX,
            y: cursorY + (maxTextHeight - size.height) / 2,
          });
          textX += size.width + opts.gapX;
        }
        cursorY += maxTextHeight + opts.gapY;
        i = j;
      } else {
        // Normal tree layout
        const result = layoutTree(tree, nodesById, allNodes, opts.gapX, opts.gapY);
        for (const [id, pos] of result.positions) {
          positions.set(id, { x: originX + pos.x, y: cursorY + pos.y });
        }
        cursorY += result.height + opts.gapY;
        i++;
      }
    }

    // Extra gap between clusters
    cursorY += opts.gapY;
  }

  // Groups keep position
  for (const g of groupNodes) positions.set(g.id, { ...g.position });

  return positions;
}

// ─── Public API ─────────────────────────────────────────

export function relayoutToGrid(nodes: LayoutNode[], options: RelayoutGridOptions = {}): LayoutNode[] {
  const hasScope = Object.prototype.hasOwnProperty.call(options, 'scopeParentId') && options.scopeParentId !== undefined;
  const opts = { gapX: options.gapX ?? 60, gapY: options.gapY ?? 30 };

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
