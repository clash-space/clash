import { describe, expect, it } from 'vitest';
import * as minimap from './minimap';

const { calculateMinimapViewport, panFromMinimapPoint } = minimap;

const viewport = {
  canvasWidth: 1000,
  canvasHeight: 500,
  viewportWidth: 1000,
  viewportHeight: 500,
};

describe('canvas minimap geometry', () => {
  it('stays hidden until the canvas is meaningfully zoomed in', () => {
    const shouldShow = (minimap as typeof minimap & {
      shouldShowCanvasMinimap?: (zoom: number) => boolean;
    }).shouldShowCanvasMinimap;

    expect(shouldShow?.(1)).toBe(false);
    expect(shouldShow?.(1.149)).toBe(false);
    expect(shouldShow?.(1.15)).toBe(true);
  });

  it('covers the whole map when the fitted canvas is at 100%', () => {
    expect(calculateMinimapViewport({
      ...viewport,
      zoom: 1,
      panX: 0,
      panY: 0,
    })).toEqual({ left: 0, top: 0, width: 1, height: 1 });
  });

  it('shows the visible region and follows canvas panning', () => {
    expect(calculateMinimapViewport({
      ...viewport,
      zoom: 2,
      panX: 250,
      panY: 0,
    })).toEqual({ left: 0.125, top: 0.25, width: 0.5, height: 0.5 });
  });

  it('converts a minimap drag to a clamped canvas pan', () => {
    expect(panFromMinimapPoint({
      ...viewport,
      zoom: 2,
      pointX: 0.75,
      pointY: 0.5,
    })).toEqual({ x: -500, y: 0 });
  });
});
