import { describe, expect, it } from 'vitest';
import { compileEffect } from './index';
import {
  BUILT_IN_SHADER_EFFECTS,
  CINEMATIC_SHADER_EFFECTS,
  getBuiltInShaderSource,
  resolveBuiltInShaderEffect,
} from './shader-effects';

describe('built-in shader effects', () => {
  it('publishes three versioned transition definitions with real shader sources', () => {
    expect(BUILT_IN_SHADER_EFFECTS).toEqual([
      'displacement-warp',
      'prism-split',
      'pixel-dissolve',
    ]);

    for (const name of BUILT_IN_SHADER_EFFECTS) {
      const effect = resolveBuiltInShaderEffect(name);
      expect(effect).toMatchObject({
        id: `clash/${name}`,
        version: 1,
        kind: 'transition',
        capabilities: { webgl2: true },
      });
      const source = getBuiltInShaderSource(effect.passes[0].shader);
      expect(source).toContain('#version 300 es');
      expect(source).toContain('void main()');
    }
  });

  it('publishes a curated cinematic set with traceable upstream provenance', () => {
    expect(CINEMATIC_SHADER_EFFECTS).toEqual([
      'whip-pan',
      'light-leak',
      'flash-through-white',
    ]);

    for (const name of CINEMATIC_SHADER_EFFECTS) {
      const effect = resolveBuiltInShaderEffect(name);
      expect(effect).toMatchObject({
        id: `clash/${name}`,
        version: 1,
        kind: 'transition',
        capabilities: { webgl2: true },
        provenance: {
          provider: 'hyperframes',
          upstreamId: name,
          license: 'Apache-2.0',
          adapted: true,
        },
      });
      expect(effect.provenance?.sourceUrl).toContain('heygen-com/hyperframes');
      expect(getBuiltInShaderSource(effect.passes[0].shader)).toContain('#version 300 es');
    }
  });

  it('compiles effect parameters and progress into deterministic uniforms', () => {
    const definition = resolveBuiltInShaderEffect('displacement-warp');
    const plan = compileEffect({
      definition,
      renderer: 'webgl2',
      inputs: { from: 'scene-a', to: 'scene-b' },
      params: { intensity: 0.6, frequency: 7 },
      progress: 0.25,
      frame: 15,
      width: 1280,
      height: 720,
    });

    expect(plan.passes).toEqual([
      {
        kind: 'shader',
        shader: 'transition-displacement-warp',
        uniforms: {
          u_progress: 0.25,
          u_intensity: 0.6,
          u_frequency: 7,
        },
      },
    ]);
  });

  it('compiles cinematic parameters into explicit shader uniforms', () => {
    const definition = resolveBuiltInShaderEffect('whip-pan');
    const plan = compileEffect({
      definition,
      renderer: 'webgl2',
      inputs: { from: 'scene-a', to: 'scene-b' },
      params: { intensity: 0.06, direction: -1 },
      progress: 0.5,
      frame: 45,
      width: 1280,
      height: 720,
    });

    expect(plan.passes).toEqual([
      {
        kind: 'shader',
        shader: 'transition-whip-pan',
        uniforms: {
          u_progress: 0.5,
          u_intensity: 0.06,
          u_direction: -1,
        },
      },
    ]);
  });
});
