import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CaretDown, FilmSlate, Image as ImageIcon, Plus, SquaresFour } from '@phosphor-icons/react';
import type { EditorAssetInput, EditorState } from '@master-clash/remotion-core';
import type { ProjectCanvas, ProjectTimeline } from '@clash/shared-types';
import type { ProjectAsset } from '@clash/web-ui/lib/types';
import { stripSrcFromTracks } from '@clash/web-ui/lib/timelineDsl';
import { Button } from './ui/button';
import { IconButton } from './ui/icon-button';
import { Tooltip } from './ui/tooltip';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from './ui/dropdown-menu';

const TimelineEditor = lazy(() =>
    import('@master-clash/remotion-ui').then((module) => ({ default: module.Editor })),
);

type ProjectTimelineEditorState = Pick<
    EditorState,
    'tracks' | 'compositionWidth' | 'compositionHeight' | 'fps' | 'durationInFrames'
>;

export function ProjectAssetsSurface({
    assets,
    canvases,
    onAddToCanvas,
}: {
    assets: ProjectAsset[];
    canvases: ProjectCanvas[];
    onAddToCanvas: (asset: ProjectAsset, canvasId: string) => void;
}) {
    return (
        <main className="absolute inset-0 z-10 overflow-y-auto bg-warm-page px-10 py-8">
            <header className="mb-7 border-b border-warm-border pb-4">
                <div>
                    <h1 className="font-display text-2xl font-semibold text-slate-950">Assets</h1>
                    <p className="mt-1 text-sm text-stone-500">{assets.length} project assets</p>
                </div>
            </header>
            {assets.length === 0 ? (
                <div className="py-16 text-sm text-stone-400">No assets</div>
            ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
                    {assets.map((asset) => (
                        <article key={asset.id} className="group min-w-0 overflow-hidden rounded-lg border border-warm-border bg-warm-surface">
                            <ProjectAssetPreview asset={asset} />
                            <div className="flex h-12 min-w-0 items-center gap-2 px-3">
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                                    {asset.id}
                                </span>
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            size="sm"
                                            shape="rounded"
                                            aria-label={`Add ${asset.id} to canvas`}
                                            disabled={canvases.length === 0}
                                            leftIcon={<Plus className="h-3.5 w-3.5" weight="bold" />}
                                            rightIcon={<CaretDown className="h-3 w-3" weight="bold" />}
                                            className="h-8 min-h-8 rounded-md px-2.5 text-xs"
                                        >
                                            Add to canvas
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="min-w-44 rounded-md p-1">
                                        {canvases.map((canvas) => (
                                            <DropdownMenuItem
                                                key={canvas.id}
                                                onSelect={() => onAddToCanvas(asset, canvas.id)}
                                                className="min-h-8 rounded-md px-2.5 py-1.5 text-xs"
                                            >
                                                {canvas.name}
                                            </DropdownMenuItem>
                                        ))}
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                        </article>
                    ))}
                </div>
            )}
        </main>
    );
}

function ProjectAssetPreview({ asset }: { asset: ProjectAsset }) {
    const [failed, setFailed] = useState(false);
    const fallback = (
        <div className="flex aspect-video items-center justify-center bg-stone-100 text-stone-400">
            {asset.type === 'video' ? (
                <FilmSlate className="h-7 w-7" weight="regular" aria-hidden="true" />
            ) : (
                <ImageIcon className="h-7 w-7" weight="regular" aria-hidden="true" />
            )}
        </div>
    );

    if (failed || !asset.url) return fallback;
    return (
        <div className="aspect-video overflow-hidden bg-stone-100">
            {asset.type === 'video' ? (
                <video
                    src={asset.url}
                    className="h-full w-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                    onError={() => setFailed(true)}
                />
            ) : (
                <img
                    src={asset.url}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-[1.02]"
                    onError={() => setFailed(true)}
                />
            )}
        </div>
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
