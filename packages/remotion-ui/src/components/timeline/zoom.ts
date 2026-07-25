const SLIDER_MIN = 0;
const SLIDER_MAX = 100;

export function clampTimelineZoom(zoom: number, min: number, max: number): number {
  if (!Number.isFinite(zoom)) return min;
  return Math.min(max, Math.max(min, zoom));
}

export function zoomToSliderValue(zoom: number, min: number, max: number): number {
  const safeZoom = clampTimelineZoom(zoom, min, max);
  return (Math.log(safeZoom / min) / Math.log(max / min)) * SLIDER_MAX;
}

export function sliderValueToZoom(value: number, min: number, max: number): number {
  const normalized = (Math.min(SLIDER_MAX, Math.max(SLIDER_MIN, value)) - SLIDER_MIN)
    / (SLIDER_MAX - SLIDER_MIN);
  return clampTimelineZoom(min * Math.pow(max / min, normalized), min, max);
}

export function stepTimelineZoom(
  zoom: number,
  direction: 'in' | 'out',
  min: number,
  max: number,
): number {
  const factor = direction === 'in' ? 1.25 : 0.8;
  return clampTimelineZoom(zoom * factor, min, max);
}

export function fitTimelineZoom({
  contentEndInFrames,
  viewportWidth,
  min,
  max,
  basePixelsPerFrame = 2,
}: {
  contentEndInFrames: number;
  viewportWidth: number;
  min: number;
  max: number;
  basePixelsPerFrame?: number;
}): number {
  if (contentEndInFrames <= 0 || viewportWidth <= 0) return clampTimelineZoom(1, min, max);
  const usableWidth = Math.max(1, viewportWidth - 32);
  const framesWithHeadroom = contentEndInFrames * 1.08;
  return clampTimelineZoom(
    usableWidth / (framesWithHeadroom * basePixelsPerFrame),
    min,
    max,
  );
}

export function anchoredTimelineScrollLeft({
  scrollLeft,
  anchorOffset,
  contentInset,
  oldPixelsPerFrame,
  newPixelsPerFrame,
  maxScrollLeft,
}: {
  scrollLeft: number;
  anchorOffset: number;
  contentInset: number;
  oldPixelsPerFrame: number;
  newPixelsPerFrame: number;
  maxScrollLeft: number;
}): number {
  const anchorFrame = Math.max(
    0,
    (scrollLeft + anchorOffset - contentInset) / oldPixelsPerFrame,
  );
  const next = anchorFrame * newPixelsPerFrame - anchorOffset + contentInset;
  return Math.min(maxScrollLeft, Math.max(0, next));
}
