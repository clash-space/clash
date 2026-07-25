import { describe, expect, it } from 'vitest';
import {
  TimelineRuler,
  clampTimelineZoom,
  fitTimelineZoom,
  formatTime,
  frameToPixels,
} from './index';

describe('public timing primitives', () => {
  it('exposes the reusable ruler, zoom, time, and geometry surface', () => {
    expect(TimelineRuler).toBeTypeOf('function');
    expect(clampTimelineZoom(4, 0.1, 2)).toBe(2);
    expect(fitTimelineZoom({
      contentEndInFrames: 300,
      viewportWidth: 600,
      min: 0.1,
      max: 4,
    })).toBeGreaterThan(0.1);
    expect(formatTime(31, 30)).toBe('00:01:01');
    expect(frameToPixels(10, 2)).toBe(20);
  });
});
