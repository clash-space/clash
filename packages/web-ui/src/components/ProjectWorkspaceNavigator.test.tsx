// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ProjectWorkspaceNavigator from './ProjectWorkspaceNavigator';

afterEach(cleanup);

describe('ProjectWorkspaceNavigator', () => {
    it('collapses into a navigable icon rail and can expand again', () => {
        const onSelectCanvas = vi.fn();

        function CollapsibleNavigator() {
            const [collapsed, setCollapsed] = useState(false);
            return (
                <ProjectWorkspaceNavigator
                    collapsed={collapsed}
                    onCollapsedChange={setCollapsed}
                    canvases={[
                        { id: 'main', name: 'Main', position: 0 },
                        { id: 'shots', name: 'Shots', position: 1 },
                    ]}
                    timelines={[]}
                    assets={[]}
                    footer={<button type="button">Project settings</button>}
                    surface={{ kind: 'canvas', canvasId: 'main' }}
                    onSelectCanvas={onSelectCanvas}
                    onSelectTimeline={vi.fn()}
                    onSelectAssets={vi.fn()}
                    onCreateCanvas={vi.fn()}
                    onRenameCanvas={vi.fn()}
                    onDeleteCanvas={vi.fn()}
                    onCreateTimeline={vi.fn()}
                    onAttachTimeline={vi.fn()}
                />
            );
        }

        render(<CollapsibleNavigator />);

        const navigator = screen.getByRole('complementary', { name: 'Project navigator' });
        expect(navigator.getAttribute('data-collapsed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Project settings' })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Collapse project sidebar' }));

        expect(navigator.getAttribute('data-collapsed')).toBe('true');
        expect(screen.getByRole('button', { name: 'Expand project sidebar' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Project settings' })).toBeNull();
        expect(screen.getByRole('tab', { name: 'Main' }).className).toContain('justify-center');
        expect(screen.getByRole('button', { name: 'Search project' }).className).toContain('w-8');

        fireEvent.click(screen.getByRole('tab', { name: 'Shots' }));
        expect(onSelectCanvas).toHaveBeenCalledWith('shots');

        fireEvent.click(screen.getByRole('button', { name: 'Expand project sidebar' }));
        expect(navigator.getAttribute('data-collapsed')).toBe('false');
        expect(screen.getByRole('button', { name: 'Project settings' })).toBeTruthy();
    });

    it('exposes concrete Canvas, Timeline editor documents, and Asset surfaces', () => {
        const onSelectCanvas = vi.fn();
        const onSelectTimeline = vi.fn();
        const onSelectAssets = vi.fn();
        render(
            <ProjectWorkspaceNavigator
                canvases={[
                    { id: 'main', name: 'Main', position: 0 },
                    { id: 'shots', name: 'Shots', position: 1 },
                ]}
                timelines={[
                    {
                        id: 'timeline-1',
                        name: 'Episode 1',
                        owner: { kind: 'project' },
                        revisionId: 'timeline-revision-v1:test',
                        state: { tracks: [] },
                    },
                    {
                        id: 'timeline-2',
                        name: 'Trailer Cut',
                        owner: {
                            kind: 'canvas-action',
                            canvasId: 'main',
                            actionNodeId: 'timeline-action-2',
                        },
                        revisionId: 'timeline-revision-v1:attached',
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
                footer={<button type="button">Project settings</button>}
                assetCount={12}
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
        expect(screen.queryByRole('heading', { name: 'Library' })).toBeNull();
        const projectControls = screen.getByRole('group', { name: 'Project controls' });
        expect(projectControls.contains(screen.getByRole('button', { name: 'Project settings' }))).toBe(true);

        fireEvent.click(screen.getByRole('tab', { name: 'Shots' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Episode 1' }));
        fireEvent.click(screen.getByRole('tab', { name: 'Trailer Cut' }));
        fireEvent.click(screen.getByRole('tab', { name: /Assets/ }));

        expect(onSelectCanvas).toHaveBeenCalledWith('shots');
        expect(onSelectTimeline).toHaveBeenCalledWith('timeline-1');
        expect(onSelectTimeline).toHaveBeenCalledWith('timeline-2');
        expect(onSelectAssets).toHaveBeenCalledTimes(1);
        expect(screen.getByText('12')).toBeTruthy();
    });

    it('keeps Assets as a direct project surface until another library type exists', () => {
        render(
            <ProjectWorkspaceNavigator
                canvases={[{ id: 'main', name: 'Main', position: 0 }]}
                timelines={[]}
                assets={[]}
                assetCount={3}
                surface={{ kind: 'assets' }}
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

        expect(screen.queryByRole('heading', { name: 'Library' })).toBeNull();
        expect(screen.getByRole('tab', { name: 'Assets (3)' })).toBeTruthy();
    });

    it('keeps an empty Timeline section quiet instead of spending space on a redundant message', () => {
        render(
            <ProjectWorkspaceNavigator
                canvases={[{ id: 'main', name: 'Main', position: 0 }]}
                timelines={[]}
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

    it('opens project navigation from a Cmd-K command palette without filtering the sidebar itself', () => {
        const onSelectCanvas = vi.fn();
        render(
            <ProjectWorkspaceNavigator
                canvases={[
                    { id: 'main', name: 'Main', position: 0 },
                    { id: 'shots', name: 'Shots', position: 1 },
                ]}
                timelines={[
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
                onSelectCanvas={onSelectCanvas}
                onSelectTimeline={vi.fn()}
                onSelectAssets={vi.fn()}
                onCreateCanvas={vi.fn()}
                onRenameCanvas={vi.fn()}
                onDeleteCanvas={vi.fn()}
                onCreateTimeline={vi.fn()}
                onAttachTimeline={vi.fn()}
            />,
        );

        const trigger = screen.getByRole('button', { name: 'Search project' });
        expect(trigger.className).toContain('h-8');
        expect(screen.getByText('⌘K')).toBeTruthy();
        expect(screen.queryByRole('combobox', { name: 'Search project' })).toBeNull();

        fireEvent.keyDown(window, { key: 'k', metaKey: true });

        const search = screen.getByRole('combobox', { name: 'Search project' });
        fireEvent.change(search, { target: { value: 'shots' } });

        expect(document.getElementById('project-canvas-main')).toBeTruthy();
        expect(document.getElementById('project-timeline-timeline-1')).toBeTruthy();
        expect(screen.getByRole('option', { name: 'Shots Canvas' })).toBeTruthy();
        expect(screen.queryByRole('option', { name: 'Main Canvas' })).toBeNull();

        fireEvent.click(screen.getByRole('option', { name: 'Shots Canvas' }));
        expect(onSelectCanvas).toHaveBeenCalledWith('shots');
        expect(screen.queryByRole('combobox', { name: 'Search project' })).toBeNull();
    });
});
