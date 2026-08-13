// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditableProjectAssetSurface } from './AssetWorkspace';

vi.mock('../../lib/hooks/useAsset', () => ({
  useAsset: () => ({
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
  }),
}));

afterEach(cleanup);

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

  it('sets and clears the explicit Project Asset cover id through the host callback', () => {
    const onProjectCoverChange = vi.fn();
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
        onProjectCoverChange={onProjectCoverChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use as project cover' }));
    expect(onProjectCoverChange).toHaveBeenCalledWith(true);
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
