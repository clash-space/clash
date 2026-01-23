import type { Node } from 'reactflow';
import type { Rect, Point, Size, NodeRect } from '../types';

/**
 * Default node sizes by type
 */
export function getNodeSize(type: string): Size {
    switch (type) {
        case 'group':
            return { width: 400, height: 400 };
        case 'text':
            // Text nodes are rendered at fixed 300x400 in TextNode.tsx
            return { width: 300, height: 400 };
        case 'prompt':
            return { width: 300, height: 150 };
        case 'context':
            return { width: 300, height: 400 };
        case 'image':
        case 'video':
            // Default size closer to actual loaded size (MAX_MEDIA_DIMENSION = 500)
            // Most images will be around 400-500px after loading
            return { width: 400, height: 400 };
        case 'audio':
            return { width: 300, height: 100 };
        case 'action-badge':
            return { width: 320, height: 220 };
        case 'video-editor':
            // VideoEditorNode renders with min-w-[400px] max-w-[600px] and aspect-video
            // Using 400px width (min width) and ~225px height (16:9 aspect ratio)
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
 * This is the key function for group ownership detection
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
export function getAbsolutePosition(node: Node, nodes: Node[]): Point {
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
 * Get absolute rectangle for a node
 */
export function getAbsoluteRect(node: Node, nodes: Node[]): Rect {
    const absPos = getAbsolutePosition(node, nodes);
    const defaultSize = getNodeSize(node.type || 'default');

    // React Flow stores measured dimensions in node.measured (v11+)
    // Also check node.width/height and node.style for fallbacks
    const measured = (node as any).measured;
    const width =
        normalizeDimension(measured?.width) ??
        normalizeDimension(node.width) ??
        normalizeDimension(node.style?.width) ??
        defaultSize.width;
    const height =
        normalizeDimension(measured?.height) ??
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
export function toRelativePosition(absPos: Point, parent: Node, nodes: Node[]): Point {
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
 * Convert a Node to NodeRect for layout calculations
 */
export function nodeToNodeRect(node: Node, nodes: Node[]): NodeRect {
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
