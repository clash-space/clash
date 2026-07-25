export interface CanvasAnnotationScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CanvasAnnotationFlowRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CanvasAnnotationViewport {
  x: number;
  y: number;
  zoom: number;
}

/**
 * Converts a target's DOM edge into React Flow graph coordinates. The caller
 * renders those coordinates in a ViewportPortal, so pan and zoom are applied
 * exactly once by React Flow rather than by the outer workspace layout.
 */
export function projectCanvasAnnotationPin({
  targetRect,
  flowRect,
  viewport,
}: {
  targetRect: CanvasAnnotationScreenRect;
  flowRect: CanvasAnnotationFlowRect;
  viewport: CanvasAnnotationViewport;
}): { x: number; y: number; screenX: number; screenY: number } {
  const zoom = Math.max(viewport.zoom, Number.EPSILON);
  const screenX = targetRect.right - flowRect.left;
  const screenY = targetRect.top - flowRect.top;
  return {
    x: (screenX - viewport.x) / zoom,
    y: (screenY - viewport.y) / zoom,
    screenX,
    screenY,
  };
}
