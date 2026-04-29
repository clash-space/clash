import { describe, it, expect } from 'vitest';
import { computeFadeMultiplier, computeColorOverlayOpacity } from './VideoComposition';

describe('computeFadeMultiplier', () => {
  it('returns 1 with no fades configured', () => {
    expect(computeFadeMultiplier(50, 0, 100, 0, 0)).toBe(1);
  });

  it('ramps 0 → 1 across the fade-in window', () => {
    expect(computeFadeMultiplier(0, 0, 100, 30, 0)).toBe(0);
    expect(computeFadeMultiplier(15, 0, 100, 30, 0)).toBeCloseTo(0.5, 5);
    expect(computeFadeMultiplier(30, 0, 100, 30, 0)).toBe(1);
    expect(computeFadeMultiplier(50, 0, 100, 30, 0)).toBe(1);
  });

  it('ramps 1 → 0 across the fade-out window', () => {
    expect(computeFadeMultiplier(50, 0, 100, 0, 30)).toBe(1);
    expect(computeFadeMultiplier(70, 0, 100, 0, 30)).toBe(1);
    expect(computeFadeMultiplier(85, 0, 100, 0, 30)).toBeCloseTo(0.5, 5);
    expect(computeFadeMultiplier(100, 0, 100, 0, 30)).toBe(0);
  });

  it('clamps before visibleFrom and after endFrame', () => {
    expect(computeFadeMultiplier(-5, 0, 100, 30, 30)).toBe(0);
    expect(computeFadeMultiplier(120, 0, 100, 30, 30)).toBe(0);
  });

  it('takes the min when fade-in and fade-out windows would coexist', () => {
    // 20-frame item with 15 fade-in + 15 fade-out — the fades overlap. At
    // frame 10, fade-in is 0.667, fade-out is also ~0.667; min wins.
    const v = computeFadeMultiplier(10, 0, 20, 15, 15);
    expect(v).toBeCloseTo(2 / 3, 2);
    expect(v).toBeLessThanOrEqual(2 / 3 + 0.01);
  });

  it('respects a non-zero visibleFrom', () => {
    // Sequence-relative: video item starts being visible at frame 5
    expect(computeFadeMultiplier(5, 5, 100, 10, 0)).toBe(0);
    expect(computeFadeMultiplier(15, 5, 100, 10, 0)).toBe(1);
  });
});

describe('computeColorOverlayOpacity', () => {
  it('returns 0 when no color overlay is requested', () => {
    expect(computeColorOverlayOpacity(0, 0, 100, 30, 30, false, false)).toBe(0);
    expect(computeColorOverlayOpacity(50, 0, 100, 30, 30, false, false)).toBe(0);
    expect(computeColorOverlayOpacity(99, 0, 100, 30, 30, false, false)).toBe(0);
  });

  it('fade-in color: overlay 1 → 0 across fade-in window', () => {
    expect(computeColorOverlayOpacity(0, 0, 100, 30, 0, true, false)).toBe(1);
    expect(computeColorOverlayOpacity(15, 0, 100, 30, 0, true, false)).toBeCloseTo(0.5, 5);
    expect(computeColorOverlayOpacity(30, 0, 100, 30, 0, true, false)).toBe(0);
    expect(computeColorOverlayOpacity(50, 0, 100, 30, 0, true, false)).toBe(0);
  });

  it('fade-out color: overlay 0 → 1 across fade-out window', () => {
    expect(computeColorOverlayOpacity(50, 0, 100, 0, 30, false, true)).toBe(0);
    expect(computeColorOverlayOpacity(85, 0, 100, 0, 30, false, true)).toBeCloseTo(0.5, 5);
    expect(computeColorOverlayOpacity(100, 0, 100, 0, 30, false, true)).toBe(1);
  });

  it('takes the max when both fade-in and fade-out colors are active', () => {
    // Tiny 10-frame item with fade-in color + fade-out color. At frame 5 (mid),
    // both contributions are ~0; max stays at 0. At frame 0, fade-in color is 1.
    expect(computeColorOverlayOpacity(0, 0, 10, 5, 5, true, true)).toBe(1);
    expect(computeColorOverlayOpacity(10, 0, 10, 5, 5, true, true)).toBe(1);
    expect(computeColorOverlayOpacity(5, 0, 10, 5, 5, true, true)).toBe(0);
  });
});

describe('fade edge cases', () => {
  it('treats negative fade lengths as "no fade"', () => {
    expect(computeFadeMultiplier(0, 0, 100, -10, 0)).toBe(1);
    expect(computeFadeMultiplier(99, 0, 100, 0, -10)).toBe(1);
  });

  it('handles fadeInFrames longer than the item: opacity never reaches 1', () => {
    // 30-frame item with 60-frame fade-in: at the last frame, opacity is ~30/60 = 0.5.
    expect(computeFadeMultiplier(29, 0, 30, 60, 0)).toBeCloseTo(29 / 60, 5);
  });

  it('handles fadeOutFrames longer than the item: opacity never reaches 1', () => {
    // 30-frame item with 60-frame fade-out: at the first frame, opacity is ~30/60 = 0.5.
    expect(computeFadeMultiplier(0, 0, 30, 0, 60)).toBeCloseTo(0.5, 5);
  });

  it('frame exactly at visibleFrom is fully transparent under fade-in', () => {
    expect(computeFadeMultiplier(0, 0, 100, 30, 0)).toBe(0);
  });

  it('frame exactly at endFrame is fully transparent under fade-out', () => {
    expect(computeFadeMultiplier(100, 0, 100, 0, 30)).toBe(0);
  });

  it('zero-length item (visibleFrom === endFrame) does not divide by zero', () => {
    // Degenerate but should not NaN. With both vf=ef and a fadeIn, the
    // interpolation domain collapses; the helper still returns a finite value.
    const v = computeFadeMultiplier(0, 5, 5, 10, 0);
    expect(Number.isFinite(v)).toBe(true);
  });
});
