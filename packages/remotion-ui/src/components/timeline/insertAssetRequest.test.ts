import { describe, expect, it } from 'vitest';
import {
  buildTimelineAssetInsertion,
  hasTimelineAssetInsertReceipt,
} from './insertAssetRequest';

describe('buildTimelineAssetInsertion', () => {
  it('turns a picker asset into a playable Timeline track at the current frame', () => {
    const result = buildTimelineAssetInsertion({
      asset: {
        id: 'timeline-asset:asset-1',
        backingAssetId: 'asset-1',
        sourceNodeId: 'timeline-asset:asset-1',
        name: 'Opening frame',
        src: '/opening.png',
        type: 'image',
      },
      frame: 42,
      fps: 30,
      compositionWidth: 1920,
      compositionHeight: 1080,
      requestId: 'request-1',
    });

    expect(result.asset).toMatchObject({ id: 'timeline-asset:asset-1', backingAssetId: 'asset-1' });
    expect(result.track).toMatchObject({
      id: 'track-request-1',
      name: 'Image',
      items: [{
        id: 'item-request-1',
        type: 'image',
        assetId: 'asset-1',
        sourceNodeId: 'timeline-asset:asset-1',
        from: 42,
        durationInFrames: 90,
        src: '/opening.png',
      }],
    });
  });

  it('uses media duration for audio and video insertions', () => {
    const result = buildTimelineAssetInsertion({
      asset: { id: 'voice', type: 'audio', src: '/voice.wav', duration: 2.5 },
      frame: 0,
      fps: 24,
      compositionWidth: 1080,
      compositionHeight: 1920,
      requestId: 'voice-request',
    });
    expect(result.track.items[0]).toMatchObject({ type: 'audio', durationInFrames: 60 });
  });

  it('recognizes a committed request by its deterministic track receipt', () => {
    expect(hasTimelineAssetInsertReceipt([
      { id: 'track-request-1', items: [{ id: 'item-request-1' }] },
      { id: 'track-request-2', items: [{ id: 'item-request-2' }] },
    ], 'request-2')).toBe(true);
    expect(hasTimelineAssetInsertReceipt([
      { id: 'track-request-1', items: [{ id: 'item-request-1' }] },
    ], 'request-missing')).toBe(false);
    expect(hasTimelineAssetInsertReceipt([
      { id: 'track-request-2', items: [{ id: 'another-item' }] },
    ], 'request-2')).toBe(false);
  });
});
