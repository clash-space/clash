import type { LayoutNode } from '../types';
import type { Rect, Point, OwnershipResult } from '../types';
import { rectContains, getAbsoluteRect, getAbsolutePosition } from '../core/geometry';
import { getNestingDepth, isDescendant, getGroupNodes } from './hierarchy';

/**
 * Determine which group (if any) should own a node based on FULL CONTAINMENT.
 */
export function determineGroupOwnership(
    nodeAbsRect: Rect,
    nodeId: string,
    nodes: LayoutNode[]
): OwnershipResult {
    const groupNodes = getGroupNodes(nodes).filter((g) => g.id !== nodeId);

    let best:
        | {
              id: string;
              zIndex: number;
              depth: number;
          }
        | undefined;

    for (const group of groupNodes) {
        if (isDescendant(group.id, nodeId, nodes)) continue;

        const groupAbsRect = getAbsoluteRect(group, nodes);
        if (!rectContains(groupAbsRect, nodeAbsRect)) continue;

        const zIndexRaw = group.style?.zIndex;
        const zIndex =
            typeof zIndexRaw === 'number'
                ? zIndexRaw
                : typeof zIndexRaw === 'string'
                  ? Number.parseFloat(zIndexRaw) || 0
                  : 0;
        const depth = getNestingDepth(group.id, nodes);

        if (!best) {
            best = { id: group.id, zIndex, depth };
            continue;
        }

        if (zIndex > best.zIndex) {
            best = { id: group.id, zIndex, depth };
            continue;
        }

        if (zIndex === best.zIndex && depth > best.depth) {
            best = { id: group.id, zIndex, depth };
            continue;
        }

        if (zIndex === best.zIndex && depth === best.depth && group.id > best.id) {
            best = { id: group.id, zIndex, depth };
        }
    }

    const newParentId = best?.id;

    let relativePosition: Point = { x: nodeAbsRect.x, y: nodeAbsRect.y };

    if (newParentId) {
        const parentGroup = nodes.find((n) => n.id === newParentId);
        if (parentGroup) {
            const parentAbsPos = getAbsolutePosition(parentGroup, nodes);
            relativePosition = {
                x: nodeAbsRect.x - parentAbsPos.x,
                y: nodeAbsRect.y - parentAbsPos.y,
            };
        }
    }

    return {
        newParentId,
        relativePosition,
    };
}

/**
 * Check if a node's ownership has changed after a drag operation
 */
export function checkOwnershipChange(
    node: LayoutNode,
    nodes: LayoutNode[]
): { hasChanged: boolean; ownership: OwnershipResult } {
    const nodeAbsRect = getAbsoluteRect(node, nodes);
    const ownership = determineGroupOwnership(nodeAbsRect, node.id, nodes);

    return {
        hasChanged: ownership.newParentId !== node.parentId,
        ownership,
    };
}

/**
 * Update a node's parent and position based on ownership result
 */
export function applyOwnership(node: LayoutNode, ownership: OwnershipResult): LayoutNode {
    return {
        ...node,
        parentId: ownership.newParentId,
        position: ownership.relativePosition,
    };
}

/**
 * Update nodes array with new ownership for a specific node
 */
export function updateNodeOwnership(
    nodes: LayoutNode[],
    nodeId: string,
    ownership: OwnershipResult
): LayoutNode[] {
    return nodes.map((n) => {
        if (n.id !== nodeId) return n;

        if (n.type === 'group' && ownership.newParentId) {
            const parentGroup = nodes.find((p) => p.id === ownership.newParentId);
            const parentZIndex = typeof parentGroup?.style?.zIndex === 'number' ? parentGroup.style.zIndex : 0;

            return {
                ...n,
                parentId: ownership.newParentId,
                position: ownership.relativePosition,
                style: {
                    ...n.style,
                    zIndex: (parentZIndex as number) + 1,
                },
            };
        }

        return applyOwnership(n, ownership);
    });
}

/**
 * Remove a node from its parent group (move to root level)
 */
export function removeFromGroup(node: LayoutNode, nodes: LayoutNode[]): LayoutNode {
    if (!node.parentId) return node;

    const absPos = getAbsolutePosition(node, nodes);

    return {
        ...node,
        parentId: undefined,
        position: absPos,
    };
}

/**
 * Move a node into a specific group
 */
export function moveIntoGroup(node: LayoutNode, groupId: string, nodes: LayoutNode[]): LayoutNode {
    const group = nodes.find((n) => n.id === groupId);
    if (!group || group.type !== 'group') return node;

    const nodeAbsPos = getAbsolutePosition(node, nodes);
    const groupAbsPos = getAbsolutePosition(group, nodes);

    const relativePos = {
        x: nodeAbsPos.x - groupAbsPos.x,
        y: nodeAbsPos.y - groupAbsPos.y,
    };

    return {
        ...node,
        parentId: groupId,
        position: relativePos,
    };
}
