/**
 * Shared layout types — zero dependency on reactflow.
 *
 * reactflow's `Node` is a structural superset of `LayoutNode`, so frontend
 * code can pass `Node[]` to any function that accepts `LayoutNode[]` without
 * an adapter thanks to TypeScript's structural typing.
 */

export interface LayoutNode {
    id: string;
    type?: string;
    position: { x: number; y: number };
    parentId?: string;
    width?: number | null;
    height?: number | null;
    /** Node data. Uses `any` so reactflow's `Node<T>` (where data is `T`) is assignable. */
    data: Record<string, any>;
    style?: { width?: number | string; height?: number | string; zIndex?: number | string };
}

export interface LayoutEdge {
    source: string;
    target: string;
}

// Basic geometry types
export interface Point {
    x: number;
    y: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface Rect extends Point, Size {}

export interface NodeRect extends Rect {
    id: string;
    type?: string;
    parentId?: string;
    zIndex?: number;
}

// Mesh configuration
export interface MeshConfig {
    cellWidth: number;
    cellHeight: number;
    maxColumns: number;
    padding: number;
}

export interface MeshCell {
    row: number;
    col: number;
}

// Group ownership
export interface OwnershipResult {
    newParentId: string | undefined;
    relativePosition: Point;
}

// Collision types
export interface CollisionInfo {
    nodeA: string;
    nodeB: string;
    overlapRect: Rect;
    overlapArea: number;
    pushDirection: 'right' | 'down' | 'left' | 'up';
    pushDistance: number;
}

export interface ResolutionStep {
    nodeId: string;
    newPosition: Point;
    newSize?: Size;
    causedBy: string;
}

export interface ResolutionResult {
    steps: ResolutionStep[];
    iterations: number;
    converged: boolean;
}

// Scale types
export interface ScaleResult {
    newSize: Size;
    needsCollisionResolution: boolean;
    affectedRect: Rect;
}
