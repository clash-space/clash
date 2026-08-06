import { describe, expect, it } from 'vitest';
import { TIMELINE_DSL_FIELD_ANNOTATIONS } from '@clash/shared-types';
import * as composition from './VideoComposition';

const { mergeContiguousMediaItems } = composition;
type MergeItem = Parameters<typeof mergeContiguousMediaItems>[0][number];
type ItemPatch = Record<string, unknown>;

function videoPair(
  leftPatch: ItemPatch = {},
  rightPatch: ItemPatch = {},
): [MergeItem, MergeItem] {
  const first = {
    id: 'first',
    type: 'video',
    src: 'clip.mp4',
    resolvedSrcUrl: '/clip.mp4',
    from: 0,
    durationInFrames: 20,
    sourceStartInFrames: 0,
    ...leftPatch,
  } as unknown as MergeItem;
  const second = {
    id: 'second',
    type: 'video',
    src: 'clip.mp4',
    resolvedSrcUrl: '/clip.mp4',
    from: 20,
    durationInFrames: 20,
    sourceStartInFrames: 20,
    ...rightPatch,
  } as unknown as MergeItem;
  return [first, second];
}

function audioPair(
  leftPatch: ItemPatch = {},
  rightPatch: ItemPatch = {},
): [MergeItem, MergeItem] {
  const first = {
    id: 'first',
    type: 'audio',
    src: 'sound.wav',
    resolvedSrcUrl: '/sound.wav',
    from: 0,
    durationInFrames: 20,
    sourceStartInFrames: 0,
    ...leftPatch,
  } as unknown as MergeItem;
  const second = {
    id: 'second',
    type: 'audio',
    src: 'sound.wav',
    resolvedSrcUrl: '/sound.wav',
    from: 20,
    durationInFrames: 20,
    sourceStartInFrames: 20,
    ...rightPatch,
  } as unknown as MergeItem;
  return [first, second];
}

function expectSeparate(items: [MergeItem, MergeItem]): void {
  expect(mergeContiguousMediaItems(items).map((item) => item.id)).toEqual([
    'first',
    'second',
  ]);
}

