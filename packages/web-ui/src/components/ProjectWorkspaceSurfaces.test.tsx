// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { projectTimelineReadToken } from '@clash/shared-types';
import { ProjectAssetSurface, ProjectTimelineEditorSurface } from './ProjectWorkspaceSurfaces';

const assetApi = vi.hoisted(() => ({
    getAsset: vi.fn(),
    getSignedUrl: vi.fn(),
}));
const timelineEditorApi = vi.hoisted(() => ({
    onTranscribeAsset: undefined as undefined | ((asset: any) => Promise<any>),
    onExport: undefined as undefined | (() => Promise<void>),
}));

vi.mock('@clash/web-ui/lib/hooks/useAsset', () => ({ getAsset: assetApi.getAsset }));
vi.mock('@clash/web-ui/lib/hooks/useSignedUrl', () => ({ getSignedUrl: assetApi.getSignedUrl }));

vi.mock('@clash/remotion-ui', () => ({
    Editor: ({ initialState, initialAssets, insertAssetRequest, onInsertAssetRequestHandled, stateRef, onStateChange, onBack, onRequestAsset, onTranscribeAsset, onExport, headerLeadingAction, editorKey, layout, projectAssetDropActive }: any) => {
        timelineEditorApi.onTranscribeAsset = onTranscribeAsset;
        timelineEditorApi.onExport = onExport;
        stateRef.current = {
            compositionWidth: 1920,
            compositionHeight: 1080,
            fps: 30,
            durationInFrames: initialState.durationInFrames ?? 90,
            tracks: initialState.tracks,
            primaryTrackId: initialState.primaryTrackId ?? null,
            assetTranscripts: initialState.assetTranscripts ?? {},
        };
        useEffect(() => {
            onStateChange?.(stateRef.current);
        }, [editorKey, onStateChange]);
        return (
            <div
                data-testid="remotion-editor"
                data-editor-key={editorKey}
                data-duration={String(stateRef.current.durationInFrames)}
                data-layout={layout}
                data-has-back={String(Boolean(onBack))}
                data-asset-count={String(initialAssets?.length ?? 0)}
                data-asset-name={initialAssets?.[0]?.name ?? ''}
                data-asset-source={initialAssets?.[0]?.sourceNodeId ?? ''}
                data-asset-thumbnail={initialAssets?.[0]?.thumbnail ?? ''}
                data-has-scoped-picker={String(Boolean(onRequestAsset))}
                data-insert-request={insertAssetRequest?.requestId ?? ''}
                data-project-asset-drop-active={String(Boolean(projectAssetDropActive))}
            >
                {headerLeadingAction}
                <button
                    type="button"
                    onClick={() => {
                        const nextState = {
                            ...stateRef.current,
                            durationInFrames: 120,
                        };
                        stateRef.current = nextState;
                        onStateChange?.(nextState);
                    }}
                >
                    Apply editor mutation
                </button>
                {onExport ? <button type="button" onClick={() => void onExport()}>Export video</button> : null}
                {insertAssetRequest ? (
                    <button
                        type="button"
                        onClick={() => onInsertAssetRequestHandled?.(insertAssetRequest.requestId)}
                    >
                        Consume insert request
                    </button>
                ) : null}
            </div>
        );
    },
}));

