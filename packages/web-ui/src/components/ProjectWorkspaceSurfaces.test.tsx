// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectAssetsSurface, ProjectTimelineEditorSurface } from './ProjectWorkspaceSurfaces';

vi.mock('@master-clash/remotion-ui', () => ({
    Editor: ({ initialState, stateRef, onBack, editorKey, layout }: any) => {
        stateRef.current = {
            compositionWidth: 1920,
            compositionHeight: 1080,
            fps: 30,
            durationInFrames: 90,
            tracks: initialState.tracks,
        };
        return (
            <div data-testid="remotion-editor" data-editor-key={editorKey} data-layout={layout}>
                <button type="button" onClick={onBack}>Back to project</button>
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

    it('opens a Project Timeline as the actual editor and persists edits on exit', async () => {
        const onSave = vi.fn(() => true);
        const onExit = vi.fn();
        render(
            <ProjectTimelineEditorSurface
                timeline={{
                    id: 'timeline-1',
                    name: 'Episode 1',
                    owner: { kind: 'project' },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                assets={[]}
                onSave={onSave}
                onExit={onExit}
            />,
        );

        const editor = await screen.findByTestId('remotion-editor');
        expect(editor.getAttribute('data-editor-key')).toBe('timeline-1');
        expect(editor.getAttribute('data-layout')).toBe('embedded');
        fireEvent.click(screen.getByRole('button', { name: 'Back to project' }));
        expect(onSave).toHaveBeenCalledWith('timeline-1', expect.objectContaining({
            tracks: [],
            compositionWidth: 1920,
            compositionHeight: 1080,
            fps: 30,
            durationInFrames: 90,
        }));
        expect(onExit).toHaveBeenCalledTimes(1);
    });
});
