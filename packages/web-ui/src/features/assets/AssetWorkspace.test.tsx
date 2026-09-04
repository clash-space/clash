// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableProjectAssetSurface } from './AssetWorkspace';

const assetProjection = vi.hoisted(() => ({
  current: {
    id: 'image-1',
    kind: 'image',
    url: 'https://media.clash.test/assets/image-1',
    metadata: {},
    lifecycle: { state: 'active' },
    status: 'ready',
    provenance: {
      kind: 'generation',
      model: 'nano-banana-2',
      prompt: 'A paper city at sunrise',
    },
  } as any,
}));

vi.mock('../../lib/hooks/useAsset', () => ({
  useAsset: () => assetProjection.current,
}));

afterEach(() => {
  cleanup();
  assetProjection.current = {
    id: 'image-1',
    kind: 'image',
    url: 'https://media.clash.test/assets/image-1',
    metadata: {},
    lifecycle: { state: 'active' },
    status: 'ready',
    provenance: {
      kind: 'generation',
      model: 'nano-banana-2',
      prompt: 'A paper city at sunrise',
    },
  };
});

describe('EditableProjectAssetSurface', () => {
  it('is the cohesive asset preview/edit entry point outside ProjectEditor', () => {
    render(
      <EditableProjectAssetSurface
        asset={{
          id: 'image-1',
          kind: 'image',
          url: 'https://media.clash.test/assets/image-1',
          metadata: {},
          lifecycle: { state: 'active' },
          status: 'ready',
        }}
        projectId="project-1"
        onApplied={vi.fn()}
      />,
    );

    expect(screen.getByRole('main', { name: 'image-1 preview' })).toBeTruthy();
  });

  it('does not offer a manual project cover control', () => {
    render(
      <EditableProjectAssetSurface
        asset={{
          id: 'image-1',
          kind: 'image',
          url: 'https://media.clash.test/assets/image-1',
          metadata: {},
          lifecycle: { state: 'active' },
          status: 'ready',
        }}
        projectId="project-1"
        onApplied={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Use as project cover' })).toBeNull();
  });

  it('renders a docked provenance rail with navigable Canvas, Timeline, source, and prompt relations', () => {
    const onOpenCanvas = vi.fn();
    const onOpenTimeline = vi.fn();
    const onOpenAsset = vi.fn();
    render(
      <EditableProjectAssetSurface
        asset={{
          id: 'image-1', kind: 'image', url: 'https://media.clash.test/assets/image-1',
          metadata: {}, lifecycle: { state: 'active' }, status: 'ready',
        }}
        projectId="project-1"
        projectAssets={[
          { id: 'source-1', name: 'source.png', kind: 'image', url: 'https://media.clash.test/assets/source-1', metadata: {}, lifecycle: { state: 'active' }, status: 'ready' },
        ]}
        canvases={[{ id: 'main', name: 'Main', position: 0 }]}
        timelines={[{
          id: 'trailer', name: 'Trailer', owner: { kind: 'project' }, revisionId: 'revision-1',
          state: { tracks: [{ items: [{ id: 'shot-1', assetId: 'image-1' }] }] },
        }]}
        relationNodes={[
          { id: 'generator', canvasId: 'main', type: 'action-badge', data: { prompt: 'A paper city at sunrise', referenceImageAssetIds: ['source-1'] } },
          { id: 'output', canvasId: 'main', type: 'image', data: { assetId: 'image-1' } },
        ]}
        relationEdges={[{ canvasId: 'main', source: 'generator', target: 'output' }]}
        relationBindings={[
          {
            id: 'generation-output',
            owner: {
              kind: 'run',
              actionId: 'node:generator',
              actionRevisionId: 'revision-1',
              actionRunId: 'run-1',
            },
            direction: 'output',
            slot: 'output',
            projectAssetId: 'image-1',
          },
          {
            id: 'generation-input',
            owner: {
              kind: 'run',
              actionId: 'node:generator',
              actionRevisionId: 'revision-1',
              actionRunId: 'run-1',
            },
            direction: 'input',
            slot: 'reference:0',
            projectAssetId: 'source-1',
            role: 'reference',
          },
          {
            id: 'timeline-input',
            owner: { kind: 'draft', actionId: 'timeline:trailer' },
            direction: 'input',
            slot: 'timeline:item:shot-1',
            projectAssetId: 'image-1',
          },
        ]}
        onOpenCanvas={onOpenCanvas}
        onOpenTimeline={onOpenTimeline}
        onOpenAsset={onOpenAsset}
        onApplied={vi.fn()}
      />,
    );

    expect(screen.getByRole('complementary', { name: 'Asset relations' })).toBeTruthy();
    expect(screen.getByText('A paper city at sunrise')).toBeTruthy();
    expect(screen.getByText('nano-banana-2')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Open origin Canvas Main' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Timeline Trailer' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open source asset source.png' }));

    expect(onOpenCanvas).toHaveBeenCalledWith('main', 'output');
    expect(onOpenTimeline).toHaveBeenCalledWith('trailer');
    expect(onOpenAsset).toHaveBeenCalledWith('source-1');
  });

  it('uses a fresh Host projection for preview and disables byte-dependent actions while unavailable', () => {
    assetProjection.current = {
      id: 'image-1',
      kind: 'image',
      metadata: { originalName: 'remote.png' },
      lifecycle: { state: 'active' },
      status: 'downloading',
      progress: 0.3,
    };

    render(
      <EditableProjectAssetSurface
        asset={{
          id: 'image-1',
          kind: 'image',
          url: 'https://stale.example/remote.png',
          metadata: {},
          lifecycle: { state: 'active' },
          status: 'ready',
        }}
        projectId="project-1"
        onApplied={vi.fn()}
      />,
    );

    expect(screen.getByText('Downloading 30%')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'remote.png' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use as project cover' })).toBeNull();
  });
});
