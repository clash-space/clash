import { describe, expect, it } from 'vitest';
import { computeItemEffectStyle } from './item-effects';

describe('computeItemEffectStyle', () => {
  it('renders an ordered effect stack with deterministic frame progress', () => {
    const style = computeItemEffectStyle({
      effects: [
        { effectId: 'clash/punch-zoom', effectVersion: 1, params: { amount: 0.2 } },
        { effectId: 'clash/warm-film', effectVersion: 1, params: { intensity: 0.6 } },
      ],
      frame: 15,
      durationInFrames: 60,
      width: 1920,
      height: 1080,
    });

    expect(style.transform).toContain('scale(');
    expect(style.filter).toContain('sepia');
  });

  it('composes transforms and filters instead of allowing later effects to erase earlier ones', () => {
    const style = computeItemEffectStyle({
      effects: [
        { effectId: 'clash/camera-shake', effectVersion: 1 },
        { effectId: 'clash/slow-drift', effectVersion: 1 },
        { effectId: 'clash/adjust-exposure', effectVersion: 1 },
        { effectId: 'clash/adjust-contrast', effectVersion: 1 },
      ],
      frame: 20,
      durationInFrames: 90,
      width: 1080,
      height: 1920,
    });

    expect(style.transform).toContain('translate(');
    expect(style.transform).toContain('translateX(');
    expect(style.filter).toContain('brightness(');
    expect(style.filter).toContain('contrast(');
  });

  it('ignores an unavailable package without breaking the remaining render stack', () => {
    const style = computeItemEffectStyle({
      effects: [
        { effectId: 'agent/missing-effect', effectVersion: 1 },
        { effectId: 'clash/monochrome', effectVersion: 1 },
      ],
      frame: 0,
      durationInFrames: 30,
      width: 1920,
      height: 1080,
    });

    expect(style.filter).toContain('grayscale');
  });
});
