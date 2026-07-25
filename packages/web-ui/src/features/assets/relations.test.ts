import { describe, expect, it } from 'vitest';
import { buildAssetRelationSummary, readAssetRelationGraph } from './relations';

describe('readAssetRelationGraph', () => {
  it('normalizes every persisted Canvas node and edge into one project relation graph', () => {
    const graph = readAssetRelationGraph(
      [
        ['image-1', { canvasId: 'main', type: 'image', data: { assetId: 'asset-1' } }],
        ['prompt-1', { canvasId: 'review', type: 'action-badge', data: { prompt: 'Make it warmer' } }],
        ['bad-node', null],
      ],
      [
        ['edge-1', { canvasId: 'main', source: 'prompt-1', target: 'image-1' }],
        ['bad-edge', { source: 'prompt-1' }],
      ],
    );

    expect(graph.nodes).toEqual([
      { id: 'image-1', canvasId: 'main', type: 'image', data: { assetId: 'asset-1' } },
      { id: 'prompt-1', canvasId: 'review', type: 'action-badge', data: { prompt: 'Make it warmer' } },
    ]);
    expect(graph.edges).toEqual([
      { canvasId: 'main', source: 'prompt-1', target: 'image-1' },
    ]);
  });
});

describe('buildAssetRelationSummary', () => {
  it('projects origin, project usage, upstream assets, and prompts from one asset lineage graph', () => {
    const summary = buildAssetRelationSummary({
      assetId: 'asset-output',
      asset: {
        id: 'asset-output',
        sourceModel: 'nano-banana-2',
        sourcePrompt: 'A lighthouse above a coral sea',
        sourceTaskId: 'task-output',
        sources: [
          { assetId: 'asset-sketch', role: 'primary' },
          { assetId: 'asset-palette', role: 'reference' },
        ],
      },
      projectAssets: [
        { id: 'asset-sketch', assetId: 'asset-sketch', type: 'image', url: '/sketch.png', storageKey: 'inputs/sketch.png', createdAt: null },
        { id: 'asset-palette', assetId: 'asset-palette', type: 'image', url: '/palette.png', storageKey: 'inputs/palette.png', createdAt: null },
      ],
      canvases: [
        { id: 'main', name: 'Main', position: 0 },
        { id: 'review', name: 'Review', position: 1 },
      ],
      nodes: [
        {
          id: 'generate-image',
          canvasId: 'main',
          type: 'action-badge',
          data: {
            prompt: 'A lighthouse above a coral sea',
            negativePrompt: 'No text or watermark',
          },
        },
        { id: 'output-node', canvasId: 'main', type: 'image', data: { assetId: 'asset-output', label: 'Lighthouse' } },
        {
          id: 'review-prompt',
          canvasId: 'review',
          type: 'action-badge',
          data: { referenceImageAssetIds: ['asset-output'] },
        },
      ],
      edges: [
        { canvasId: 'main', source: 'generate-image', target: 'output-node' },
      ],
      timelines: [
        {
          id: 'trailer',
          name: 'Trailer',
          owner: { kind: 'project' },
          revisionId: 'revision-1',
          state: { tracks: [{ items: [{ id: 'shot-1', assetId: 'asset-output' }] }] },
        },
      ],
    });

    expect(summary.origin).toMatchObject({ canvasId: 'main', canvasName: 'Main', nodeId: 'output-node' });
    expect(summary.canvases).toEqual([
      expect.objectContaining({ canvasId: 'main', canvasName: 'Main', role: 'origin' }),
      expect.objectContaining({ canvasId: 'review', canvasName: 'Review', role: 'reference' }),
    ]);
    expect(summary.timelines).toEqual([
      expect.objectContaining({ timelineId: 'trailer', timelineName: 'Trailer', itemCount: 1 }),
    ]);
    expect(summary.upstreamAssets).toEqual([
      expect.objectContaining({ assetId: 'asset-sketch', label: 'sketch.png', role: 'primary', availableInProject: true }),
      expect.objectContaining({ assetId: 'asset-palette', label: 'palette.png', role: 'reference', availableInProject: true }),
    ]);
    expect(summary.prompts).toEqual([
      { label: 'Prompt', value: 'A lighthouse above a coral sea' },
      { label: 'Negative prompt', value: 'No text or watermark' },
    ]);
    expect(summary.sourceModel).toBe('nano-banana-2');
  });

  it('finds legacy Timeline usage through a Canvas sourceNodeId', () => {
    const summary = buildAssetRelationSummary({
      assetId: 'asset-legacy',
      projectAssets: [],
      canvases: [{ id: 'main', name: 'Main', position: 0 }],
      nodes: [{ id: 'legacy-node', canvasId: 'main', type: 'video', data: { assetId: 'asset-legacy' } }],
      edges: [],
      timelines: [{
        id: 'rough-cut',
        name: 'Rough Cut',
        owner: { kind: 'project' },
        revisionId: 'revision-1',
        state: { tracks: [{ items: [{ id: 'clip', sourceNodeId: 'legacy-node' }] }] },
      }],
    });

    expect(summary.timelines).toEqual([
      expect.objectContaining({ timelineId: 'rough-cut', itemCount: 1 }),
    ]);
  });

  it('recovers prompt, model, and upstream assets from the generated Canvas node when asset lineage is sparse', () => {
    const summary = buildAssetRelationSummary({
      assetId: 'asset-output',
      asset: { id: 'asset-output' },
      projectAssets: [
        { id: 'source-image', assetId: 'source-image', type: 'image', url: '/source.png', storageKey: 'source.png', createdAt: null },
      ],
      canvases: [{ id: 'main', name: 'Main', position: 0 }],
      nodes: [
        {
          id: 'output',
          canvasId: 'main',
          type: 'image',
          data: {
            assetId: 'asset-output',
            prompt: 'Turn the sketch into a film still',
            modelId: 'nano-banana-2',
            referenceImageAssetIds: ['source-image'],
          },
        },
      ],
      edges: [],
      timelines: [],
    });

    expect(summary.origin).toMatchObject({ canvasId: 'main', nodeId: 'output' });
    expect(summary.prompts).toContainEqual({ label: 'Prompt', value: 'Turn the sketch into a film still' });
    expect(summary.sourceModel).toBe('nano-banana-2');
    expect(summary.upstreamAssets).toEqual([
      expect.objectContaining({ assetId: 'source-image', role: 'reference', availableInProject: true }),
    ]);
  });

  it('does not invent an origin Canvas for an implicit asset placed there later', () => {
    const summary = buildAssetRelationSummary({
      assetId: 'implicit-edit',
      asset: {
        id: 'implicit-edit',
        sourceModel: 'implicit:image-editor',
        sourcePrompt: 'Crop and rotate',
      },
      projectAssets: [],
      canvases: [{ id: 'review', name: 'Review', position: 0 }],
      nodes: [
        { id: 'placement', canvasId: 'review', type: 'image', data: { assetId: 'implicit-edit' } },
      ],
      edges: [],
      timelines: [],
    });

    expect(summary.origin).toBeUndefined();
    expect(summary.canvases).toEqual([
      expect.objectContaining({ canvasId: 'review', role: 'placement' }),
    ]);
  });
});
