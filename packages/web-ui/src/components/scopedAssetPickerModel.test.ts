import { describe, expect, it } from 'vitest';
import {
  buildScopedAssetSections,
  buildScopedTimelineAssetInput,
} from './scopedAssetPickerModel';

const projectAssets = [
  { id: 'asset-canvas', assetId: 'asset-canvas', name: 'Opening frame', url: '/opening.png', thumbnailUrl: '/opening-thumb.png', type: 'image' as const, storageKey: 'projects/private/opening.png', createdAt: null },
  { id: 'asset-project', assetId: 'asset-project', name: 'Voice over', url: '/voice.wav', type: 'audio' as const, storageKey: 'generated/private/voice.wav', createdAt: null },
];
const globalAssets = [
  { id: 'asset-global', assetId: 'asset-global', name: 'Brand sting', url: '/sting.mp4', thumbnailUrl: '/sting-cover.webp', type: 'video' as const, storageKey: 'library/private/sting.mp4', createdAt: null },
  projectAssets[1],
];
const nodes = [
  { id: 'opening-node', canvasId: 'main', type: 'image', data: { assetId: 'asset-canvas', label: 'Opening frame' } },
  { id: 'other-node', canvasId: 'other', type: 'audio', data: { assetId: 'asset-project', label: 'Other voice' } },
];

describe('buildScopedAssetSections', () => {
  it('gives a Canvas project assets plus one external scope and no parent Canvas section', () => {
    const sections = buildScopedAssetSections({
      target: { kind: 'canvas', canvasId: 'main' },
      projectAssets,
      globalAssets,
      nodes,
    });
    expect(sections.map((section) => section.scope)).toEqual(['project', 'external']);
    expect(sections.some((section) => section.scope === 'current-canvas')).toBe(false);
    expect(sections[0].assets.map((asset) => asset.assetId)).toEqual(['asset-project']);
    expect(sections.find((section) => section.scope === 'external')?.allowLocalUpload).toBe(true);
  });

  it('adds current Canvas assets only for a Canvas-owned Timeline and removes duplicates downstream', () => {
    const sections = buildScopedAssetSections({
      target: {
        kind: 'timeline',
        timelineId: 'cut',
        owner: { kind: 'canvas-action', canvasId: 'main', actionNodeId: 'editor' },
      },
      projectAssets,
      globalAssets,
      nodes,
      edges: [{ canvasId: 'main', source: 'opening-node', target: 'editor' }],
    });
    expect(sections.map((section) => section.scope)).toEqual(['current-canvas', 'project', 'external']);
    expect(sections[0].assets).toEqual([]);
    expect(sections[1].assets.map((asset) => asset.assetId)).toEqual(['asset-project']);
    expect(sections[2].assets.map((asset) => asset.assetId)).toEqual(['asset-global']);
  });

  it('removes assets already referenced by a standalone Timeline from every larger scope', () => {
    const sections = buildScopedAssetSections({
      target: {
        kind: 'timeline',
        timelineId: 'standalone',
        owner: { kind: 'project' },
      },
      targetState: { mediaAssetRefs: [{ assetId: 'asset-project' }] },
      projectAssets,
      globalAssets,
      nodes,
    });
    expect(sections[0].assets.map((asset) => asset.assetId)).toEqual(['asset-canvas']);
    expect(sections[1].assets.map((asset) => asset.assetId)).toEqual(['asset-global']);
  });

  it('never uses a storage key or UUID as visible copy', () => {
    const sections = buildScopedAssetSections({
      target: { kind: 'canvas', canvasId: 'main' },
      projectAssets: [{
        id: 'fce43e93-badc-4c4e-88bf-a4ec8b1a1871',
        url: '/image.png',
        type: 'image',
        storageKey: 'projects/private/fce43e93-badc-4c4e-88bf-a4ec8b1a1871.png',
        createdAt: null,
      }],
      globalAssets: [],
      nodes: [],
    });
    expect(sections[0].assets[0].name).toBe('Image');
  });

  it('inserts playable video bytes while keeping the cover as its thumbnail', () => {
    const sections = buildScopedAssetSections({
      target: { kind: 'timeline', timelineId: 'standalone', owner: { kind: 'project' } },
      projectAssets: [{
        id: 'asset-video',
        assetId: 'asset-video',
        name: 'Talking head',
        url: '/assets/covers/talking-head.png',
        thumbnailUrl: '/assets/covers/talking-head.png',
        type: 'video',
        storageKey: 'local-blobs/video/original.mp4',
        createdAt: null,
      }],
      globalAssets: [],
      nodes: [],
    });

    expect(sections[0].assets[0]).toMatchObject({
      src: '/assets/local-blobs/video/original.mp4',
      thumbnail: '/assets/covers/talking-head.png',
    });
  });

  it('hydrates Timeline insertion dimensions and duration from the authoritative Asset row', () => {
    expect(buildScopedTimelineAssetInput({
      option: {
        assetId: 'asset-video',
        name: 'Talking head',
        type: 'video',
        src: '/fallback.mp4',
        thumbnail: '/fallback-cover.jpg',
        source: { kind: 'project', assetId: 'asset-video' },
      },
      sourceNodeId: 'timeline-asset:asset-video',
      backingAssetId: 'asset-video',
      asset: {
        id: 'asset-video',
        userId: 'local-user',
        kind: 'video',
        srcR2Key: 'uploads/talking-head.mp4',
        coverR2Key: 'covers/talking-head.jpg',
        metadata: {
          width: 1920,
          height: 1080,
          durationMs: 32_661,
          waveform: [0.1, 0.7],
        },
        signedUrl: '/assets/uploads/talking-head.mp4',
        signedCoverUrl: '/assets/covers/talking-head.jpg',
        createdAt: 1,
        updatedAt: 1,
      },
    })).toMatchObject({
      id: 'timeline-asset:asset-video',
      backingAssetId: 'asset-video',
      sourceNodeId: 'timeline-asset:asset-video',
      src: '/assets/uploads/talking-head.mp4',
      thumbnail: '/assets/covers/talking-head.jpg',
      type: 'video',
      width: 1920,
      height: 1080,
      duration: 32.661,
      waveform: [0.1, 0.7],
    });
  });
});
