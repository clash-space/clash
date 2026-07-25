import { describe, expect, it } from 'vitest';
import { compileEffect } from './index';
import { getBuiltInShaderSource, resolveBuiltInShaderEffect } from './shader-effects';
import { prepareWebGlDraw } from './webgl';

describe('prepareWebGlDraw', () => {
  it('binds compiled inputs and resolves every shader before touching a GPU context', () => {
    const plan = compileEffect({
      definition: resolveBuiltInShaderEffect('prism-split'),
      renderer: 'webgl2',
      inputs: { from: 'scene-a', to: 'scene-b' },
      params: {},
      progress: 0.5,
      frame: 15,
      width: 640,
      height: 360,
    });
    const from = {} as TexImageSource;
    const to = {} as TexImageSource;

    const draw = prepareWebGlDraw({
      plan,
      sources: { from, to },
      resolveShader: getBuiltInShaderSource,
    });

    expect(draw.textures).toEqual([
      { name: 'from', source: from },
      { name: 'to', source: to },
    ]);
    expect(draw.passes[0]).toMatchObject({
      shader: 'transition-prism-split',
      uniforms: { u_progress: 0.5 },
    });
    expect(draw.passes[0].fragmentSource).toContain('void main()');
  });

  it('rejects a missing runtime texture before rendering', () => {
    const plan = compileEffect({
      definition: resolveBuiltInShaderEffect('pixel-dissolve'),
      renderer: 'webgl2',
      inputs: { from: 'scene-a', to: 'scene-b' },
      params: {},
      progress: 0.5,
      frame: 15,
      width: 640,
      height: 360,
    });

    expect(() => prepareWebGlDraw({
      plan,
      sources: { from: {} as TexImageSource },
      resolveShader: getBuiltInShaderSource,
    })).toThrow(/texture.*to/i);
  });
});
