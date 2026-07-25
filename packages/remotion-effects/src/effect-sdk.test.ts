import { describe, expect, it } from 'vitest';
import {
  EffectRegistry,
  compileEffect,
  defineEffect,
  numberParam,
  textureInput,
} from './index';

const crossfade = defineEffect({
  id: 'clash/crossfade',
  version: 1,
  kind: 'transition',
  inputs: {
    from: textureInput(),
    to: textureInput(),
  },
  params: {
    mix: numberParam({ default: 1, min: 0, max: 1, keyframable: true }),
  },
  capabilities: {
    css: true,
    webgl2: true,
    remotion: true,
  },
  passes: [
    {
      kind: 'shader',
      shader: 'crossfade',
      uniforms: ({ params, progress }) => ({
        u_mix: params.mix * progress,
      }),
    },
  ],
});

describe('defineEffect', () => {
  it('rejects an invalid default before an effect can enter the registry', () => {
    expect(() =>
      defineEffect({
        id: 'clash/bad-default',
        version: 1,
        kind: 'clip-effect',
        inputs: { source: textureInput() },
        params: {
          strength: numberParam({ default: 2, min: 0, max: 1 }),
        },
        capabilities: { webgl2: true },
        passes: [],
      }),
    ).toThrow(/default.*strength/i);
  });
});

describe('EffectRegistry', () => {
  it('resolves exact versions and rejects duplicate definitions', () => {
    const registry = new EffectRegistry();
    registry.register(crossfade);

    expect(registry.resolve('clash/crossfade', 1)).toBe(crossfade);
    expect(() => registry.register(crossfade)).toThrow(/already registered/i);
  });

  it('uses the declared fallback when a renderer is unavailable', () => {
    const registry = new EffectRegistry();
    registry.register(crossfade);
    registry.register(
      defineEffect({
        id: 'clash/displacement',
        version: 1,
        kind: 'transition',
        inputs: { from: textureInput(), to: textureInput() },
        params: {},
        capabilities: { webgl2: true },
        fallback: { effectId: 'clash/crossfade', version: 1 },
        passes: [],
      }),
    );

    expect(registry.resolveForRenderer('clash/displacement', 1, 'remotion')).toEqual({
      definition: crossfade,
      fallbackFrom: { effectId: 'clash/displacement', version: 1 },
    });
  });
});

describe('compileEffect', () => {
  it('validates inputs and compiles deterministic shader uniforms', () => {
    expect(() =>
      compileEffect({
        definition: crossfade,
        renderer: 'webgl2',
        inputs: { from: 'texture-a' },
        params: {},
        progress: 0.25,
        frame: 12,
        width: 1920,
        height: 1080,
      }),
    ).toThrow(/input.*to/i);

    const plan = compileEffect({
      definition: crossfade,
      renderer: 'webgl2',
      inputs: { from: 'texture-a', to: 'texture-b' },
      params: { mix: 0.8 },
      progress: 0.25,
      frame: 12,
      width: 1920,
      height: 1080,
    });

    expect(plan).toMatchObject({
      effectId: 'clash/crossfade',
      effectVersion: 1,
      renderer: 'webgl2',
      inputs: { from: 'texture-a', to: 'texture-b' },
      params: { mix: 0.8 },
      passes: [{ kind: 'shader', shader: 'crossfade', uniforms: { u_mix: 0.2 } }],
    });
  });
});
