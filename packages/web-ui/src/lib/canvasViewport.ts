export type CanvasRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MinimapSize = {
  width: number;
  height: number;
};

export type PointerSample = {
  x: number;
  y: number;
  time: number;
};

export const DEFAULT_MINIMAP_SIZE: MinimapSize = { width: 160, height: 112 };
export const MIN_EXPANDED_MINIMAP_SIZE: MinimapSize = {
  width: 128,
  height: 88,
};
export const COLLAPSED_MINIMAP_SIZE: MinimapSize = { width: 36, height: 36 };
export const MAX_MINIMAP_SIZE: MinimapSize = { width: 360, height: 252 };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

export function isImplicitCanvasRoot(name: string): boolean {
  return name.trim().toLocaleLowerCase() === "main";
}

export function averageRectCenters(
  rects: CanvasRect[],
): { x: number; y: number } | null {
  if (rects.length === 0) return null;
  const total = rects.reduce(
    (sum, rect) => ({
      x: sum.x + rect.x + rect.width / 2,
      y: sum.y + rect.y + rect.height / 2,
    }),
    { x: 0, y: 0 },
  );
  return { x: total.x / rects.length, y: total.y / rects.length };
}

export function resizeMinimapFromTopRight(
  start: MinimapSize,
  delta: { deltaX: number; deltaY: number },
): MinimapSize {
  return {
    width: clamp(
      start.width + delta.deltaX,
      MIN_EXPANDED_MINIMAP_SIZE.width,
      MAX_MINIMAP_SIZE.width,
    ),
    height: clamp(
      start.height - delta.deltaY,
      MIN_EXPANDED_MINIMAP_SIZE.height,
      MAX_MINIMAP_SIZE.height,
    ),
  };
}

export function shouldCollapseMinimap(size: MinimapSize): boolean {
  return (
    size.width <= MIN_EXPANDED_MINIMAP_SIZE.width &&
    size.height <= MIN_EXPANDED_MINIMAP_SIZE.height
  );
}

export function collapseVelocityFromPointer(
  previous: PointerSample,
  current: PointerSample,
): number {
  const elapsedSeconds = Math.max(1, current.time - previous.time) / 1000;
  const horizontalShrink = Math.max(0, previous.x - current.x) / elapsedSeconds;
  const verticalShrink = Math.max(0, current.y - previous.y) / elapsedSeconds;
  return Math.min(1800, (horizontalShrink + verticalShrink) / 2);
}

export function isExpandedMinimapSize(size: MinimapSize): boolean {
  return (
    size.width >= MIN_EXPANDED_MINIMAP_SIZE.width &&
    size.height >= MIN_EXPANDED_MINIMAP_SIZE.height
  );
}
