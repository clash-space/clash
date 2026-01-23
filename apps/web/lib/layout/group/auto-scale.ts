import type { Node } from 'reactflow';
import type { Rect, Size, ScaleResult } from '../types';
import { getAbsolutePosition, getNodeSize } from '../core/geometry';
import { getChildren, getAncestors } from './hierarchy';

const DEFAULT_PADDING = 40;  // Reduced from 60 for more compact groups
const MIN_GROUP_SIZE = { width: 200, height: 200 };

/**
 * Calculate the minimum size needed for a group to contain all its children
 */
export function calculateGroupBounds(
    groupId: string,
    nodes: Node[],
    padding: number = DEFAULT_PADDING
): Size {
    const children = getChildren(groupId, nodes);

    if (children.length === 0) {
        return MIN_GROUP_SIZE;
    }

    let maxRight = 0;
    let maxBottom = 0;

    for (const child of children) {
        const defaultSize = getNodeSize(child.type || 'default');
        const width = child.width || (child.style?.width as number) || defaultSize.width;
        const height = child.height || (child.style?.height as number) || defaultSize.height;

        const right = child.position.x + width;
        const bottom = child.position.y + height;

        if (right > maxRight) maxRight = right;
        if (bottom > maxBottom) maxBottom = bottom;
    }

    return {
        width: Math.max(MIN_GROUP_SIZE.width, maxRight + padding),
        height: Math.max(MIN_GROUP_SIZE.height, maxBottom + padding),
    };
}

/**
 * Check if a group needs to expand to fit its children
 */
export function needsExpansion(group: Node, nodes: Node[], padding: number = DEFAULT_PADDING): boolean {
    const requiredSize = calculateGroupBounds(group.id, nodes, padding);
    const currentWidth = group.width || (group.style?.width as number) || MIN_GROUP_SIZE.width;
    const currentHeight = group.height || (group.style?.height as number) || MIN_GROUP_SIZE.height;

    return requiredSize.width > currentWidth || requiredSize.height > currentHeight;
}

/**
 * Scale a group to fit a specific child node
 * Returns the new size and whether collision resolution is needed
 */
export function scaleGroupToFitChild(
    group: Node,
    childRect: Rect,
    nodes: Node[],
    padding: number = DEFAULT_PADDING
): ScaleResult {
    const groupAbsPos = getAbsolutePosition(group, nodes);
    const currentWidth = group.width || (group.style?.width as number) || MIN_GROUP_SIZE.width;
    const currentHeight = group.height || (group.style?.height as number) || MIN_GROUP_SIZE.height;

    // Child position is relative to group
    const childRelRight = childRect.x - groupAbsPos.x + childRect.width;
    const childRelBottom = childRect.y - groupAbsPos.y + childRect.height;

    const requiredWidth = Math.max(currentWidth, childRelRight + padding);
    const requiredHeight = Math.max(currentHeight, childRelBottom + padding);

    const newSize = {
        width: Math.max(MIN_GROUP_SIZE.width, requiredWidth),
        height: Math.max(MIN_GROUP_SIZE.height, requiredHeight),
    };

    const needsCollisionResolution = newSize.width > currentWidth || newSize.height > currentHeight;

    // Calculate the new affected rect for collision detection
    const affectedRect: Rect = {
        x: groupAbsPos.x,
        y: groupAbsPos.y,
        width: newSize.width,
        height: newSize.height,
    };

    return {
        newSize,
        needsCollisionResolution,
        affectedRect,
    };
}

/**
 * Update a group's size in the nodes array
 */
export function updateGroupSize(nodes: Node[], groupId: string, newSize: Size): Node[] {
    return nodes.map((node) => {
        if (node.id !== groupId) return node;

        return {
            ...node,
            width: newSize.width,
            height: newSize.height,
            style: {
                ...node.style,
                width: newSize.width,
                height: newSize.height,
            },
        };
    });
}

/**
 * Recursively scale all parent groups to fit the given node
 * Returns a map of groupId -> newSize
 */
export function recursiveGroupScale(
    nodeId: string,
    nodes: Node[],
    padding: number = DEFAULT_PADDING
): Map<string, Size> {
    const updates = new Map<string, Size>();
    const ancestors = getAncestors(nodeId, nodes);

    // Process from innermost to outermost
    let currentNodes = nodes;

    for (const ancestorId of ancestors) {
        const ancestor = currentNodes.find((n) => n.id === ancestorId);
        if (!ancestor || ancestor.type !== 'group') continue;

        const requiredSize = calculateGroupBounds(ancestorId, currentNodes, padding);
        const currentWidth = ancestor.width || (ancestor.style?.width as number) || MIN_GROUP_SIZE.width;
        const currentHeight = ancestor.height || (ancestor.style?.height as number) || MIN_GROUP_SIZE.height;

        if (requiredSize.width > currentWidth || requiredSize.height > currentHeight) {
            const newSize = {
                width: Math.max(currentWidth, requiredSize.width),
                height: Math.max(currentHeight, requiredSize.height),
            };
            updates.set(ancestorId, newSize);

            // Update the working copy for next iteration
            currentNodes = updateGroupSize(currentNodes, ancestorId, newSize);
        }
    }

    return updates;
}

/**
 * Apply size updates from recursiveGroupScale to nodes array
 */