describe('descriptor-aware contiguous media merging', () => {
  it('classifies every declared base and media field in the merge policy', () => {
    const policy = (
      composition as unknown as {
        TIMELINE_MEDIA_MERGE_FIELD_POLICY?: {
          video: Record<string, string>;
          audio: Record<string, string>;
        };
      }
    ).TIMELINE_MEDIA_MERGE_FIELD_POLICY ?? { video: {}, audio: {} };
    const baseFields = Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemBase);

    expect(Object.keys(policy.video).sort()).toEqual(
      [...new Set([
        ...baseFields,
        ...Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.video),
      ])].sort(),
    );
    expect(Object.keys(policy.audio).sort()).toEqual(
      [...new Set([
        ...baseFields,
        ...Object.keys(TIMELINE_DSL_FIELD_ANNOTATIONS.itemTypes.audio),
      ])].sort(),
    );
    for (const mode of Object.values(policy).flatMap(Object.values)) {
      expect([
        'same',
        'segment-id',
        'timeline-contiguous',
        'duration-sum',
        'source-contiguous',
        'absent',
      ]).toContain(mode);
    }
  });

  it('still joins neutral fragments from one continuous video source', () => {
    const merged = mergeContiguousMediaItems(videoPair());

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'first',
      from: 0,
      durationInFrames: 40,
      sourceStartInFrames: 0,
    });
  });

  it('preserves fragment identities that are selected or referenced by another item', () => {
    const mergeWithProtectedIds = mergeContiguousMediaItems as unknown as (
      items: MergeItem[],
      options: { protectedItemIds: ReadonlySet<string> },
    ) => MergeItem[];

    expect(
      mergeWithProtectedIds(videoPair(), {
        protectedItemIds: new Set(['second']),
      }).map((item) => item.id),
    ).toEqual(['first', 'second']);
  });

  const baseDifferences: Array<[string, ItemPatch, ItemPatch]> = [
    ['assetId', { assetId: 'asset-a' }, { assetId: 'asset-b' }],
    ['sourceNodeId', { sourceNodeId: 'node-a' }, { sourceNodeId: 'node-b' }],
    [
      'properties',
      { properties: { x: 0, y: 0, width: 1, height: 1, opacity: 1 } },
      { properties: { x: 100, y: 0, width: 1, height: 1, opacity: 1 } },
    ],
    [
      'keyframes',
      {},
      { keyframes: { opacity: [{ frame: 0, value: 0, interpolation: 'linear' }] } },
    ],
    [
      'mask',
      {},
      { mask: { shape: 'ellipse', position: [50, 50], size: [60, 60] } },
    ],
    [
      'effects',
      { effects: [{ effectId: 'clash/blur', effectVersion: 1, params: { amount: 0.2 } }] },
      { effects: [{ effectId: 'clash/blur', effectVersion: 1, params: { amount: 0.8 } }] },
    ],
    ['bakedAssetPath', { bakedAssetPath: 'a.mov' }, { bakedAssetPath: 'b.mov' }],
    ['fromExpr', { fromExpr: 'start' }, { fromExpr: 'prev' }],
  ];

  for (const [field, left, right] of baseDifferences) {
    it(`does not merge video fragments with different ${field}`, () => {
      expectSeparate(videoPair(left, right));
    });
  }

  const videoDifferences: Array<[string, ItemPatch, ItemPatch]> = [
    ['src', { src: 'alias-a.mp4' }, { src: 'alias-b.mp4' }],
    ['mediaFit', { mediaFit: 'cover' }, { mediaFit: 'contain' }],
    ['audioGainDb', { audioGainDb: -12 }, { audioGainDb: 6 }],
    ['volume', { volume: 0.25 }, { volume: 0.9 }],
    ['waveform', { waveform: [0.1, 0.2] }, { waveform: [0.8, 0.9] }],
    [
      'entranceAnimation',
      { entranceAnimation: { type: 'fade', durationInFrames: 5 } },
      { entranceAnimation: { type: 'zoom-in', durationInFrames: 5 } },
    ],
    [
      'exitAnimation',
      { exitAnimation: { type: 'fade', durationInFrames: 5 } },
      { exitAnimation: { type: 'slide-left', durationInFrames: 5 } },
    ],
    ['videoFadeIn', { videoFadeIn: 3 }, { videoFadeIn: 8 }],
    ['videoFadeOut', { videoFadeOut: 3 }, { videoFadeOut: 8 }],
    ['audioFadeInFrames', { audioFadeInFrames: 3 }, { audioFadeInFrames: 8 }],
    ['audioFadeOutFrames', { audioFadeOutFrames: 3 }, { audioFadeOutFrames: 8 }],
    ['audioFadeIn', { audioFadeIn: 3 }, { audioFadeIn: 8 }],
    ['audioFadeOut', { audioFadeOut: 3 }, { audioFadeOut: 8 }],
    ['videoFadeInColor', { videoFadeInColor: '#fff' }, { videoFadeInColor: '#000' }],
    ['videoFadeOutColor', { videoFadeOutColor: '#fff' }, { videoFadeOutColor: '#000' }],
  ];

  for (const [field, left, right] of videoDifferences) {
    it(`does not merge video fragments with different ${field}`, () => {
      expectSeparate(videoPair(left, right));
    });
  }

  it('does not merge equal item-local effects because effect progress restarts per clip', () => {
    const effects = [{
      effectId: 'clash/blur',
      effectVersion: 1,
      params: { amount: 0.5 },
    }];
    expectSeparate(videoPair({ effects }, { effects }));
  });

  it('does not merge equal fades because each clip owns its boundary timing', () => {
    expectSeparate(videoPair({ videoFadeIn: 5 }, { videoFadeIn: 5 }));
  });

  const audioDifferences: Array<[string, ItemPatch, ItemPatch]> = [
    ['src', { src: 'alias-a.wav' }, { src: 'alias-b.wav' }],
    ['audioGainDb', { audioGainDb: -18 }, { audioGainDb: 3 }],
    [
      'audioDucking',
      { audioDucking: { amountDb: -10, attackFrames: 3, releaseFrames: 8 } },
      { audioDucking: { amountDb: -24, attackFrames: 10, releaseFrames: 30 } },
    ],
    ['volume', { volume: 0.2 }, { volume: 1 }],
    ['waveform', { waveform: [0.1, 0.2] }, { waveform: [0.8, 0.9] }],
    ['audioFadeInFrames', { audioFadeInFrames: 2 }, { audioFadeInFrames: 9 }],
    ['audioFadeOutFrames', { audioFadeOutFrames: 2 }, { audioFadeOutFrames: 9 }],
    ['audioFadeIn', { audioFadeIn: 2 }, { audioFadeIn: 9 }],
    ['audioFadeOut', { audioFadeOut: 2 }, { audioFadeOut: 9 }],
  ];

  for (const [field, left, right] of audioDifferences) {
    it(`does not merge audio fragments with different ${field}`, () => {
      expectSeparate(audioPair(left, right));
    });
  }

  it('does not merge video and audio items even when their resolved source matches', () => {
    const [video] = videoPair();
    const [, audio] = audioPair();
    const sameUrlAudio = {
      ...audio,
      resolvedSrcUrl: video.resolvedSrcUrl,
      src: (video as MergeItem & { src?: string }).src,
    } as MergeItem;

    expectSeparate([video, sameUrlAudio]);
  });

  it('fails closed when a runtime item carries an unclassified semantic field', () => {
    expectSeparate(videoPair({}, { futureSemanticField: { mode: 'new' } }));
  });
});
