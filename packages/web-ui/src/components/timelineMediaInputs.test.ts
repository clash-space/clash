import { describe, expect, it } from 'vitest';
import {
  canonicalizeTimelineItemScopeRefs,
  selectTimelineMediaInputs,
} from './timelineMediaInputs';

describe('selectTimelineMediaInputs', () => {
  const assets = [
    { id: 'asset-connected', assetId: 'asset-connected', url: '/connected.png', type: 'image' as const, storageKey: 'projects/private/connected.png', createdAt: null },
    { id: 'asset-unconnected', assetId: 'asset-unconnected', url: '/unconnected.png', type: 'image' as const, storageKey: 'generated/private/unconnected.png', createdAt: null },
    { id: 'asset-used', assetId: 'asset-used', url: '/used.mp4', type: 'video' as const, storageKey: 'uploads/private/used.mp4', createdAt: null },
  ];
  const nodes = [
    { id: 'source-connected', canvasId: 'main', type: 'image', data: { assetId: 'asset-connected', label: 'Opening frame' } },
    { id: 'source-unconnected', canvasId: 'main', type: 'image', data: { assetId: 'asset-unconnected', label: 'Not wired' } },
    { id: 'source-used', canvasId: 'main', type: 'video', data: { assetId: 'asset-used' } },
  ];

  it('admits wired sources and already-used clips, but not the whole Project asset pool', () => {
    const result = selectTimelineMediaInputs({
      timeline: {
        id: 'timeline-1',
        name: 'Cut',
        owner: { kind: 'canvas-action', canvasId: 'main', actionNodeId: 'timeline-action' },
        revisionId: 'rev',
        state: { tracks: [{ items: [{ sourceNodeId: 'source-used', assetId: 'asset-used', type: 'video' }] }] },
      },
      assets,
      nodes,
      edges: [{ canvasId: 'main', source: 'source-connected', target: 'timeline-action' }],
    });

    expect(result.map((asset) => asset.sourceNodeId)).toEqual(['source-connected', 'source-used']);
    expect(result[0]).toMatchObject({ displayName: 'Opening frame', backingAssetId: 'asset-connected' });
    expect(result.some((asset) => asset.sourceNodeId === 'source-unconnected')).toBe(false);
    expect(result.map((asset) => asset.displayName)).not.toContain('projects/private/connected.png');
  });

  it('does not expose Project assets to a standalone empty Timeline', () => {
    expect(selectTimelineMediaInputs({
      timeline: { id: 'timeline-2', name: 'Empty', owner: { kind: 'project' }, revisionId: 'rev', state: { tracks: [] } },
      assets,
      nodes,
      edges: [],
    })).toEqual([]);
  });

  it('admits only explicitly selected media references for a standalone Timeline', () => {
    const result = selectTimelineMediaInputs({
      timeline: {
        id: 'timeline-standalone',
        name: 'Standalone',
        owner: { kind: 'project' },
        revisionId: 'rev',
        state: { tracks: [], mediaAssetRefs: [{ assetId: 'asset-used' }] },
      },
      assets,
      nodes,
      edges: [],
    });
    expect(result).toEqual([expect.objectContaining({
      sourceNodeId: 'timeline-asset:asset-used',
      backingAssetId: 'asset-used',
      type: 'video',
    })]);
  });

  it('uses the playable storage source instead of a video cover preview', () => {
    const result = selectTimelineMediaInputs({
      timeline: {
        id: 'timeline-video',
        name: 'Video',
        owner: { kind: 'project' },
        revisionId: 'rev',
        state: {
          tracks: [],
          mediaAssetRefs: [{ assetId: 'asset-video' }],
        },
      },
      assets: [{
        id: 'asset-video',
        assetId: 'asset-video',
        name: 'Talking head',
        url: '/assets/covers/talking-head.png',
        thumbnailUrl: '/assets/covers/talking-head.png',
        type: 'video',
        storageKey: 'local-blobs/video/original.mp4',
        createdAt: null,
      }],
      nodes: [],
      edges: [],
    });

    expect(result[0]?.src).toBe('/assets/local-blobs/video/original.mp4');
  });

  it('keeps one canonical Timeline reference when a sidebar drop points at the same Project asset', () => {
    const result = selectTimelineMediaInputs({
      timeline: {
        id: 'timeline-standalone-dropped',
        name: 'Standalone drop',
        owner: { kind: 'project' },
        revisionId: 'rev',
        state: {
          mediaAssetRefs: [{ assetId: 'asset-used' }],
          tracks: [{
            id: 'track-1',
            name: 'Video',
            items: [{
              id: 'clip-1',
              sourceNodeId: 'asset-used-project-ref',
              assetId: 'asset-used',
              type: 'video',
              from: 48,
              durationInFrames: 90,
            }],
          }],
        },
      },
      assets: [
        ...assets,
        {
          id: 'asset-used-project-ref',
          assetId: 'asset-used',
          url: '/used.mp4',
          type: 'video' as const,
          storageKey: 'uploads/private/used.mp4',
          createdAt: null,
        },
      ],
      nodes,
      edges: [],
    });

    expect(result).toEqual([expect.objectContaining({
      sourceNodeId: 'timeline-asset:asset-used',
      backingAssetId: 'asset-used',
    })]);
  });

  it('prefers the connected Canvas placement over the Project sidebar identity for the same asset', () => {
    const result = selectTimelineMediaInputs({
      timeline: {
        id: 'timeline-canvas-dropped',
        name: 'Canvas drop',
        owner: { kind: 'canvas-action', canvasId: 'main', actionNodeId: 'timeline-action' },
        revisionId: 'rev',
        state: {
          tracks: [{
            id: 'track-1',
            name: 'Image',
            items: [{
              id: 'clip-1',
              sourceNodeId: 'asset-connected-project-ref',
              assetId: 'asset-connected',
              type: 'image',
              from: 73,
              durationInFrames: 90,
            }],
          }],
        },
      },
      assets: [
        ...assets,
        {
          id: 'asset-connected-project-ref',
          assetId: 'asset-connected',
          url: '/connected.png',
          type: 'image' as const,
          storageKey: 'projects/private/connected.png',
          createdAt: null,
        },
      ],
      nodes,
      edges: [{ canvasId: 'main', source: 'source-connected', target: 'timeline-action' }],
    });

    expect(result).toEqual([expect.objectContaining({
      sourceNodeId: 'source-connected',
      backingAssetId: 'asset-connected',
    })]);
  });

  it('rewrites only the scope identity and preserves the native cursor frame', () => {
    const tracks = [{
      id: 'track-1',
      name: 'Image',
      items: [{
        id: 'clip-1',
        sourceNodeId: 'asset-connected-project-ref',
        assetId: 'asset-connected',
        type: 'image' as const,
        from: 73,
        durationInFrames: 90,
      }],
    }];

    expect(canonicalizeTimelineItemScopeRefs(tracks, [{
      sourceNodeId: 'source-connected',
      backingAssetId: 'asset-connected',
      type: 'image',
      src: '/connected.png',
    }])).toEqual([{...tracks[0], items: [{
      ...tracks[0].items[0],
      sourceNodeId: 'source-connected',
      from: 73,
    }]}]);
  });
});
