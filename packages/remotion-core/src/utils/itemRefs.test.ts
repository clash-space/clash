import { describe, expect, it } from 'vitest';
import { findAssetForItem, getItemAssetDurationInFrames, getItemResolvedSrc, getItemResolvedType } from './itemRefs';
import type { Asset, Item } from '../types';

const assets: Asset[] = [
  {
    id: 'canvas-node-id',
    name: 'Rendered Video',
    type: 'video',
    src: 'https://cdn.example.com/video.mp4',
    duration: 16,
    thumbnail: 'https://cdn.example.com/video.jpg',
    createdAt: 1,
    sourceNodeId: 'canvas-node-id',
    backingAssetId: 'asset-row-id',
  },
];

describe('findAssetForItem', () => {
  it('resolves items by source node id before backing asset id', () => {
    const item: Item = {
      id: 'item-1',
      type: 'video',
      from: 0,
      durationInFrames: 90,
      src: '',
      sourceNodeId: 'canvas-node-id',
      assetId: 'asset-row-id',
    };

    expect(findAssetForItem(item, assets)).toBe(assets[0]);
  });

  it('falls back to src for legacy direct-linked items', () => {
    const item: Item = {
      id: 'item-2',
      type: 'video',
      from: 0,
      durationInFrames: 90,
      src: 'https://cdn.example.com/video.mp4',
    };

    expect(findAssetForItem(item, assets)).toBe(assets[0]);
  });
});

describe('item reference helpers', () => {
  it('resolves src and type from the linked asset when the item payload is stripped', () => {
    const item = {
      id: 'item-3',
      from: 0,
      durationInFrames: 90,
      sourceNodeId: 'canvas-node-id',
      assetId: 'asset-row-id',
    };

    expect(getItemResolvedType(item, assets)).toBe('video');
    expect(getItemResolvedSrc(item, assets)).toBe('https://cdn.example.com/video.mp4');
  });

  it('computes media duration in frames from the resolved asset metadata', () => {
    const item = {
      id: 'item-4',
      from: 0,
      durationInFrames: 90,
      sourceNodeId: 'canvas-node-id',
      assetId: 'asset-row-id',
    };

    expect(getItemAssetDurationInFrames(item, assets, 30)).toBe(480);
  });
});
