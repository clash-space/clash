/**
 * Auto-insert layout logic for new nodes.
 *
 * Uses column-based placement by node type:
 *   Column 0 (x ≈ origin):   text / prompt nodes
 *   Column 1 (x + offset):   action-badge nodes
 *   Column 2 (x + offset):   image / video / audio output nodes
 *
 * Within a column, nodes that share a common root ancestor ("family")
 * are stacked vertically together. Families are separated by a larger gap.
 *
 * When a new node has an edge from a source node, it is placed in the
 * appropriate column, vertically aligned with its source's family.
 */

import type { LayoutNode, LayoutEdge } from './types';
import type { Point, Rect } from './types';
import { getNodeSize, rectOverlaps } from './core/geometry';

/** Special position value indicating a node needs auto-layout */
export const NEEDS_LAYOUT_POSITION: Point = { x: -1, y: -1 };

/** Default gap between nodes in the same family */
const GAP_Y = 20;
/** Gap between different families */
const FAMILY_GAP_Y = 60;
/** Horizontal gap between columns */
const COL_GAP = 80;
/** Left margin */
const MARGIN = 80;

const MAX_MEDIA_DIMENSION = 500;

function calculateScaledDimensions(naturalWidth: number, naturalHeight: number): { width: number; height: number } {
  if (!naturalWidth || !naturalHeight) return { width: 400, height: 400 };
  const scale = Math.min(1, MAX_MEDIA_DIMENSION / Math.max(naturalWidth, naturalHeight));
  return { width: Math.round(naturalWidth * scale), height: Math.round(naturalHeight * scale) };
}

/** Check if a node needs auto-layout based on its position */
export function needsAutoLayout(node: LayoutNode): boolean {
  if (!node.position) return true;
  return node.position.x === NEEDS_LAYOUT_POSITION.x && node.position.y === NEEDS_LAYOUT_POSITION.y;
}

// ─── Column assignment ──────────────────────────────────

/** Determine which column a node belongs to based on its type */
function getColumn(type: string): number {
  switch (type) {
    case 'text':
    case 'prompt':
    case 'context':
      return 0;
    case 'action-badge':
    case 'image_gen':
    case 'video_gen':
      return 1;
    case 'image':
    case 'video':
    case 'audio':
      return 2;
    case 'video-editor':
      return 1;
    case 'group':
      return 0;
    default:
      return 2;
  }
}

/** Get the maximum width of nodes in a given column */
function getColumnWidth(col: number): number {
  switch (col) {
    case 0: return 300;  // text nodes
    case 1: return 320;  // action-badge
    case 2: return 500;  // image/video
    default: return 300;
  }
}

/** Get the X position for a column */
function getColumnX(col: number): number {
  let x = MARGIN;
  for (let c = 0; c < col; c++) {
    x += getColumnWidth(c) + COL_GAP;
  }
  return x;
}

// ─── Family detection ───────────────────────────────────

/** Find the root ancestor of a node by walking edges backward */
function findRootAncestor(
  nodeId: string,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): string {
  const visited = new Set<string>();
  let current = nodeId;

  while (!visited.has(current)) {
    visited.add(current);
    const incomingEdge = edges.find(e => e.target === current);
    if (!incomingEdge) break;
    // Only follow edges within the same parent group
    const currentNode = nodes.find(n => n.id === current);
    const sourceNode = nodes.find(n => n.id === incomingEdge.source);
    if (!sourceNode || sourceNode.parentId !== currentNode?.parentId) break;
    current = incomingEdge.source;
  }

  return current;
}

// ─── Reference finding ──────────────────────────────────

/** Find the source node connected via an incoming edge, in the same group */
export function findReferenceNode(
  nodeId: string,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): LayoutNode | null {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) return null;

  const incomingEdge = edges.find(e => e.target === nodeId);
  if (!incomingEdge) return null;

  const sourceNode = nodes.find(n => n.id === incomingEdge.source);
  if (!sourceNode) return null;
  if (sourceNode.parentId !== node.parentId) return null;

  return sourceNode;
}

// ─── Node dimensions ────────────────────────────────────

