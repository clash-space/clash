type CanvasViewportGeometry = {
  canvasWidth: number;
  canvasHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  zoom: number;
};

export const CANVAS_MINIMAP_ZOOM_THRESHOLD = 1.15;

export function shouldShowCanvasMinimap(zoom: number): boolean {
  return zoom >= CANVAS_MINIMAP_ZOOM_THRESHOLD;
}

type MinimapViewportInput = CanvasViewportGeometry & {
  panX: number;
  panY: number;
};

type MinimapPointInput = CanvasViewportGeometry & {
  pointX: number;
  pointY: number;
};

export type NormalizedMinimapViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

const clamp = (value: number, min: number, max: number) => (
  Math.min(Math.max(value, min), max)
);

export function calculateMinimapViewport({
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  zoom,
  panX,
  panY,
}: MinimapViewportInput): NormalizedMinimapViewport {
  const safeCanvasWidth = Math.max(1, canvasWidth);
  const safeCanvasHeight = Math.max(1, canvasHeight);
  const safeZoom = Math.max(0.0001, zoom);
  const scaledWidth = safeCanvasWidth * safeZoom;
  const scaledHeight = safeCanvasHeight * safeZoom;
  const width = clamp(viewportWidth / scaledWidth, 0, 1);
  const height = clamp(viewportHeight / scaledHeight, 0, 1);
  const centerX = 0.5 - panX / scaledWidth;
  const centerY = 0.5 - panY / scaledHeight;

  return {
    left: clamp(centerX - width / 2, 0, 1 - width),
    top: clamp(centerY - height / 2, 0, 1 - height),
    width,
    height,
  };
}

export function panFromMinimapPoint({
  canvasWidth,
  canvasHeight,
  viewportWidth,
  viewportHeight,
  zoom,
  pointX,
  pointY,
}: MinimapPointInput): { x: number; y: number } {
  const safeCanvasWidth = Math.max(1, canvasWidth);
  const safeCanvasHeight = Math.max(1, canvasHeight);
  const safeZoom = Math.max(0.0001, zoom);
  const scaledWidth = safeCanvasWidth * safeZoom;
  const scaledHeight = safeCanvasHeight * safeZoom;
  const maxPanX = Math.max(0, (scaledWidth - viewportWidth) / 2);
  const maxPanY = Math.max(0, (scaledHeight - viewportHeight) / 2);

  return {
    x: clamp((0.5 - clamp(pointX, 0, 1)) * scaledWidth, -maxPanX, maxPanX),
    y: clamp((0.5 - clamp(pointY, 0, 1)) * scaledHeight, -maxPanY, maxPanY),
  };
}