describe('Project workspace surfaces', () => {
  it('reserves a compact Asset header slot for the collapsed Copilot avatar', () => {
    const { container } = render(
      <ProjectAssetSurface
        asset={{ id: 'asset-header', type: 'image', url: '/header.png', storageKey: 'header.png', createdAt: 1 }}
        headerEndInset={40}
      />,
    );

    expect(container.querySelector('header')?.style.paddingRight).toBe('40px');
  });

    afterEach(() => {
        cleanup();
        assetApi.getAsset.mockReset();
        assetApi.getSignedUrl.mockReset();
        globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
        timelineEditorApi.onTranscribeAsset = undefined;
        timelineEditorApi.onExport = undefined;
        vi.unstubAllGlobals();
    });

    it('shows one selected Project Asset directly instead of an aggregate Assets page', () => {
        const asset = {
            id: 'asset-1',
            url: '/asset-1.png',
            type: 'image' as const,
            storageKey: 'asset-1.png',
            createdAt: null,
        };
        render(
            <ProjectAssetSurface asset={asset} />,
        );

        expect(screen.getByRole('main', { name: 'asset-1.png preview' })).toBeTruthy();
        expect(screen.getByRole('img', { name: 'asset-1.png' }).getAttribute('src')).toBe('/asset-1.png');
        expect(screen.queryByRole('heading', { name: 'Assets' })).toBeNull();
        expect(screen.queryByText('1 project assets')).toBeNull();
    });

    it('routes relative project asset URLs through the desktop local API', () => {
        globalThis.__CLASH_RUNTIME_CONFIG__ = {
            mode: 'desktop',
            apiBaseUrl: 'http://127.0.0.1:49321',
        };

        render(<ProjectAssetSurface asset={{
            id: 'asset-local',
            url: '/assets/uploads/local.JPG',
            type: 'image',
            storageKey: 'uploads/local.JPG',
            createdAt: null,
        }} />);

        expect(screen.getByRole('img', { name: 'local.JPG' }).getAttribute('src')).toBe(
            'http://127.0.0.1:49321/assets/uploads/local.JPG',
        );
    });

    it('renders audio project assets with native playback controls', () => {
        const { container } = render(<ProjectAssetSurface asset={{
            id: 'asset-audio',
            url: '/assets/generated/voice.wav',
            type: 'audio' as any,
            storageKey: 'generated/voice.wav',
            createdAt: null,
        }} />);

        const audio = container.querySelector('audio');
        expect(audio).toBeTruthy();
        expect(audio?.getAttribute('src')).toBe('/assets/generated/voice.wav');
        expect(audio?.hasAttribute('controls')).toBe(true);
        expect(screen.queryByRole('img', { name: 'voice.wav' })).toBeNull();
    });

    it('provides precise zoom controls for image assets', () => {
        render(<ProjectAssetSurface asset={{
            id: 'asset-zoom',
            url: '/assets/uploads/zoom.png',
            type: 'image',
            storageKey: 'uploads/zoom.png',
            createdAt: null,
        }} />);

        const image = screen.getByRole('img', { name: 'zoom.png' });
        fireEvent.load(image);

        expect(screen.getByText('100%')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
        expect(screen.getByText('125%')).toBeTruthy();
        expect(image.getAttribute('style')).toContain('scale(1.25)');

        fireEvent.click(screen.getByRole('button', { name: 'Actual size' }));
        expect(screen.getByText('100%')).toBeTruthy();
    });

    it('zooms around the image with the mouse wheel and exposes a fit action', () => {
        render(<ProjectAssetSurface asset={{
            id: 'asset-wheel',
            url: '/assets/uploads/wheel.png',
            type: 'image',
            storageKey: 'uploads/wheel.png',
            createdAt: null,
        }} />);

        const image = screen.getByRole('img', { name: 'wheel.png' });
        fireEvent.load(image);
        fireEvent.wheel(screen.getByTestId('project-image-preview-stage'), { deltaY: -100 });

        expect(screen.getByText('125%')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Fit image' })).toBeTruthy();
    });

    it('switches the same asset workspace from preview to an inline editor', () => {
        const renderEditor = vi.fn((_metadata, close: () => void) => (
            <div aria-label="Inline image editor">
                <button type="button" onClick={close}>Back to preview</button>
            </div>
        ));
        const { rerender, container } = render(<ProjectAssetSurface asset={{
            id: 'asset-edit-image',
            assetId: 'backing-image',
            url: '/assets/uploads/edit.png',
            type: 'image',
            storageKey: 'uploads/edit.png',
            createdAt: null,
        }} renderEditor={renderEditor} />);

        const image = screen.getByRole('img', { name: 'edit.png' });
        Object.defineProperty(image, 'naturalWidth', { value: 1600 });
        Object.defineProperty(image, 'naturalHeight', { value: 900 });
        fireEvent.load(image);
        fireEvent.click(screen.getByRole('button', { name: 'Edit image' }));
        expect(renderEditor).toHaveBeenCalledWith(
            { naturalWidth: 1600, naturalHeight: 900 },
            expect.any(Function),
        );
        expect(screen.getByLabelText('Inline image editor')).toBeTruthy();
        expect(screen.getByRole('main', { name: 'edit.png editor' })).toBeTruthy();
        expect(screen.queryByRole('dialog')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Back to preview' }));
        expect(screen.getByRole('main', { name: 'edit.png preview' })).toBeTruthy();

        const renderVideoEditor = vi.fn(() => <div aria-label="Inline video editor" />);
        rerender(<ProjectAssetSurface asset={{
            id: 'asset-edit-video',
            assetId: 'backing-video',
            url: '/assets/uploads/edit.mp4',
            type: 'video',
            storageKey: 'uploads/edit.mp4',
            createdAt: null,
        }} renderEditor={renderVideoEditor} />);
        const video = container.querySelector('video')!;
        Object.defineProperty(video, 'duration', { value: 12.5 });
        fireEvent.loadedMetadata(video);
        fireEvent.click(screen.getByRole('button', { name: 'Edit video' }));
        expect(renderVideoEditor).toHaveBeenCalledWith({ durationSec: 12.5 }, expect.any(Function));
        expect(screen.getByLabelText('Inline video editor')).toBeTruthy();
    });

    it('opens a Project-owned Timeline without inventing a back action or rewriting unchanged state on unmount', async () => {
        const onSave = vi.fn(() => true);
        const timeline = {
            id: 'timeline-1',
            name: 'Episode 1',
            owner: { kind: 'project' as const },
            revisionId: 'timeline-revision-v1:test',
            state: { tracks: [], mediaAssetRefs: [{ assetId: 'asset-opening' }] },
        };
        const { unmount } = render(
            <ProjectTimelineEditorSurface
                timeline={timeline}
                mediaInputs={[{
                    sourceNodeId: 'source-opening',
                    backingAssetId: 'asset-opening',
                    type: 'image',
                    src: '/opening.png',
                    displayName: 'Opening frame',
                }]}
                canvases={[{ id: 'main', name: 'Main', position: 0 }]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
                onRequestAsset={vi.fn()}
                rightInset={328}
            />,
        );

        const surface = screen.getByTestId('project-timeline-editor');
        const content = screen.getByTestId('project-timeline-editor-content');
        expect(surface.style.right).toBe('');
        expect(content.style.right).toBe(
            'calc(328px - var(--clash-project-chrome-gutter, 0.5rem))',
        );

        const loading = screen.getByRole('status', { name: 'Preparing timeline' });
        expect(loading.getAttribute('data-timeline-loading-shell')).toBe('');
        expect(loading.querySelector('[data-loading-region="media"]')).toBeTruthy();
        expect(loading.querySelector('[data-loading-region="preview"]')).toBeTruthy();
        expect(loading.querySelector('[data-loading-region="timeline"]')).toBeTruthy();

        const editor = await screen.findByTestId('remotion-editor');
        expect(editor.getAttribute('data-editor-key')).toBe('timeline-1:timeline-revision-v1:test');
        expect(editor.getAttribute('data-layout')).toBe('embedded');
        expect(editor.getAttribute('data-has-back')).toBe('false');
        expect(editor.getAttribute('data-asset-count')).toBe('1');
        expect(editor.getAttribute('data-asset-name')).toBe('Opening frame');
        expect(editor.getAttribute('data-asset-source')).toBe('source-opening');
        expect(editor.getAttribute('data-has-scoped-picker')).toBe('true');
        expect(screen.queryByRole('button', { name: /parent Canvas/i })).toBeNull();
        unmount();
        expect(onSave).not.toHaveBeenCalled();
    });

    it('persists editor mutations without requiring export or navigation', async () => {
        const onSave = vi.fn(() => true);
        const timeline = {
            id: 'timeline-autosave',
            name: 'Autosave Cut',
            owner: { kind: 'project' as const },
            revisionId: 'timeline-revision-v1:test',
            state: { tracks: [] },
        };
        render(
            <ProjectTimelineEditorSurface
                timeline={timeline}
                mediaInputs={[]}
                canvases={[]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
            />,
        );

        await screen.findByTestId('remotion-editor');
        fireEvent.click(screen.getByRole('button', { name: 'Apply editor mutation' }));

        await waitFor(() => expect(onSave).toHaveBeenCalledWith(
            'timeline-autosave',
            expect.objectContaining({ durationInFrames: 120 }),
            projectTimelineReadToken(timeline),
        ));
    });

    it('persists the current Timeline before requesting a backend export', async () => {
        const events: string[] = [];
        const onSave = vi.fn(() => {
            events.push('save');
            return true;
        });
        const onExport = vi.fn(async () => {
            events.push('export');
        });
        render(
            <ProjectTimelineEditorSurface
                timeline={{
                    id: 'timeline-backend-export',
                    name: 'Backend Cut',
                    owner: { kind: 'project' },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                mediaInputs={[]}
                canvases={[]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
                onExport={onExport}
            />,
        );

        await screen.findByTestId('remotion-editor');
        fireEvent.click(screen.getByRole('button', { name: 'Apply editor mutation' }));
        fireEvent.click(screen.getByRole('button', { name: 'Export video' }));

        await waitFor(() => expect(onExport).toHaveBeenCalledWith('timeline-backend-export'));
        expect(events).toEqual(['save', 'export']);
    });

    it('reloads a clean editor when an external Timeline revision arrives without writing the stale snapshot', async () => {
        const onSave = vi.fn(() => true);
        const baseTimeline = {
            id: 'timeline-live-revision',
            name: 'Live Revision',
            owner: { kind: 'project' as const },
            revisionId: 'timeline-revision-v1:base',
            state: { tracks: [], durationInFrames: 90 },
        };
        const { rerender } = render(
            <ProjectTimelineEditorSurface
                timeline={baseTimeline}
                mediaInputs={[]}
                canvases={[]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
            />,
        );

        const initialEditor = await screen.findByTestId('remotion-editor');
        expect(initialEditor.getAttribute('data-editor-key')).toBe(
            'timeline-live-revision:timeline-revision-v1:base',
        );
        expect(initialEditor.getAttribute('data-duration')).toBe('90');

        rerender(
            <ProjectTimelineEditorSurface
                timeline={{
                    ...baseTimeline,
                    revisionId: 'timeline-revision-v1:agent-apply',
                    state: { tracks: [], durationInFrames: 980 },
                }}
                mediaInputs={[]}
                canvases={[]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
            />,
        );

        await waitFor(() => {
            const refreshedEditor = screen.getByTestId('remotion-editor');
            expect(refreshedEditor.getAttribute('data-editor-key')).toBe(
                'timeline-live-revision:timeline-revision-v1:agent-apply',
            );
            expect(refreshedEditor.getAttribute('data-duration')).toBe('980');
        });
        expect(onSave).not.toHaveBeenCalled();
    });

    it('paints the loading shell before mounting an already-warmed Timeline editor', async () => {
        const warmTimeline = {
            id: 'timeline-warmup',
            name: 'Warmup',
            owner: { kind: 'project' as const },
            revisionId: 'timeline-revision-v1:warmup',
            state: { tracks: [] },
        };
        const warmRender = render(
            <ProjectTimelineEditorSurface
                timeline={warmTimeline}
                mediaInputs={[]}
                canvases={[]}
                onSave={vi.fn(() => true)}
                onOpenCanvas={vi.fn()}
            />,
        );
        await screen.findByTestId('remotion-editor');
        warmRender.unmount();

        const animationFrames: FrameRequestCallback[] = [];
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            animationFrames.push(callback);
            return animationFrames.length;
        }));
        vi.stubGlobal('cancelAnimationFrame', vi.fn());

        render(
            <ProjectTimelineEditorSurface
                timeline={{
                    ...warmTimeline,
                    id: 'timeline-after-warmup',
                    name: 'After warmup',
                    revisionId: 'timeline-revision-v1:after-warmup',
                }}
                mediaInputs={[]}
                canvases={[]}
                onSave={vi.fn(() => true)}
                onOpenCanvas={vi.fn()}
            />,
        );

        expect(screen.getByRole('status', { name: 'Preparing timeline' })).toBeTruthy();
        expect(screen.queryByTestId('remotion-editor')).toBeNull();
        expect(animationFrames).toHaveLength(1);

        act(() => animationFrames.shift()?.(0));
        expect(screen.getByRole('status', { name: 'Preparing timeline' })).toBeTruthy();
        expect(screen.queryByTestId('remotion-editor')).toBeNull();
        expect(animationFrames).toHaveLength(1);

        act(() => animationFrames.shift()?.(16));
        expect((await screen.findByTestId('remotion-editor')).getAttribute('data-editor-key'))
            .toBe('timeline-after-warmup:timeline-revision-v1:after-warmup');
    });

    it('persists the canonical Canvas placement after a native sidebar drop without moving the clip', async () => {
        const onSave = vi.fn(() => true);
        const timeline = {
            id: 'timeline-canvas-drop-save',
            name: 'Canvas Drop Save',
            owner: {
                kind: 'canvas-action' as const,
                canvasId: 'main',
                actionNodeId: 'timeline-action',
            },
            revisionId: 'timeline-revision-v1:test',
            state: {
                tracks: [{
                    id: 'track-1',
                    name: 'Image',
                    items: [{
                        id: 'clip-1',
                        type: 'image',
                        assetId: 'asset-image',
                        sourceNodeId: 'asset-image-project-ref',
                        src: '/image.png',
                        from: 73,
                        durationInFrames: 90,
                    }],
                }],
            },
        };
        const { rerender } = render(
            <ProjectTimelineEditorSurface
                timeline={timeline}
                mediaInputs={[{
                    sourceNodeId: 'asset-image-project-ref',
                    backingAssetId: 'asset-image',
                    type: 'image',
                    src: '/image.png',
                }]}
                canvases={[{ id: 'main', name: 'Main', position: 0 }]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
            />,
        );

        await screen.findByTestId('remotion-editor');
        rerender(
            <ProjectTimelineEditorSurface
                timeline={timeline}
                mediaInputs={[{
                    sourceNodeId: 'canvas-image-placement',
                    backingAssetId: 'asset-image',
                    type: 'image',
                    src: '/image.png',
                }]}
                canvases={[{ id: 'main', name: 'Main', position: 0 }]}
                onSave={onSave}
                onOpenCanvas={vi.fn()}
            />,
        );

        await waitFor(() => expect(onSave).toHaveBeenCalledWith(
            'timeline-canvas-drop-save',
            expect.objectContaining({
                tracks: [expect.objectContaining({
                    items: [expect.objectContaining({
                        assetId: 'asset-image',
                        sourceNodeId: 'canvas-image-placement',
                        from: 73,
                    })],
                })],
            }),
            projectTimelineReadToken(timeline),
        ));
    });

    it('animates Timeline inset only when chat opens or closes', () => {
        const timeline = {
            id: 'timeline-inset-motion',
            name: 'Motion Cut',
            owner: { kind: 'project' as const },
            revisionId: 'timeline-revision-v1:test',
            state: { tracks: [] },
        };
        const props = {
            timeline,
            mediaInputs: [],
            canvases: [],
            onSave: vi.fn(() => true),
            onOpenCanvas: vi.fn(),
        };
        const { rerender } = render(
            <ProjectTimelineEditorSurface {...props} rightInset={328} />,
        );
        const content = screen.getByTestId('project-timeline-editor-content');

        expect(content.style.transition).toBe('none');

        rerender(<ProjectTimelineEditorSurface {...props} rightInset={8} />);
        expect(content.style.right).toBe(
            'calc(8px - var(--clash-project-chrome-gutter, 0.5rem))',
        );
        expect(content.style.transition).toContain('240ms');
        expect(content.style.transition).toContain('cubic-bezier(0.22, 1, 0.36, 1)');

        rerender(<ProjectTimelineEditorSurface {...props} rightInset={300} />);
        expect(content.style.transition).toContain('240ms');

        rerender(<ProjectTimelineEditorSurface {...props} rightInset={340} />);
        expect(content.style.transition).toBe('none');
    });

    it('hydrates connected Timeline media with its cover thumbnail and business name', async () => {
        assetApi.getAsset.mockResolvedValue({
            id: 'asset-video',
            kind: 'video',
            srcR2Key: 'projects/private/video.mp4',
            coverR2Key: 'projects/private/video-cover.webp',
            metadata: { originalName: 'Launch cut', durationMs: 3200 },
        });
        assetApi.getSignedUrl.mockImplementation(async (key: string) => `/signed/${key}`);

        render(<ProjectTimelineEditorSurface
            timeline={{
                id: 'timeline-thumbnail',
                name: 'Thumbnail Cut',
                owner: { kind: 'project' },
                revisionId: 'timeline-revision-v1:test',
                state: { tracks: [] },
            }}
            mediaInputs={[{
                sourceNodeId: 'source-video',
                backingAssetId: 'asset-video',
                type: 'video',
                src: '/initial/video.mp4',
            }]}
            canvases={[]}
            onSave={vi.fn(() => true)}
            onOpenCanvas={vi.fn()}
        />);

        await waitFor(() => {
            const editor = screen.getByTestId('remotion-editor');
            expect(editor.getAttribute('data-asset-name')).toBe('Launch cut');
            expect(editor.getAttribute('data-asset-thumbnail')).toBe('/signed/projects/private/video-cover.webp');
        });
    });

    it('backs the Transcript button with the local word-aligned ASR endpoint', async () => {
        const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url === '/signed/projects/private/talk.mp4') {
                return new Response('media-bytes', {
                    status: 200,
                    headers: { 'content-type': 'video/mp4' },
                });
            }
            if (url === '/api/v1/local/audio/transcriptions') {
                return Response.json({
                    schemaVersion: 1,
                    kind: 'clash.asr.timed-transcript',
                    timebase: 'milliseconds',
                    alignment: 'word',
                    text: '大家好',
                    backendId: 'funasr',
                    modelId: 'iic/SenseVoiceSmall',
                    language: 'zh',
                    durationMs: 600,
                    words: [
                        { id: 'w1', text: '大家', startMs: 0, endMs: 300 },
                        { id: 'w2', text: '好', startMs: 300, endMs: 600 },
                    ],
                    segments: [],
                });
            }
            return new Response('not found', { status: 404 });
        });
        vi.stubGlobal('fetch', fetchMock);
        assetApi.getAsset.mockResolvedValue({
            id: 'asset-video',
            kind: 'video',
            srcR2Key: 'projects/private/talk.mp4',
            metadata: { originalName: 'Talking head', durationMs: 600 },
        });
        assetApi.getSignedUrl.mockResolvedValue('/signed/projects/private/talk.mp4');

        render(<ProjectTimelineEditorSurface
            timeline={{
                id: 'timeline-transcript',
                name: 'Transcript Cut',
                owner: { kind: 'project' },
                revisionId: 'timeline-revision-v1:test',
                state: { tracks: [] },
            }}
            mediaInputs={[{
                sourceNodeId: 'source-video',
                backingAssetId: 'asset-video',
                type: 'video',
                src: '/initial/talk.mp4',
            }]}
            canvases={[]}
            onSave={vi.fn(() => true)}
            onOpenCanvas={vi.fn()}
        />);

        await screen.findByTestId('remotion-editor');
        await waitFor(() => expect(timelineEditorApi.onTranscribeAsset).toBeTypeOf('function'));
        const transcript = await timelineEditorApi.onTranscribeAsset!({
            id: 'source-video',
            backingAssetId: 'asset-video',
            name: 'Talking head',
            type: 'video',
            src: '/signed/projects/private/talk.mp4',
            createdAt: 0,
        });

        expect(transcript).toMatchObject({
            schemaVersion: 1,
            kind: 'clash.editor.asset-transcript',
            assetId: 'asset-video',
            text: '大家好',
            durationMs: 600,
            backendId: 'funasr',
            words: expect.arrayContaining([
                { id: 'w1', text: '大家', startMs: 0, endMs: 300 },
            ]),
        });
        expect(fetchMock).toHaveBeenCalledWith(
            '/api/v1/local/audio/transcriptions',
            expect.objectContaining({ method: 'POST', credentials: 'include' }),
        );
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
                mediaInputs={[]}
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

    it('accepts a Project sidebar asset drop without replacing the Timeline drag contract', async () => {
        const onProjectAssetDrop = vi.fn();
        render(
            <ProjectTimelineEditorSurface
                timeline={{
                    id: 'timeline-drop',
                    name: 'Drop Cut',
                    owner: { kind: 'project' },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                mediaInputs={[]}
                canvases={[]}
                onSave={vi.fn(() => true)}
                onOpenCanvas={vi.fn()}
                onProjectAssetDrop={onProjectAssetDrop}
            />,
        );

        const dataTransfer = {
            types: ['application/x-clash-project-asset'],
            dropEffect: 'none',
            getData: (type: string) => type === 'application/x-clash-project-asset'
                ? JSON.stringify({ assetId: 'asset-sidebar' })
                : '',
        } as unknown as DataTransfer;
        await screen.findByTestId('remotion-editor');
        const surface = screen.getByTestId('project-timeline-editor');
        fireEvent.dragOver(surface, { dataTransfer });
        expect(surface.getAttribute('data-project-asset-drop-active')).toBe('true');
        expect(screen.getByTestId('remotion-editor').getAttribute('data-project-asset-drop-active')).toBe('true');
        expect(screen.queryByText('Drop to add to Drop Cut')).toBeNull();
        fireEvent.drop(surface, { dataTransfer });
        expect(onProjectAssetDrop).toHaveBeenCalledWith('asset-sidebar');
        expect(screen.getByTestId('remotion-editor').getAttribute('data-project-asset-drop-active')).toBe('false');
    });

    it('ignores Timeline Library drags at the Project Asset boundary', async () => {
        const onProjectAssetDrop = vi.fn();
        render(
            <ProjectTimelineEditorSurface
                timeline={{
                    id: 'timeline-library-drag',
                    name: 'Library Drag Cut',
                    owner: { kind: 'project' },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                mediaInputs={[]}
                canvases={[]}
                onSave={vi.fn(() => true)}
                onOpenCanvas={vi.fn()}
                onProjectAssetDrop={onProjectAssetDrop}
            />,
        );

        await screen.findByTestId('remotion-editor');
        const dataTransfer = {
            types: ['application/x-clash-timeline-library', 'text/plain'],
            dropEffect: 'none',
            getData: (type: string) => type === 'text/plain'
                ? 'transition-prism-split'
                : type === 'application/x-clash-timeline-library'
                    ? 'transition-prism-split'
                    : '',
        } as unknown as DataTransfer;
        const surface = screen.getByTestId('project-timeline-editor');

        fireEvent.dragOver(surface, { dataTransfer });
        expect(surface.getAttribute('data-project-asset-drop-active')).toBe('false');
        expect(screen.getByTestId('remotion-editor').getAttribute('data-project-asset-drop-active')).toBe('false');
        fireEvent.drop(surface, { dataTransfer });
        expect(onProjectAssetDrop).not.toHaveBeenCalled();
    });

    it('forwards a completed picker or upload request into the mounted Timeline editor', async () => {
        render(
            <ProjectTimelineEditorSurface
                timeline={{
                    id: 'timeline-insert',
                    name: 'Insert Cut',
                    owner: { kind: 'project' },
                    revisionId: 'timeline-revision-v1:test',
                    state: { tracks: [] },
                }}
                mediaInputs={[]}
                canvases={[]}
                onSave={vi.fn(() => true)}
                onOpenCanvas={vi.fn()}
                insertAssetRequest={{
                    requestId: 'picker-request-1',
                    asset: { id: 'timeline-asset:asset-1', type: 'image', src: '/opening.png' },
                }}
            />,
        );

        expect((await screen.findByTestId('remotion-editor')).getAttribute('data-insert-request'))
            .toBe('picker-request-1');
    });

    it('lets the host clear a consumed insert request before the Timeline surface remounts', async () => {
        function Host() {
            const [showTimeline, setShowTimeline] = useState(true);
            const [request, setRequest] = useState<{
                requestId: string;
                asset: { id: string; type: 'image'; src: string };
            } | undefined>({
                requestId: 'picker-request-remount',
                asset: { id: 'timeline-asset:asset-remount', type: 'image' as const, src: '/opening.png' },
            });
            return (
                <>
                    <button type="button" onClick={() => setShowTimeline(false)}>Canvas</button>
                    <button type="button" onClick={() => setShowTimeline(true)}>Timeline</button>
                    {showTimeline ? (
                        <ProjectTimelineEditorSurface
                            timeline={{
                                id: 'timeline-remount',
                                name: 'Remount Cut',
                                owner: { kind: 'project' },
                                revisionId: 'timeline-revision-v1:test',
                                state: { tracks: [] },
                            }}
                            mediaInputs={[]}
                            canvases={[]}
                            onSave={vi.fn(() => true)}
                            onOpenCanvas={vi.fn()}
                            insertAssetRequest={request}
                            onInsertAssetRequestHandled={(requestId) => {
                                setRequest((current) => current?.requestId === requestId
                                    ? undefined
                                    : current);
                            }}
                        />
                    ) : null}
                </>
            );
        }

        render(<Host />);
        expect((await screen.findByTestId('remotion-editor')).getAttribute('data-insert-request'))
            .toBe('picker-request-remount');
        fireEvent.click(screen.getByRole('button', { name: 'Consume insert request' }));
        expect(screen.getByTestId('remotion-editor').getAttribute('data-insert-request')).toBe('');
        fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));
        fireEvent.click(screen.getByRole('button', { name: 'Timeline' }));
        expect((await screen.findByTestId('remotion-editor')).getAttribute('data-insert-request')).toBe('');
    });
});
