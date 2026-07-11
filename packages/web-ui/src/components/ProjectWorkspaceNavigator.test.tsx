// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspaceNavigator from './ProjectWorkspaceNavigator';

afterEach(cleanup);

describe('ProjectWorkspaceNavigator', () => {
    it('exposes concrete Canvas, standalone Timeline, and Asset surfaces', () => {
        const onSelectCanvas = vi.fn();
        const onSelectTimeline = vi.fn();
        const onSelectAssets = vi.fn();
        render(
            <ProjectWorkspaceNavigator
                canvases={[
                    { id: 'main', name: 'Main', position: 0 },
                    { id: 'shots', name: 'Shots', position: 1 },
                ]}
                standaloneTimelines={[
                    {
                        id: 'timeline-1',
                        name: 'Episode 1',
                        owner: { kind: 'project' },
                        revisionId: 'timeline-revision-v1:test',
                        state: { tracks: [] },
                    },
                ]}
                assets={[
                    {
                        id: 'asset-1',
                        url: '/asset-1.png',
                        type: 'image',
                        storageKey: 'asset-1.png',
                        createdAt: null,
                    },
                ]}
                surface={{ kind: 'canvas', canvasId: 'main' }}
                onSelectCanvas={onSelectCanvas}
                onSelectTimeline={onSelectTimeline}
                onSelectAssets={onSelectAssets}
                onCreateCanvas={vi.fn()}
                onRenameCanvas={vi.fn()}
                onDeleteCanvas={vi.fn()}
                onCreateTimeline={vi.fn()}
                onAttachTimeline={vi.fn()}
            />,
        );

        expect(screen.getByRole('tablist', { name: 'Project surfaces' })).toBeTruthy();
        const mainTab = screen.getByRole('tab', { name: 'Main' });
        expect(mainTab.getAttribute('aria-selected')).toBe('true');
        expect(mainTab.className).toContain('w-full');
        expect(mainTab.className).not.toContain('flex-1');
        expect(screen.getByRole('button', { name: 'Canvas actions for Main' }).className).toContain('absolute');
        expect(screen.getByRole('heading', { name: 'Library' })).toBeTruthy();

        fireEvent.click(screen.getByRole('tab', { name: 'Shots' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Episode 1' }));
        fireEvent.click(screen.getByRole('tab', { name: /Assets/ }));

        expect(onSelectCanvas).toHaveBeenCalledWith('shots');
        expect(onSelectTimeline).toHaveBeenCalledWith('timeline-1');
        expect(onSelectAssets).toHaveBeenCalledTimes(1);
        expect(screen.getByText('1')).toBeTruthy();
    });

    it('keeps an empty Timeline section quiet instead of spending space on a redundant message', () => {
        render(
            <ProjectWorkspaceNavigator
                canvases={[{ id: 'main', name: 'Main', position: 0 }]}
                standaloneTimelines={[]}
                assets={[]}
                surface={{ kind: 'canvas', canvasId: 'main' }}
                onSelectCanvas={vi.fn()}
                onSelectTimeline={vi.fn()}
                onSelectAssets={vi.fn()}
                onCreateCanvas={vi.fn()}
                onRenameCanvas={vi.fn()}
                onDeleteCanvas={vi.fn()}
                onCreateTimeline={vi.fn()}
                onAttachTimeline={vi.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Timelines' })).toBeTruthy();
        expect(screen.getByRole('button', { name: 'New Timeline' })).toBeTruthy();
        expect(screen.queryByText('No standalone timelines')).toBeNull();
    });

    it('filters project surfaces from a fixed-height sidebar search control', () => {
        render(
            <ProjectWorkspaceNavigator
                canvases={[
                    { id: 'main', name: 'Main', position: 0 },
                    { id: 'shots', name: 'Shots', position: 1 },
                ]}
                standaloneTimelines={[
                    {
                        id: 'timeline-1',
                        name: 'Episode 1',
                        owner: { kind: 'project' },
                        revisionId: 'timeline-revision-v1:test',
                        state: { tracks: [] },
                    },
                ]}
                assets={[]}
                surface={{ kind: 'canvas', canvasId: 'main' }}
                onSelectCanvas={vi.fn()}
                onSelectTimeline={vi.fn()}
                onSelectAssets={vi.fn()}
                onCreateCanvas={vi.fn()}
                onRenameCanvas={vi.fn()}
                onDeleteCanvas={vi.fn()}
                onCreateTimeline={vi.fn()}
                onAttachTimeline={vi.fn()}
            />,
        );

        const search = screen.getByRole('searchbox', { name: 'Search project' });
        expect(search.className).toContain('h-8');
        fireEvent.change(search, { target: { value: 'shots' } });

        expect(screen.getByRole('tab', { name: 'Shots' })).toBeTruthy();
        expect(screen.queryByRole('tab', { name: 'Main' })).toBeNull();
        expect(screen.queryByRole('tab', { name: 'Episode 1' })).toBeNull();
        expect(screen.queryByRole('tab', { name: /Assets/ })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
        expect(screen.getByRole('tab', { name: 'Main' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: 'Episode 1' })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Assets/ })).toBeTruthy();
    });
});