function normalizeDimension(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function getNodeHeight(node: LayoutNode): number {
  const defaultSize = getNodeSize(node.type || 'default');
  return (
    normalizeDimension(node.height) ??
    (node.data?.naturalWidth && node.data?.naturalHeight
      ? calculateScaledDimensions(node.data.naturalWidth as number, node.data.naturalHeight as number).height
      : undefined) ??
    normalizeDimension(node.style?.height) ??
    defaultSize.height
  );
}

function getNodeWidth(node: LayoutNode): number {
  const defaultSize = getNodeSize(node.type || 'default');
  return (
    normalizeDimension(node.width) ??
    (node.data?.naturalWidth && node.data?.naturalHeight
      ? calculateScaledDimensions(node.data.naturalWidth as number, node.data.naturalHeight as number).width
      : undefined) ??
    normalizeDimension(node.style?.width) ??
    defaultSize.width
  );
}

// ─── Position calculation ───────────────────────────────

/**
 * Calculate insertion position using column-based layout.
 *
 * 1. Determine column by node type
 * 2. Find family (root ancestor via edges)
 * 3. Stack below siblings in same column + family
 * 4. If no siblings, align Y with source node
 */
export function calculateInsertPosition(
  node: LayoutNode,
  referenceNode: LayoutNode | null,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): Point {
  const col = getColumn(node.type || 'default');
  const x = getColumnX(col);

  // Find family root
  const familyRoot = referenceNode
    ? findRootAncestor(referenceNode.id, nodes, edges)
    : node.id;

  // Find existing siblings: same column, same family, same parent, already positioned
  const siblings = nodes.filter(n => {
    if (n.id === node.id) return false;
    if (n.parentId !== node.parentId) return false;
    if (n.type === 'group') return false;
    if (!n.position || n.position.x === NEEDS_LAYOUT_POSITION.x) return false;
    if (getColumn(n.type || 'default') !== col) return false;
    // Same family?
    const nFamily = findRootAncestor(n.id, nodes, edges);
    return nFamily === familyRoot;
  });

  if (siblings.length > 0) {
    // Stack below the last sibling in this column+family
    let maxBottom = 0;
    for (const s of siblings) {
      const bottom = s.position.y + getNodeHeight(s);
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return { x, y: maxBottom + GAP_Y };
  }

  if (referenceNode && referenceNode.position && referenceNode.position.x !== NEEDS_LAYOUT_POSITION.x) {
    // First node in this column for this family — align Y with reference
    return { x, y: referenceNode.position.y };
  }

  // No reference, no siblings — find bottom of this column across all families
  const columnNodes = nodes.filter(n => {
    if (n.id === node.id) return false;
    if (n.parentId !== node.parentId) return false;
    if (!n.position || n.position.x === NEEDS_LAYOUT_POSITION.x) return false;
    return getColumn(n.type || 'default') === col;
  });

  if (columnNodes.length > 0) {
    let maxBottom = 0;
    for (const n of columnNodes) {
      const bottom = n.position.y + getNodeHeight(n);
      if (bottom > maxBottom) maxBottom = bottom;
    }
    return { x, y: maxBottom + FAMILY_GAP_Y };
  }

  return { x, y: MARGIN };
}

// ─── Overlap resolution ─────────────────────────────────

/** Find overlapping siblings (same parent, not group, not self) */
export function getOverlappingSiblings(
  nodeId: string,
  nodeRect: Rect,
  parentId: string | undefined,
  nodes: LayoutNode[],
): LayoutNode[] {
  return nodes.filter(n => {
    if (n.id === nodeId) return false;
    if (n.parentId !== parentId) return false;
    if (n.type === 'group') return false;
    if (!n.position || n.position.x === NEEDS_LAYOUT_POSITION.x) return false;

    const siblingRect: Rect = {
      x: n.position.x,
      y: n.position.y,
      width: getNodeWidth(n),
      height: getNodeHeight(n),
    };
    return rectOverlaps(nodeRect, siblingRect);
  });
}

/**
 * Push overlapping nodes downward (vertical only) to resolve collisions.
 * Unlike the old chainPushRight, this preserves column alignment.
 */
export function chainPushDown(
  triggerNodeId: string,
  nodes: LayoutNode[],
  maxIterations: number = 20,
): Map<string, Point> {
  const positionUpdates = new Map<string, Point>();
  const workingPositions = new Map<string, Point>();

  for (const node of nodes) {
    if (!node.position) continue;
    workingPositions.set(node.id, { ...node.position });
  }

  const toCheck = new Set<string>([triggerNodeId]);
  const checked = new Set<string>();
  let iterations = 0;

  while (toCheck.size > 0 && iterations < maxIterations) {
    iterations++;
    const next = toCheck.values().next();
    if (next.done) break;
    const nodeId = next.value;
    toCheck.delete(nodeId);

    if (checked.has(nodeId)) continue;
    checked.add(nodeId);

    const node = nodes.find(n => n.id === nodeId);
    if (!node) continue;

    const nodePos = workingPositions.get(nodeId)!;
    const nodeWidth = getNodeWidth(node);
    const nodeHeight = getNodeHeight(node);
    const nodeRect: Rect = { x: nodePos.x, y: nodePos.y, width: nodeWidth, height: nodeHeight };

    const siblings = nodes.filter(n => {
      if (n.id === nodeId) return false;
      if (n.parentId !== node.parentId) return false;
      if (n.type === 'group') return false;
      const pos = workingPositions.get(n.id);
      if (!pos || pos.x === NEEDS_LAYOUT_POSITION.x) return false;
      return true;
    });

    for (const sibling of siblings) {
      const siblingPos = workingPositions.get(sibling.id)!;
      const siblingWidth = getNodeWidth(sibling);
      const siblingHeight = getNodeHeight(sibling);
      const siblingRect: Rect = { x: siblingPos.x, y: siblingPos.y, width: siblingWidth, height: siblingHeight };

      if (!rectOverlaps(nodeRect, siblingRect)) continue;

      // Push down (not right)
      const pushDistance = nodeRect.y + nodeRect.height + GAP_Y - siblingPos.y;
      if (pushDistance > 0) {
        const newPos: Point = { x: siblingPos.x, y: siblingPos.y + pushDistance };
        workingPositions.set(sibling.id, newPos);
        positionUpdates.set(sibling.id, newPos);
        toCheck.add(sibling.id);
      }
    }
  }

  return positionUpdates;
}

// Keep old name for backward compatibility
export const chainPushRight = chainPushDown;

// ─── Bottom-Y helper ────────────────────────────────────

export function findBottomY(parentId: string | undefined, nodes: LayoutNode[]): number {
  const siblings = nodes.filter(
    n => n.parentId === parentId && n.position?.x !== NEEDS_LAYOUT_POSITION.x,
  );
  if (siblings.length === 0) return MARGIN;

  let maxBottom = 0;
  for (const sibling of siblings) {
    if (!sibling.position) continue;
    const bottom = sibling.position.y + getNodeHeight(sibling);
    if (bottom > maxBottom) maxBottom = bottom;
  }
  return maxBottom + FAMILY_GAP_Y;
}

// ─── Main entry point ───────────────────────────────────

export interface AutoInsertResult {
  position: Point;
  pushedNodes: Map<string, Point>;
  hasReference: boolean;
  referenceNodeId?: string;
}

/**
 * Auto-insert a node using column-based layout and resolve overlaps.
 */
export function autoInsertNode(
  nodeId: string,
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): AutoInsertResult {
  const node = nodes.find(n => n.id === nodeId);
  if (!node) {
    return { position: { x: MARGIN, y: MARGIN }, pushedNodes: new Map(), hasReference: false };
  }

  const referenceNode = findReferenceNode(nodeId, nodes, edges);
  const position = calculateInsertPosition(node, referenceNode, nodes, edges);

  const nodesWithPosition = nodes.map(n =>
    n.id === nodeId ? { ...n, position } : n,
  );

  const pushedNodes = chainPushDown(nodeId, nodesWithPosition);

  return {
    position,
    pushedNodes,
    hasReference: !!referenceNode,
    referenceNodeId: referenceNode?.id,
  };
}

/** Apply auto-insert result to a nodes array */
export function applyAutoInsertResult(
  nodes: LayoutNode[],
  nodeId: string,
  result: AutoInsertResult,
): LayoutNode[] {
  return nodes.map(node => {
    if (node.id === nodeId) return { ...node, position: result.position };
    const pushedPosition = result.pushedNodes.get(node.id);
    if (pushedPosition) return { ...node, position: pushedPosition };
    return node;
  });
}

/** Process all nodes that need auto-layout */
export function processAutoLayoutNodes(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
): { nodes: LayoutNode[]; processed: string[] } {
  const nodesToLayout = nodes.filter(needsAutoLayout);
  const processed: string[] = [];

  if (nodesToLayout.length === 0) return { nodes, processed };

  let updatedNodes = [...nodes];

  for (const node of nodesToLayout) {
    const result = autoInsertNode(node.id, updatedNodes, edges);
    updatedNodes = applyAutoInsertResult(updatedNodes, node.id, result);
    processed.push(node.id);
  }

  return { nodes: updatedNodes, processed };
}
