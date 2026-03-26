import type { LayoutNode } from '../types';
import type { Rect, Point, Size, NodeRect } from '../types';

/**
 * Default node sizes by type.
 *
 * Covers both frontend types (action-badge, video-editor, …) and backend
 * types (image_gen, video_gen, …) so the same function works on both sides.
 */
export function getNodeSize(type: string): Size {
    switch (type) {
        case 'group':
            return { width: 400, height: 400 };
        case 'text':
            return { width: 300, height: 400 };
        case 'prompt':
            return { width: 300, height: 150 };
        case 'context':
            return { width: 300, height: 400 };
        case 'image':
        case 'video':
            return { width: 400, height: 400 };
        case 'audio':
            return { width: 300, height: 100 };
        case 'action-badge':
        case 'action-badge-image':
        case 'action-badge-video':
            return { width: 320, height: 220 };
        case 'video-editor':
            return { width: 400, height: 225 };
        // Backend generation types — use the same defaults as their media
        // counterparts since the generated output will be a media node.
        case 'image_gen':
            return { width: 400, height: 400 };
        case 'video_gen':
            return { width: 400, height: 225 };
        default:
            return { width: 300, height: 300 };
    }
}

/**
 * Check if two rectangles overlap
 */
export function rectOverlaps(a: Rect, b: Rect): boolean {
    return !(
        a.x + a.width <= b.x ||
        b.x + b.width <= a.x ||
        a.y + a.height <= b.y ||
        b.y + b.height <= a.y
    );
}

/**
 * Check if rectangle a fully contains rectangle b
 */
export function rectContains(container: Rect, contained: Rect): boolean {
    return (
        contained.x >= container.x &&
        contained.y >= container.y &&
        contained.x + contained.width <= container.x + container.width &&
        contained.y + contained.height <= container.y + container.height
    );
}

/**
 * Check if rectangle contains a point
 */
export function rectContainsPoint(rect: Rect, x: number, y: number): boolean {
    return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/**
 * Normalize dimension value (handle string/number/undefined)
 */
function normalizeDimension(value: unknown): number | undefined {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

/**
 * Get absolute position of a node (accounting for parent hierarchy)
 */
export function getAbsolutePosition(node: LayoutNode, nodes: LayoutNode[]): Point {
    if (!node.parentId) {
        return { x: node.position.x, y: node.position.y };
    }
    const parent = nodes.find((n) => n.id === node.parentId);
    if (!parent) {
        return { x: node.position.x, y: node.position.y };
    }
    const parentAbsPos = getAbsolutePosition(parent, nodes);
    return {
        x: parentAbsPos.x + node.position.x,
        y: parentAbsPos.y + node.position.y,
    };
}

/**
 * Get absolute rectangle for a node.
 *
 * Uses width → style.width → default fallback chain.
 * (The reactflow-specific `measured` branch is intentionally omitted.)
 */
export function getAbsoluteRect(node: LayoutNode, nodes: LayoutNode[]): Rect {
    const absPos = getAbsolutePosition(node, nodes);
    const defaultSize = getNodeSize(node.type || 'default');

    const width =
        normalizeDimension(node.width) ??
        normalizeDimension(node.style?.width) ??
        defaultSize.width;
    const height =
        normalizeDimension(node.height) ??
        normalizeDimension(node.style?.height) ??
        defaultSize.height;

    return {
        x: absPos.x,
        y: absPos.y,
        width,
        height,
    };
}

/**
 * Convert absolute position to relative position within a parent
 */
export function toRelativePosition(absPos: Point, parent: LayoutNode, nodes: LayoutNode[]): Point {
    const parentAbsPos = getAbsolutePosition(parent, nodes);
    return {
        x: absPos.x - parentAbsPos.x,
        y: absPos.y - parentAbsPos.y,
    };
}

/**
 * Expand a rectangle by padding on all sides
 */
export function expandRect(rect: Rect, padding: number): Rect {
    return {
        x: rect.x - padding,
        y: rect.y - padding,
        width: rect.width + padding * 2,
        height: rect.height + padding * 2,
    };
}

/**
 * Get the bounding box that contains all given rectangles
 */
export function rectUnion(rects: Rect[]): Rect | null {
    if (rects.length === 0) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const rect of rects) {
        minX = Math.min(minX, rect.x);
        minY = Math.min(minY, rect.y);
        maxX = Math.max(maxX, rect.x + rect.width);
        maxY = Math.max(maxY, rect.y + rect.height);
    }

    return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
    };
}

/**
 * Calculate the overlap rectangle of two overlapping rectangles
 */
export function getOverlapRect(a: Rect, b: Rect): Rect | null {
    if (!rectOverlaps(a, b)) return null;

    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const right = Math.min(a.x + a.width, b.x + b.width);
    const bottom = Math.min(a.y + a.height, b.y + b.height);

    return {
        x,
        y,
        width: right - x,
        height: bottom - y,
    };
}

/**
 * Convert a LayoutNode to NodeRect for layout calculations
 */
export function nodeToNodeRect(node: LayoutNode, nodes: LayoutNode[]): NodeRect {
    const rect = getAbsoluteRect(node, nodes);
    return {
        ...rect,
        id: node.id,
        type: node.type,
        parentId: node.parentId,
        zIndex: typeof node.style?.zIndex === 'number' ? node.style.zIndex : undefined,
    };
}

/**
 * Get the center point of a rectangle
 */
export function getRectCenter(rect: Rect): Point {
    return {
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
    };
}

/**
 * Calculate distance between two points
 */
export function distance(a: Point, b: Point): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
}
