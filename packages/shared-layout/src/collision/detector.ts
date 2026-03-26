import type { LayoutNode } from '../types';
import type { Rect, CollisionInfo } from '../types';
import { rectOverlaps, getAbsoluteRect, getOverlapRect } from '../core/geometry';
import { getSiblings } from '../group/hierarchy';

/**
 * Detect collision between two rectangles and return collision info
 */
export function detectCollision(
    nodeAId: string,
    rectA: Rect,
    nodeBId: string,
    rectB: Rect
): CollisionInfo | null {
    if (!rectOverlaps(rectA, rectB)) return null;

    const overlapRect = getOverlapRect(rectA, rectB);
    if (!overlapRect) return null;

    const overlapArea = overlapRect.width * overlapRect.height;

    const overlapWidth = overlapRect.width;
    const overlapHeight = overlapRect.height;

    let pushDirection: CollisionInfo['pushDirection'];
    let pushDistance: number;

    const centerAX = rectA.x + rectA.width / 2;
    const centerAY = rectA.y + rectA.height / 2;
    const centerBX = rectB.x + rectB.width / 2;
    const centerBY = rectB.y + rectB.height / 2;

    if (centerBX >= centerAX) {
        pushDirection = 'right';
        pushDistance = rectA.x + rectA.width - rectB.x;
    } else if (centerBY >= centerAY) {
        pushDirection = 'down';
        pushDistance = rectA.y + rectA.height - rectB.y;
    } else if (overlapWidth < overlapHeight) {
        if (centerBX < centerAX) {
            pushDirection = 'left';
            pushDistance = rectB.x + rectB.width - rectA.x;
        } else {
            pushDirection = 'right';
            pushDistance = rectA.x + rectA.width - rectB.x;
        }
    } else {
        if (centerBY < centerAY) {
            pushDirection = 'up';
            pushDistance = rectB.y + rectB.height - rectA.y;
        } else {
            pushDirection = 'down';
            pushDistance = rectA.y + rectA.height - rectB.y;
        }
    }

    return {
        nodeA: nodeAId,
        nodeB: nodeBId,
        overlapRect,
        overlapArea,
        pushDirection,
        pushDistance: Math.max(0, pushDistance),
    };
}

/**
 * Find all collisions among a set of nodes
 */
export function detectAllCollisions(
    nodes: LayoutNode[],
    options: {
        excludeIds?: Set<string>;
        onlyParentId?: string;
        includeGroups?: boolean;
    } = {}
): CollisionInfo[] {
    const { excludeIds = new Set(), onlyParentId, includeGroups = true } = options;

    const relevantNodes = nodes.filter((n) => {
        if (excludeIds.has(n.id)) return false;
        if (!includeGroups && n.type === 'group') return false;
        if (onlyParentId !== undefined && n.parentId !== onlyParentId) return false;
        return true;
    });

    const collisions: CollisionInfo[] = [];

    const nodesByParent = new Map<string | undefined, LayoutNode[]>();
    for (const node of relevantNodes) {
        const parentId = node.parentId;
        if (!nodesByParent.has(parentId)) {
            nodesByParent.set(parentId, []);
        }
        nodesByParent.get(parentId)!.push(node);
    }

    for (const siblings of nodesByParent.values()) {
        for (let i = 0; i < siblings.length; i++) {
            for (let j = i + 1; j < siblings.length; j++) {
                const nodeA = siblings[i];
                const nodeB = siblings[j];

                const rectA = getAbsoluteRect(nodeA, nodes);
                const rectB = getAbsoluteRect(nodeB, nodes);

                const collision = detectCollision(nodeA.id, rectA, nodeB.id, rectB);
                if (collision) {
                    collisions.push(collision);
                }
            }
        }
    }

    return collisions;
}

/**
 * Find collisions caused by a node expanding or moving
 */
export function detectCollisionsForNode(
    nodeId: string,
    nodes: LayoutNode[]
): CollisionInfo[] {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return [];

    const nodeRect = getAbsoluteRect(node, nodes);
    const siblings = getSiblings(nodeId, nodes);
    const collisions: CollisionInfo[] = [];

    for (const sibling of siblings) {
        const siblingRect = getAbsoluteRect(sibling, nodes);
        const collision = detectCollision(nodeId, nodeRect, sibling.id, siblingRect);
        if (collision) {
            collisions.push(collision);
        }
    }

    return collisions;
}

/**
 * Check if a specific node has any collisions
 */
export function hasCollisions(nodeId: string, nodes: LayoutNode[]): boolean {
    return detectCollisionsForNode(nodeId, nodes).length > 0;
}

/**
 * Get all nodes that collide with a given rectangle
 */
export function getCollidingNodes(
    rect: Rect,
    nodes: LayoutNode[],
    excludeId?: string
): LayoutNode[] {
    return nodes.filter((node) => {
        if (excludeId && node.id === excludeId) return false;
        const nodeRect = getAbsoluteRect(node, nodes);
        return rectOverlaps(rect, nodeRect);
    });
}