export function applyGroupScales(nodes: Node[], scales: Map<string, Size>): Node[] {
    if (scales.size === 0) return nodes;

    return nodes.map((node) => {
        const newSize = scales.get(node.id);
        if (!newSize) return node;

        return {
            ...node,
            width: newSize.width,
            height: newSize.height,
            style: {
                ...node.style,
                width: newSize.width,
                height: newSize.height,
            },
        };
    });
}

/**
 * Auto-scale a group and all its parent groups after a child changes
 * Returns updated nodes array
 */
export function autoScaleGroups(
    changedNodeId: string,
    nodes: Node[],
    padding: number = DEFAULT_PADDING
): Node[] {
    const scales = recursiveGroupScale(changedNodeId, nodes, padding);
    return applyGroupScales(nodes, scales);
}

/**
 * Check if a child is within the group's current bounds
 */
export function isChildWithinBounds(child: Node, group: Node): boolean {
    const groupWidth = group.width || (group.style?.width as number) || MIN_GROUP_SIZE.width;
    const groupHeight = group.height || (group.style?.height as number) || MIN_GROUP_SIZE.height;

    const childSize = getNodeSize(child.type || 'default');
    const childWidth = child.width || (child.style?.width as number) || childSize.width;
    const childHeight = child.height || (child.style?.height as number) || childSize.height;

    const childRight = child.position.x + childWidth;
    const childBottom = child.position.y + childHeight;

    return childRight <= groupWidth && childBottom <= groupHeight && child.position.x >= 0 && child.position.y >= 0;
}

/**
 * Get the groups that need scaling after a node changes position/size
 */
export function getGroupsNeedingScale(nodeId: string, nodes: Node[]): string[] {
    const groupsNeedingScale: string[] = [];
    const ancestors = getAncestors(nodeId, nodes);

    for (const ancestorId of ancestors) {
        const ancestor = nodes.find((n) => n.id === ancestorId);
        if (!ancestor || ancestor.type !== 'group') continue;

        if (needsExpansion(ancestor, nodes)) {
            groupsNeedingScale.push(ancestorId);
        }
    }

    return groupsNeedingScale;
}

/**
 * Shrink groups to tightly fit their children after relayout
 * This removes excess white space while maintaining minimum padding
 *
 * @param nodes - All nodes in the graph
 * @param parentId - Parent scope to process (undefined for root level)
 * @param padding - Padding to maintain around children
 * @returns Updated nodes array with shrunk groups
 */
export function shrinkGroupsToFit(
    nodes: Node[],
    parentId: string | undefined = undefined,
    padding: number = DEFAULT_PADDING
): Node[] {
    // Find all groups in the specified scope
    const groupsInScope = nodes.filter(
        (n) => n.type === 'group' && n.parentId === parentId
    );

    if (groupsInScope.length === 0) {
        return nodes;
    }

    const sizeUpdates = new Map<string, Size>();

    // Calculate optimal size for each group based on its children
    for (const group of groupsInScope) {
        const optimalSize = calculateGroupBounds(group.id, nodes, padding);
        const currentWidth = group.width || (group.style?.width as number) || MIN_GROUP_SIZE.width;
        const currentHeight = group.height || (group.style?.height as number) || MIN_GROUP_SIZE.height;

        // Only shrink if current size is larger than optimal size
        // This prevents unnecessary updates and respects user manual resizing
        const needsShrink = currentWidth > optimalSize.width || currentHeight > optimalSize.height;

        if (needsShrink) {
            sizeUpdates.set(group.id, {
                width: Math.min(currentWidth, optimalSize.width),
                height: Math.min(currentHeight, optimalSize.height),
            });
        }
    }

    return applyGroupScales(nodes, sizeUpdates);
}

/**
 * Recursively shrink all groups in the tree to fit their children
 * Processes from innermost to outermost groups
 *
 * @param nodes - All nodes in the graph
 * @param padding - Padding to maintain around children
 * @returns Updated nodes array with all groups shrunk to fit
 */
export function recursiveShrinkGroups(
    nodes: Node[],
    padding: number = DEFAULT_PADDING
): Node[] {
    let updated = nodes;
    const allGroups = nodes.filter((n) => n.type === 'group');

    if (allGroups.length === 0) {
        return nodes;
    }

    // Process groups from deepest nesting to root
    // This ensures child groups are sized before parent groups
    const groupsByDepth = new Map<number, Node[]>();
    let maxDepth = 0;

    for (const group of allGroups) {
        const depth = getNestingDepth(group.id, nodes);
        const depthGroups = groupsByDepth.get(depth) || [];
        depthGroups.push(group);
        groupsByDepth.set(depth, depthGroups);
        maxDepth = Math.max(maxDepth, depth);
    }

    // Process from deepest to shallowest
    for (let depth = maxDepth; depth >= 0; depth--) {
        const groupsAtDepth = groupsByDepth.get(depth) || [];

        for (const group of groupsAtDepth) {
            const optimalSize = calculateGroupBounds(group.id, updated, padding);
            const currentWidth = group.width || (group.style?.width as number) || MIN_GROUP_SIZE.width;
            const currentHeight = group.height || (group.style?.height as number) || MIN_GROUP_SIZE.height;

            // Only shrink, never expand
            if (currentWidth > optimalSize.width || currentHeight > optimalSize.height) {
                const newSize = {
                    width: Math.min(currentWidth, optimalSize.width),
                    height: Math.min(currentHeight, optimalSize.height),
                };
                updated = updateGroupSize(updated, group.id, newSize);
            }
        }
    }

    return updated;
}
