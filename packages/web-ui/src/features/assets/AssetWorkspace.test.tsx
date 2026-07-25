// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableProjectAssetSurface } from './AssetWorkspace';

vi.mock('../../lib/hooks/useAsset', () => ({
  useAsset: () => ({
    id: 'image-1',
    kind: 'image',
    srcR2Key: 'generated/image-1.png',
    coverR2Key: null,
    metadata: null,
    sourceModel: 'nano-banana-2',
    sourcePrompt: 'A paper city at sunrise',
    sourceTaskId: 'task-1',
    sources: [{ assetId: 'source-1', role: 'reference' }],
    createdAt: 1,
    updatedAt: 1,
  }),
}));

afterEach(cleanup);

describe('EditableProjectAssetSurface', () => {
  it('is the cohesive asset preview/edit entry point outside ProjectEditor', () => {
    render(
      <EditableProjectAssetSurface
        asset={{
          id: 'image-1',
          assetId: 'image-1',
          type: 'image',
          url: '/assets/image.png',
          storageKey: null,
          createdAt: null,
        }}
        projectId="project-1"
        onApplied={vi.fn()}
      />,
    );

    expect(screen.getByRole('main', { name: 'image-1 preview' })).toBeTruthy();
  });

  it('renders a docked provenance rail with navigable Canvas, Timeline, source, and prompt relations', () => {
    const onOpenCanvas = vi.fn();
    const onOpenTimeline = vi.fn();
    const onOpenAsset = vi.fn();
    render(
      <EditableProjectAssetSurface
        asset={{
          id: 'image-1', assetId: 'image-1', type: 'image', url: '/assets/image.png',
          storageKey: 'generated/image-1.png', createdAt: null,
        }}
        projectId="project-1"
        projectAssets={[
          { id: 'source-1', assetId: 'source-1', type: 'image', url: '/source.png', storageKey: 'inputs/source.png', createdAt: null },
        ]}
        canvases={[{ id: 'main', name: 'Main', position: 0 }]}
        timelines={[{
          id: 'trailer', name: 'Trailer', owner: { kind: 'project' }, revisionId: 'revision-1',
          state: { tracks: [{ items: [{ id: 'shot-1', assetId: 'image-1' }] }] },
        }]}
        relationNodes={[
          { id: 'generator', canvasId: 'main', type: 'action-badge', data: { prompt: 'A paper city at sunrise' } },
          { id: 'output', canvasId: 'main', type: 'image', data: { assetId: 'image-1' } },
        ]}
        relationEdges={[{ canvasId: 'main', source: 'generator', target: 'output' }]}
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
});
