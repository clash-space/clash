import type { Rect, Point, Size, MeshConfig, MeshCell } from '../types';
import { rectOverlaps } from './geometry';

const DEFAULT_CONFIG: MeshConfig = {
    cellWidth: 50,
    cellHeight: 50,
    maxColumns: 10,
    padding: 20,
};

/**
 * Mesh/Grid system for predictable node positioning
 * Provides grid-aligned placement with horizontal-first expansion
 */
export class Mesh {
    private config: MeshConfig;

    constructor(config: Partial<MeshConfig> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * Snap a position to the nearest grid cell corner
     */
    snapToGrid(pos: Point): Point {
        return {
            x: Math.round(pos.x / this.config.cellWidth) * this.config.cellWidth,
            y: Math.round(pos.y / this.config.cellHeight) * this.config.cellHeight,
        };
    }

    /**
     * Convert a position to mesh cell coordinates
     */
    positionToCell(pos: Point): MeshCell {
        return {
            col: Math.floor(pos.x / this.config.cellWidth),
            row: Math.floor(pos.y / this.config.cellHeight),
        };
    }

    /**
     * Convert mesh cell to absolute position
     */
    cellToPosition(cell: MeshCell): Point {
        return {
            x: cell.col * this.config.cellWidth,
            y: cell.row * this.config.cellHeight,
        };
    }

    /**
     * Get all cells occupied by a rectangle
     */
    getOccupiedCells(rect: Rect): MeshCell[] {
        const startCol = Math.floor(rect.x / this.config.cellWidth);
        const startRow = Math.floor(rect.y / this.config.cellHeight);
        const endCol = Math.ceil((rect.x + rect.width) / this.config.cellWidth);
        const endRow = Math.ceil((rect.y + rect.height) / this.config.cellHeight);

        const cells: MeshCell[] = [];
        for (let row = startRow; row < endRow; row++) {
            for (let col = startCol; col < endCol; col++) {
                cells.push({ row, col });
            }
        }
        return cells;
    }

    /**
     * Calculate how many grid cells a size occupies
     */
    sizeToCells(size: Size): { cols: number; rows: number } {
        return {
            cols: Math.ceil(size.width / this.config.cellWidth),
            rows: Math.ceil(size.height / this.config.cellHeight),
        };
    }

    /**
     * Find the next available cell starting from a position
     */
    findNextAvailablePosition(
        startPos: Point,
        nodeSize: Size,
        occupiedRects: Rect[],
        maxAttempts: number = 100
    ): Point {
        const startCell = this.positionToCell(startPos);
        const nodeCells = this.sizeToCells(nodeSize);

        const baseCol = Math.max(0, startCell.col);
        let currentRow = Math.max(0, startCell.row);
        let currentCol = baseCol;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const testPos = this.cellToPosition({ row: currentRow, col: currentCol });
            const testRect: Rect = {
                x: testPos.x,
                y: testPos.y,
                width: nodeSize.width,
                height: nodeSize.height,
            };

            const hasOverlap = occupiedRects.some((occupied) => rectOverlaps(testRect, occupied));

            if (!hasOverlap) {
                return testPos;
            }

            currentCol++;

            if (currentCol - baseCol >= this.config.maxColumns) {
                currentCol = baseCol;
                currentRow += nodeCells.rows;
            }
        }

        return {
            x: startPos.x,
            y: startPos.y + (maxAttempts / this.config.maxColumns) * this.config.cellHeight + 200,
        };
    }

    /**
     * Find non-overlapping position with grid snapping
     */
    findNonOverlappingPosition(
        targetPos: Point,
        nodeSize: Size,
        existingRects: Rect[],
        options: {
            snapToGrid?: boolean;
            maxAttempts?: number;
        } = {}
    ): Point {
        const { snapToGrid = true, maxAttempts = 100 } = options;

        const startPos = snapToGrid ? this.snapToGrid(targetPos) : targetPos;
        return this.findNextAvailablePosition(startPos, nodeSize, existingRects, maxAttempts);
    }

    /**
     * Calculate the push direction and distance to resolve a collision
     */
    calculatePushVector(
        pushedRect: Rect,
        obstacleRect: Rect
    ): { dx: number; dy: number; direction: 'right' | 'down' | 'left' | 'up' } {
        const overlapRight = obstacleRect.x + obstacleRect.width - pushedRect.x;
        const overlapDown = obstacleRect.y + obstacleRect.height - pushedRect.y;

        const pushRight = overlapRight + this.config.padding;
        const pushDown = overlapDown + this.config.padding;

        if (pushRight > 0 && pushRight <= pushDown * 1.5) {
            const snappedDx = Math.ceil(pushRight / this.config.cellWidth) * this.config.cellWidth;
            return { dx: snappedDx, dy: 0, direction: 'right' };
        }

        if (pushDown > 0) {
            const snappedDy = Math.ceil(pushDown / this.config.cellHeight) * this.config.cellHeight;
            return { dx: 0, dy: snappedDy, direction: 'down' };
        }

        if (pushRight > 0) {
            const snappedDx = Math.ceil(pushRight / this.config.cellWidth) * this.config.cellWidth;
            return { dx: snappedDx, dy: 0, direction: 'right' };
        }

        return { dx: this.config.cellWidth, dy: 0, direction: 'right' };
    }

    /**
     * Get the mesh configuration
     */
    getConfig(): MeshConfig {
        return { ...this.config };
    }
}

/**
 * Create a default mesh instance
 */
export function createMesh(config?: Partial<MeshConfig>): Mesh {
    return new Mesh(config);
}
