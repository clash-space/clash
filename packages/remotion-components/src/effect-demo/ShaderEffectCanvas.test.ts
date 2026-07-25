import { describe, expect, it } from 'vitest';
import { computeShaderFallbackFrame } from './ShaderEffectCanvas';

describe('computeShaderFallbackFrame', () => {
  it('keeps a deterministic light-leak fallback for GPU-less render workers', () => {
    const midpoint = computeShaderFallbackFrame('clash/light-leak', 0.5, { intensity: 0.8 });
    expect(midpoint.blend).toBe(0.5);
    expect(midpoint.leak).toBeCloseTo(0.8, 5);
    expect(midpoint.flash).toBe(0);
  });

  it('clamps transition progress before computing fallback presentation', () => {
    expect(computeShaderFallbackFrame('clash/flash-through-white', -1, { intensity: 1 }).blend).toBe(0);
    expect(computeShaderFallbackFrame('clash/flash-through-white', 2, { intensity: 1 }).blend).toBe(1);
  });
});
