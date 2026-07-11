// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectAssetsSurface, StandaloneTimelineSurface } from './ProjectWorkspaceSurfaces';

describe('Project workspace surfaces', () => {
    it('places a Project Asset onto the selected Canvas', () => {
        const onPlace = vi.fn();
        const asset = {
            id: 'asset-1',
            url: '/asset-1.png',
            type: 'image' as const,
            storageKey: 'asset-1.png',
            createdAt: null,
        };
        render(<ProjectAssetsSurface assets={[asset]} canvasName="Shots" onPlace={onPlace} />);
        fireEvent.click(screen.getByRole('button', { name: /Place/ }));
        expect(onPlace).toHaveBeenCalledWith(asset);
    });

    it('moves a standalone Timeline into the selected Canvas explicitly', () => {
        const onAttach = vi.fn();
        render(
            <StandaloneTimelineSurface
                timeline={{
                    id: 'timeline-1',
                    name: 'Episode 1',
                    owner: { kind: 'project' },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                canvasName="Main"
                onAttach={onAttach}
            />,
        );
        fireEvent.click(screen.getByRole('button', { name: /Move to Main/ }));
        expect(onAttach).toHaveBeenCalledTimes(1);
    });
});
