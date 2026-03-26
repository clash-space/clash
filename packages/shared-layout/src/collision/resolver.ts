import type { LayoutNode } from '../types';
import type { Rect, Point, ResolutionResult } from '../types';
import { getAbsoluteRect, getAbsolutePosition, rectOverlaps } from '../core/geometry';
import { Mesh } from '../core/mesh';
import { detectCollisionsForNode } from './detector';
import { getSiblings } from '../group/hierarchy';

interface ResolverOptions {
    maxIterations?: number;
    padding?: number;
    preferHorizontal?: boolean;
}

const DEFAULT_OPTIONS: Required<ResolverOptions> = {
    maxIterations: 10,
    padding: 20,
    preferHorizontal: true,
};

/**
 * Resolve collision for a single node
 */
function resolveNodeCollision(
    nodeId: string,
    workingPositions: Map<string, Point>,
    nodes: LayoutNode[],
    mesh: Mesh,
    _options: Required<ResolverOptions>
): { nodeId: string; newPosition: Point; causedBy: string } | null {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return null;

    const currentPos = workingPositions.get(nodeId) || node.position;
    const nodeSize = getAbsoluteRect(node, nodes);

    const siblings = getSiblings(nodeId, nodes);

    const occupiedRects: Rect[] = siblings
        .filter((s) => s.id !== nodeId)
        .map((s) => {
            const sibPos = workingPositions.get(s.id) || s.position;
            const sibRect = getAbsoluteRect(s, nodes);
            const parentAbsPos = node.parentId
                ? getAbsolutePosition(nodes.find((n) => n.id === node.parentId)!, nodes)
                : { x: 0, y: 0 };
            return {
                x: parentAbsPos.x + sibPos.x,
                y: parentAbsPos.y + sibPos.y,
                width: sibRect.width,
                height: sibRect.height,
            };
        });

    const parentAbsPos = node.parentId
        ? getAbsolutePosition(nodes.find((n) => n.id === node.parentId)!, nodes)
        : { x: 0, y: 0 };

    const currentAbsPos = {
        x: parentAbsPos.x + currentPos.x,
        y: parentAbsPos.y + currentPos.y,
    };

    const currentRect: Rect = {
        ...currentAbsPos,
        width: nodeSize.width,
        height: nodeSize.height,
    };

    const hasCollision = occupiedRects.some((occ) => rectOverlaps(currentRect, occ));
    if (!hasCollision) return null;

    const newAbsPos = mesh.findNonOverlappingPosition(
        currentAbsPos,
        { width: nodeSize.width, height: nodeSize.height },
        occupiedRects
    );

    const newRelPos = {
        x: newAbsPos.x - parentAbsPos.x,
        y: newAbsPos.y - parentAbsPos.y,
    };

    return {
        nodeId,
        newPosition: newRelPos,
        causedBy: 'collision',
    };
}

/**
 * Resolve all collisions with chain reaction support
 */
export function resolveCollisions(
    nodes: LayoutNode[],
    triggerNodeId: string,
    mesh: Mesh,
    options: ResolverOptions = {}
): ResolutionResult {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const steps: { nodeId: string; newPosition: Point; causedBy: string }[] = [];
    const workingPositions = new Map<string, Point>();

    for (const node of nodes) {
        workingPositions.set(node.id, { ...node.position });
    }

    const processedInIteration = new Set<string>();
    let iterations = 0;
    let converged = false;

    let nodesToCheck = new Set<string>([triggerNodeId]);

    while (iterations < opts.maxIterations && nodesToCheck.size > 0) {
        iterations++;
        processedInIteration.clear();

        const nextNodesToCheck = new Set<string>();

        for (const nodeId of nodesToCheck) {
            if (processedInIteration.has(nodeId)) continue;
            processedInIteration.add(nodeId);

            const tempNodes = nodes.map((n) => {
                const pos = workingPositions.get(n.id);
                return pos ? { ...n, position: pos } : n;
            });

            const collisions = detectCollisionsForNode(nodeId, tempNodes);

            for (const collision of collisions) {
                const pushedNodeId = collision.nodeA === nodeId ? collision.nodeB : collision.nodeA;

                if (processedInIteration.has(pushedNodeId)) continue;

                const step = resolveNodeCollision(pushedNodeId, workingPositions, tempNodes, mesh, opts);

                if (step) {
                    steps.push({
                        ...step,
                        causedBy: nodeId,
                    });
                    workingPositions.set(pushedNodeId, step.newPosition);

                    nextNodesToCheck.add(pushedNodeId);
                }
            }
        }

        nodesToCheck = nextNodesToCheck;

        if (nodesToCheck.size === 0) {
            converged = true;
        }
    }

    return {
        steps,
        iterations,
        converged,
    };
}

/**
 * Apply resolution steps to a nodes array
 */
export function applyResolution(nodes: LayoutNode[], result: ResolutionResult): LayoutNode[] {
    if (result.steps.length === 0) return nodes;

    const positionUpdates = new Map<string, Point>();
    for (const step of result.steps) {
        positionUpdates.set(step.nodeId, step.newPosition);
    }

    return nodes.map((node) => {
        const newPos = positionUpdates.get(node.id);
        if (newPos) {
            return { ...node, position: newPos };
        }
        return node;
    });
}

/**
 * Resolve collisions caused by a node expansion
 */
export function resolveExpansionCollisions(
    expandedNodeId: string,
    nodes: LayoutNode[],
    mesh: Mesh,
    options: ResolverOptions = {}
): ResolutionResult {
    return resolveCollisions(nodes, expandedNodeId, mesh, options);
}

/**
 * Push a single node to avoid collision with an obstacle
 */
export function pushNodeAway(
    pushedNode: LayoutNode,
    obstacleRect: Rect,
    nodes: LayoutNode[],
    mesh: Mesh
): Point {
    const pushedRect = getAbsoluteRect(pushedNode, nodes);
    const pushVector = mesh.calculatePushVector(pushedRect, obstacleRect);

    const parentAbsPos = pushedNode.parentId
        ? getAbsolutePosition(nodes.find((n) => n.id === pushedNode.parentId)!, nodes)
        : { x: 0, y: 0 };

    const newAbsPos = {
        x: pushedRect.x + pushVector.dx,
        y: pushedRect.y + pushVector.dy,
    };

    const snappedAbsPos = mesh.snapToGrid(newAbsPos);

    return {
        x: snappedAbsPos.x - parentAbsPos.x,
        y: snappedAbsPos.y - parentAbsPos.y,
    };
}

/**
 * Simple collision resolution
 */
export function simpleResolve(
    nodes: LayoutNode[],
    changedNodeId: string,
    mesh: Mesh
): LayoutNode[] {
    const result = resolveCollisions(nodes, changedNodeId, mesh);
    return applyResolution(nodes, result);
}
