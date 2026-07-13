import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilmSlate, Image as ImageIcon, SquaresFour } from '@phosphor-icons/react';
import type { EditorAssetInput, EditorState } from '@master-clash/remotion-core';
import type { ProjectCanvas, ProjectTimeline } from '@clash/shared-types';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import { stripSrcFromTracks } from '@clash/web-ui/lib/timelineDsl';
import { IconButton } from './ui/icon-button';
import { Tooltip } from './ui/tooltip';

const TimelineEditor = lazy(() =>
    import('@master-clash/remotion-ui').then((module) => ({ default: module.Editor })),
);

type ProjectTimelineEditorState = Pick<
    EditorState,
    'tracks' | 'compositionWidth' | 'compositionHeight' | 'fps' | 'durationInFrames'
>;

export function ProjectAssetSurface({ asset }: { asset: ProjectAsset }) {
    const [failed, setFailed] = useState(false);
    const path = asset.storageKey?.trim() || asset.id;
    const label = path.split(/[\\/]/).filter(Boolean).at(-1) || path;

    useEffect(() => setFailed(false), [asset.id, asset.url]);

    const fallback = (
        <div className="flex flex-col items-center gap-2 text-stone-400">
            {asset.type === 'video' ? (
                <FilmSlate className="h-7 w-7" weight="regular" aria-hidden="true" />
            ) : (
                <ImageIcon className="h-7 w-7" weight="regular" aria-hidden="true" />
            )}
            <span className="text-xs">Preview unavailable</span>
        </div>
    );

    return (
        <main
            aria-label={`${label} preview`}
            className="absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-warm-page"
        >
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-warm-border/80 px-3">
                {asset.type === 'video' ? (
                    <FilmSlate className="h-3.5 w-3.5 shrink-0 text-stone-400" weight="regular" />
                ) : (
                    <ImageIcon className="h-3.5 w-3.5 shrink-0 text-stone-400" weight="regular" />
                )}
                <span title={path} className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">
                    {label}
                </span>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-stone-100 p-5">
                {failed || !asset.url ? fallback : asset.type === 'video' ? (
                    <video
                        src={asset.url}
                        aria-label={label}
                        className="max-h-full max-w-full bg-black object-contain"
                        controls
                        playsInline
                        preload="metadata"
                        onError={() => setFailed(true)}
                    />
                ) : (
                    <img
                        src={asset.url}
                        alt={label}
                        className="max-h-full max-w-full object-contain"
                        onError={() => setFailed(true)}
                    />
                )}
            </div>
        </main>
    );
}

export function ProjectTimelineEditorSurface({
    timeline,
    assets,
    canvases,
    onSave,
    onOpenCanvas,
}: {
    timeline: ProjectTimeline;
    assets: ProjectAsset[];
    canvases: ProjectCanvas[];
    onSave: (timelineId: string, state: ProjectTimelineEditorState) => boolean;
    onOpenCanvas: (canvasId: string) => void;
}) {
    const editorStateRef = useRef<EditorState | null>(null);
    const lastSavedStateRef = useRef<EditorState | null>(null);
    const initialState = (timeline.state && typeof timeline.state === 'object')
        ? timeline.state as Partial<EditorState>
        : undefined;
    const editorAssets = useMemo<EditorAssetInput[]>(() => assets.map((asset) => ({
        id: asset.id,
        backingAssetId: asset.assetId ?? asset.id,
        sourceNodeId: asset.id,
        name: asset.storageKey ?? asset.id,
        src: asset.url,
        type: asset.type,
    })), [assets]);

    const persistCurrentState = useCallback(() => {
        const state = editorStateRef.current;
        if (!state || state === lastSavedStateRef.current) return true;
        const persisted = onSave(timeline.id, {
            tracks: stripSrcFromTracks(state.tracks),
            compositionWidth: state.compositionWidth,
            compositionHeight: state.compositionHeight,
            fps: state.fps,
            durationInFrames: state.durationInFrames,
        });
        if (persisted) lastSavedStateRef.current = state;
        return persisted;
    }, [onSave, timeline.id]);

    const persistRef = useRef(persistCurrentState);
    persistRef.current = persistCurrentState;
    useEffect(() => () => {
        persistRef.current();
    }, [timeline.id]);

    const parentCanvasId = timeline.owner.kind === 'canvas-action'
        ? timeline.owner.canvasId
        : undefined;
    const parentCanvas = parentCanvasId
        ? canvases.find((canvas) => canvas.id === parentCanvasId)
        : undefined;
    const parentCanvasAction = parentCanvas ? (
        <Tooltip label={`Open parent Canvas ${parentCanvas.name}`}>
            <IconButton
                label={`Open parent Canvas ${parentCanvas.name}`}
                icon={<SquaresFour className="h-4 w-4" weight="regular" />}
                size="sm"
                shape="rounded"
                onClick={() => onOpenCanvas(parentCanvas.id)}
                className="h-8 min-h-8 w-8 min-w-8 rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-950"
            />
        </Tooltip>
    ) : undefined;

    return (
        <main
            data-testid="project-timeline-editor"
            aria-label={`${timeline.name} editor`}
            className="absolute inset-0 z-10 min-h-0 overflow-hidden bg-[#f7f4f1]"
        >
            <Suspense
                fallback={(
                    <div className="flex h-full items-center justify-center text-sm text-stone-500">
                        Loading editor...
                    </div>
                )}
            >
                <TimelineEditor
                    layout="embedded"
                    initialAssets={editorAssets}
                    initialState={initialState}
                    stateRef={editorStateRef}
                    headerLeadingAction={parentCanvasAction}
                    editorKey={timeline.id}
                />
            </Suspense>
        </main>
    );
}
