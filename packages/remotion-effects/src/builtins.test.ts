import { describe, expect, it } from 'vitest';
import {
  BUILT_IN_TRANSITION_TYPES,
  builtInEffectRegistry,
  computeBuiltInTransitionStyle,
  resolveBuiltInTransition,
} from './builtins';

describe('built-in transition effects', () => {
  it('registers every legacy transition as a versioned effect', () => {
    expect(BUILT_IN_TRANSITION_TYPES).toHaveLength(9);
    expect(builtInEffectRegistry.list({ kind: 'transition', renderer: 'css' })).toHaveLength(9);

    expect(resolveBuiltInTransition('circle-wipe')).toMatchObject({
      id: 'clash/circle-wipe',
      version: 1,
      kind: 'transition',
      capabilities: { css: true, remotion: true },
    });
  });

  it('computes the legacy presentation through the registered effect', () => {
    expect(computeBuiltInTransitionStyle('crossfade', 0.25, 'from')).toEqual({ opacity: 0.75 });
    expect(computeBuiltInTransitionStyle('push-left', 0.5, 'to')).toEqual({
      transform: 'translateX(50%)',
    });
    expect(computeBuiltInTransitionStyle('circle-wipe', 1, 'to')).toEqual({
      clipPath: 'circle(150% at 50% 50%)',
    });
  });

  it('fails explicitly for an unknown transition instead of silently rendering nothing', () => {
    expect(() => computeBuiltInTransitionStyle('agent/missing', 0.5, 'to')).toThrow(/not registered/i);
  });
});
