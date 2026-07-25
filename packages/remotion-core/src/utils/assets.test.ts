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

  it('never exposes storage paths, URLs, or UUIDs as visible asset names', () => {
    expect(normalizeEditorAsset({ type: 'audio', src: '/audio.wav', name: 'generated/local-gen-1lrt.wav' }).name).toBe('Audio');
    expect(normalizeEditorAsset({ type: 'image', src: '/image.png', name: 'https://cdn.test/private/image.png' }).name).toBe('Image');
    expect(normalizeEditorAsset({ type: 'video', src: '/video.mp4', name: 'fce43e93-badc-4c4e-9b40-41ad9ad31fd4' }).name).toBe('Video');
    expect(normalizeEditorAsset({ type: 'image', src: '/image.png', name: 'Opening frame' }).name).toBe('Opening frame');
  });
});
