// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectAssetsSurface, ProjectTimelineEditorSurface } from './ProjectWorkspaceSurfaces';

vi.mock('@master-clash/remotion-ui', () => ({
    Editor: ({ initialState, stateRef, onBack, headerLeadingAction, editorKey, layout }: any) => {
        stateRef.current = {
            compositionWidth: 1920,
            compositionHeight: 1080,
            fps: 30,
            durationInFrames: 90,
            tracks: initialState.tracks,
        };
        return (
            <div
                data-testid="remotion-editor"
                data-editor-key={editorKey}
                data-layout={layout}
                data-has-back={String(Boolean(onBack))}
            >
                {headerLeadingAction}
            </div>
        );
    },
}));

describe('Project workspace surfaces', () => {
    it('adds a Project Asset to an explicit Canvas', async () => {
        const onAddToCanvas = vi.fn();
        const asset = {
            id: 'asset-1',
            url: '/asset-1.png',
            type: 'image' as const,
            storageKey: 'asset-1.png',
            createdAt: null,
        };
        render(
            <ProjectAssetsSurface
                assets={[asset]}
                canvases={[
                    { id: 'main', name: 'Main', position: 0 },
                    { id: 'shots', name: 'Shots', position: 1 },
                ]}
                onAddToCanvas={onAddToCanvas}
            />,
        );
        fireEvent.pointerDown(screen.getByRole('button', { name: 'Add asset-1 to canvas' }), {
            button: 0,
            ctrlKey: false,
        });
        fireEvent.click(await screen.findByRole('menuitem', { name: 'Shots' }));
        expect(onAddToCanvas).toHaveBeenCalledWith(asset, 'shots');
        expect(screen.queryByText(/Place on/)).toBeNull();
    });

    it('opens a Project-owned Timeline without inventing a back action and persists on unmount', async () => {
        const onSave = vi.fn(() => true);
        const { unmount } = render(
            <ProjectTimelineEditorSurface
                timeline={{
                    id: 'timeline-1',
                    name: 'Episode 1',
                    owner: { kind: 'project' },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                assets={[]}
                canvases={[{ id: 'main', name: 'Main', position: 0 }]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
            />,
        );

        const editor = await screen.findByTestId('remotion-editor');
        expect(editor.getAttribute('data-editor-key')).toBe('timeline-1');
        expect(editor.getAttribute('data-layout')).toBe('embedded');
        expect(editor.getAttribute('data-has-back')).toBe('false');
        expect(screen.queryByRole('button', { name: /parent Canvas/i })).toBeNull();
        unmount();
        expect(onSave).toHaveBeenCalledWith('timeline-1', expect.objectContaining({
            tracks: [],
            compositionWidth: 1920,
            compositionHeight: 1080,
            fps: 30,
            durationInFrames: 90,
        }));
    });

    it('gives a Canvas-owned Timeline one explicit action to open its parent Canvas', async () => {
        const onOpenCanvas = vi.fn();
        render(
            <ProjectTimelineEditorSurface
                timeline={{
                    id: 'timeline-2',
                    name: 'Trailer Cut',
                    owner: {
                        kind: 'canvas-action',
                        canvasId: 'shots',
                        actionNodeId: 'timeline-action-2',
                    },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                assets={[]}
                canvases={[
                    { id: 'main', name: 'Main', position: 0 },
                    { id: 'shots', name: 'Shots', position: 1 },
                ]}
                onSave={vi.fn(() => true)}
                onOpenCanvas={onOpenCanvas}
            />,
        );

        const editor = await screen.findByTestId('remotion-editor');
        expect(editor.getAttribute('data-has-back')).toBe('false');
        fireEvent.click(screen.getByRole('button', { name: 'Open parent Canvas Shots' }));
        expect(onOpenCanvas).toHaveBeenCalledWith('shots');
    });
});
