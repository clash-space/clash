import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_CLIP_EFFECTS,
  builtInEffectRegistry,
  computeEffectPresentation,
} from './index';

describe('built-in clip effects for the Timeline Library', () => {
  it('registers real visual effects, zooms, filters, and adjustments', () => {
    expect(BUILT_IN_CLIP_EFFECTS).toEqual([
      'camera-shake',
      'soft-glow',
      'tilt-shift',
      'punch-zoom',
      'slow-drift',
      'warm-film',
      'cool-clean',
      'monochrome',
      'adjust-exposure',
      'adjust-saturation',
      'adjust-contrast',
    ]);

    expect(
      builtInEffectRegistry.list({ kind: 'clip-effect', renderer: 'remotion' })
        .map((definition) => definition.id),
    ).toEqual(BUILT_IN_CLIP_EFFECTS.map((name) => `clash/${name}`).sort());
  });

  it('evaluates motion from the Remotion frame instead of CSS time', () => {
    const definition = builtInEffectRegistry.resolve('clash/camera-shake', 1);
    const first = computeEffectPresentation({
      definition,
      params: { intensity: 8, speed: 1 },
      progress: 0.25,
      frame: 12,
      width: 1920,
      height: 1080,
      role: 'from',
    });
    const repeated = computeEffectPresentation({
      definition,
      params: { intensity: 8, speed: 1 },
      progress: 0.25,
      frame: 12,
      width: 1920,
      height: 1080,
      role: 'from',
    });
    const later = computeEffectPresentation({
      definition,
      params: { intensity: 8, speed: 1 },
      progress: 0.5,
      frame: 24,
      width: 1920,
      height: 1080,
      role: 'from',
    });

    expect(first).toEqual(repeated);
    expect(first.transform).not.toEqual(later.transform);
  });

  it('ships useful defaults while keeping parameters typed and bounded', () => {
    const zoom = builtInEffectRegistry.resolve('clash/punch-zoom', 1);
    expect(zoom.params.amount).toMatchObject({ type: 'number', min: 0, max: 0.4 });

    const warm = builtInEffectRegistry.resolve('clash/warm-film', 1);
    const style = computeEffectPresentation({
      definition: warm,
      params: {},
      progress: 0.5,
      frame: 15,
      width: 1080,
      height: 1920,
      role: 'from',
    });
    expect(style.filter).toContain('sepia');
  });
});
