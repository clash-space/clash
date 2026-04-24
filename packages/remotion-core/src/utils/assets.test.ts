import { describe, expect, it } from 'vitest';
import { getEditorAssetKey, normalizeEditorAsset } from './assets';

describe('getEditorAssetKey', () => {
  it('prefers the source node id for deduplication', () => {
    expect(
      getEditorAssetKey({
        id: 'editor-asset-id',
        src: 'https://cdn.example.com/video.mp4',
        sourceNodeId: 'canvas-node-id',
      })
    ).toBe('canvas-node-id');
  });
});

describe('normalizeEditorAsset', () => {
  it('preserves media metadata needed by the timeline item factory', () => {
    const asset = normalizeEditorAsset({
      id: 'canvas-node-id',
      name: 'Rendered Video',
      type: 'video',
      src: 'https://cdn.example.com/video.mp4',
      duration: 16,
      thumbnail: 'https://cdn.example.com/video.jpg',
      waveform: [0.2, 0.5],
      sourceNodeId: 'canvas-node-id',
      backingAssetId: 'asset-row-id',
    });

    expect(asset).toMatchObject({
      id: 'canvas-node-id',
      name: 'Rendered Video',
      type: 'video',
      src: 'https://cdn.example.com/video.mp4',
      duration: 16,
      thumbnail: 'https://cdn.example.com/video.jpg',
      waveform: [0.2, 0.5],
      sourceNodeId: 'canvas-node-id',
      backingAssetId: 'asset-row-id',
      readOnly: true,
    });
  });
});
