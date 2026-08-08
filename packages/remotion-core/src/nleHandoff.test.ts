import { describe, expect, it } from 'vitest';
import type { TimelineDsl } from './types';
import { buildNleHandoff, preflightNleHandoff, type NleTarget } from './nleHandoff';

function timeline(items: TimelineDsl['tracks'][number]['items']): TimelineDsl {
  return {
    tracks: [{ id: 'visual', name: 'Visual', category: 'visual', items }],
    compositionWidth: 1920,
    compositionHeight: 1080,
    fps: 30,
    durationInFrames: 300,
  };
}

describe('NLE handoff', () => {
  it('requires composition and shader clips to be baked before handoff', () => {
    const result = preflightNleHandoff(timeline([
      {
        id: 'clip',
        type: 'video',
        src: 'https://media.example/clip.mp4',
        from: 0,
        durationInFrames: 120,
        effects: [{ effectId: 'clash.glitch', effectVersion: 1 }],
      },
      {
        id: 'lower-third',
        type: 'composition',
        compositionKind: 'custom',
        runtime: 'remotion',
        compositionId: 'lower-third',
        sourceNodeId: 'remotion-lower-third',
        sourcePath: 'compositions/lower-third/index.tsx',
        from: 30,
        durationInFrames: 60,
      },
    ]), 'davinci-resolve');

    expect(result.summary).toEqual({ direct: 0, bake: 2, unsupported: 0 });
    expect(result.items.map((item) => [item.itemId, item.disposition])).toEqual([
      ['clip', 'bake'],
      ['lower-third', 'bake'],
    ]);
  });

  it('uses rendered media for baked composition and shader clips', () => {
    const result = buildNleHandoff({
      target: 'davinci-resolve',
      timelineName: 'Launch Cut',
      revisionId: 'rev-7',
      timeline: timeline([
        {
          id: 'clip',
          type: 'video',
          src: 'https://media.example/clip.mp4',
          bakedAssetPath: 'https://media.example/bakes/clip-glitch.mov',
          from: 0,
          durationInFrames: 120,
          effects: [{ effectId: 'clash.glitch', effectVersion: 1 }],
        },
        {
          id: 'lower-third',
          type: 'composition',
          compositionKind: 'custom',
          runtime: 'remotion',
          compositionId: 'lower-third',
          sourceNodeId: 'remotion-lower-third',
          sourcePath: 'compositions/lower-third/index.tsx',
          renderedAssetPath: 'https://media.example/bakes/lower-third.mov',
          from: 30,
          durationInFrames: 60,
        },
      ]),
    });

    expect(result.extension).toBe('otio');
    expect(result.assets.map((asset) => asset.source)).toEqual([
      'https://media.example/bakes/clip-glitch.mov',
      'https://media.example/bakes/lower-third.mov',
    ]);
    expect(result.content).toContain('Launch Cut');
    expect(result.content).toContain('rev-7');
    expect(result.content).not.toContain('https://media.example');
  });

  it.each<[NleTarget, string, string]>([
    ['davinci-resolve', 'otio', 'OTIO_SCHEMA'],
    ['final-cut-pro', 'fcpxml', '<fcpxml'],
    ['premiere-pro', 'xml', '<xmeml'],
  ])('builds a real %s interchange document', (target, extension, marker) => {
    const result = buildNleHandoff({
      target,
      timelineName: 'Rough Cut',
      revisionId: 'rev-1',
      timeline: timeline([{
        id: 'clip',
        type: 'video',
        src: '/Users/editor/Movies/clip.mov',
        sourceStartInFrames: 15,
        from: 30,
        durationInFrames: 90,
      }]),
    });

    expect(result.extension).toBe(extension);
    expect(result.content).toContain(marker);
    expect(result.assets).toHaveLength(1);
    expect(result.content).toContain(result.assets[0].token);
  });

  it('refuses to create a misleading handoff while a bake is unresolved', () => {
    expect(() => buildNleHandoff({
      target: 'final-cut-pro',
      timelineName: 'Effects Cut',
      revisionId: 'rev-2',
      timeline: timeline([{
        id: 'shader-clip',
        type: 'video',
        src: '/Users/editor/Movies/clip.mov',
        from: 0,
        durationInFrames: 90,
        effects: [{ effectId: 'clash.bloom', effectVersion: 2 }],
      }]),
    })).toThrow(/must be baked/i);
  });
});
