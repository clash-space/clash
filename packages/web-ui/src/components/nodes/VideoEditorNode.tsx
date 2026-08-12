
import React, { memo, useCallback, useState } from 'react';
/* eslint-disable @next/next/no-img-element */
import { Handle, Position, NodeProps, useReactFlow, Node } from '@xyflow/react';
import { FilmSlate, VideoCamera } from '@phosphor-icons/react';
import { useVideoEditor } from '../VideoEditorContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { useSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { getItemSourceNodeId } from '@clash/remotion-core';
import { Button } from '../ui/button';
import { listProjectTimelines, type ProjectTimeline } from '@clash/shared-types';
import {
    assetPreviewMedia,
    type AssetPreviewMedia,
} from '../../features/assets/media-url';
import betterAuthClient from '../../lib/betterAuthClient';

function readTimelineForAction(
    doc: NonNullable<ReturnType<typeof useOptionalLoroSyncContext>>['doc'],
    actionNodeId: string,
): ProjectTimeline | null {
    if (!doc) return null;
    const actionNode = doc.getMap('nodes').get(actionNodeId) as any;
    const timelineId = typeof actionNode?.data?.timelineId === 'string'
        ? actionNode.data.timelineId
        : undefined;
    if (!timelineId) return null;
    return listProjectTimelines(doc).find((timeline) => timeline.id === timelineId) ?? null;
}

async function resolveAssetPreview(assetId: string, sourceId: string): Promise<AssetPreviewMedia | null> {
    const asset = await getAsset(assetId).catch((e) => {
        console.error('[resolveAssetPreview] getAsset failed', { sourceId, assetId, error: e?.message });
        return null;
    });
    return asset ? assetPreviewMedia(asset) : null;
}

const VideoEditorNode = ({ data, id }: NodeProps<Node<Record<string, any>>>) => {
    const { openTimeline } = useVideoEditor();
    const loroSync = useOptionalLoroSyncContext();
    const reactFlow = useReactFlow();
    const session = betterAuthClient.useSession();
    const currentUserId = session.data?.user?.id ?? '';
    const [rendering, setRendering] = useState(false);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [previewMedia, setPreviewMedia] = useState<AssetPreviewMedia | null>(null);
    const signedPreviewUrl = useSignedUrl(previewMedia?.source);

    // Extract first frame source from timeline
    // Force re-render trigger for Loro updates
    const [loroUpdateTrigger, setLoroUpdateTrigger] = React.useState(0);

    // Subscribe to Loro changes for this specific node
    React.useEffect(() => {
        if (!loroSync?.doc) return;

        // CRITICAL FIX: Subscribe to the entire document instead of just nodesMap
        // This ensures we catch BOTH local changes (nodesMap.set) AND remote changes (doc.import)
        const unsubscribe = loroSync.doc.subscribe((event: any) => {
            // event.by: "local" | "import" | "checkout"
            // We want to catch ALL changes (both local and remote) for this node

            // Check if this event affected our node
            const nodesMap = loroSync.doc!.getMap('nodes');
            const currentNode = nodesMap.get(id);

            // Trigger update if the node exists (simple check - any change to doc might affect this node)
            if (currentNode) {
                setLoroUpdateTrigger(prev => prev + 1);
            }
        });

        return () => {
            unsubscribe();
        };
    }, [id, loroSync?.doc]);

    // Update preview whenever data or Loro changes
    React.useEffect(() => {
        let cancelled = false;

        (async () => {
            const timeline = readTimelineForAction(loroSync?.doc ?? null, id);
            const timelineDsl = timeline?.state as any;

            if (!timelineDsl?.tracks) {
                if (!cancelled) setPreviewMedia(null);
                return;
            }

            const nodes = reactFlow.getNodes();
            const candidates: Array<{ from: number; assetId: string; sourceId: string }> = [];

            for (const track of timelineDsl.tracks) {
                for (const item of (track.items || [])) {
                    if (item.type === 'audio') continue;
                    const sourceNodeId = getItemSourceNodeId(item);
                    if (typeof item.from !== 'number') continue;
                    const assetNode = sourceNodeId
                        ? nodes.find((node) => node.id === sourceNodeId)
                        : undefined;
                    const nodeAssetId = typeof assetNode?.data?.assetId === 'string'
                        ? assetNode.data.assetId
                        : undefined;
                    const itemAssetId = typeof item.assetId === 'string'
                        ? item.assetId
                        : undefined;
                    const assetId = nodeAssetId ?? itemAssetId;
                    if (!assetId) continue;
                    candidates.push({
                        from: item.from,
                        assetId,
                        sourceId: sourceNodeId ?? item.id,
                    });
                }
            }

            candidates.sort((left, right) => left.from - right.from);
            for (const candidate of candidates) {
                const resolved = await resolveAssetPreview(candidate.assetId, candidate.sourceId);
                if (cancelled) return;
                if (resolved) {
                    setPreviewMedia(resolved);
                    return;
                }
            }

            setPreviewMedia(null);
        })();

        return () => {
            cancelled = true;
        };
    }, [data.timelineId, id, loroSync?.doc, loroUpdateTrigger]);

    const handleOpenEditor = useCallback(() => {
        setRenderError(null);
        const timeline = readTimelineForAction(loroSync?.doc ?? null, id);
        if (!timeline) {
            console.error('[VideoEditorNode] Timeline Action has no Project Timeline');
            return;
        }
        openTimeline(timeline.id);
    }, [id, loroSync?.doc, openTimeline]);

    const handleRender = useCallback(async () => {
        setRenderError(null);
        if (!loroSync?.doc) {
            console.error('[VideoEditorNode] LoroSync not connected');
            setRenderError('Canvas is still connecting. Try again in a moment.');
            return;
        }
        const timeline = readTimelineForAction(loroSync.doc, id);
        const timelineDsl = timeline?.state as any;
        if (!timeline || !timelineDsl || !timelineDsl.tracks || timelineDsl.tracks.length === 0) {
            setRenderError('Open the editor and add content before rendering.');
            return;
        }

        setRendering(true);
        try {
            const result = loroSync.requestTimelineRender(timeline.id, {
                actorUserId: currentUserId,
            });
            if (!result.ok) throw new Error(result.error);
        } catch (error) {
            console.error('[VideoEditorNode] Failed to trigger render:', error);
            setRenderError(error instanceof Error ? error.message : 'Render could not be started.');
        } finally {
            setRendering(false);
        }
    }, [currentUserId, id, loroSync]);

    return (
        <div
            className="group relative w-[320px]"
            onDoubleClick={handleOpenEditor}
        >
            {/* Main Card */}
            <div className="w-full bg-warm-surface shadow-md rounded-matrix overflow-hidden transition-all duration-300 hover:shadow-lg ring-1 ring-warm-border">
                {/* Header Badge */}
                <div className="absolute top-3 left-3 z-10">
                    <div className="flex items-center gap-1.5 rounded-lg border border-overlay-border bg-overlay-surface px-2.5 py-1 shadow-overlay">
                        <FilmSlate className="h-3.5 w-3.5 text-brand" weight="fill" />
                        <span className="font-display text-[10px] font-bold uppercase tracking-wide text-content-primary">Timeline Editor</span>
                    </div>
                </div>
                {/* Preview Area */}
                <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden border-b border-warm-border bg-warm-muted">
                    {previewMedia ? (
                        signedPreviewUrl ? (
                            previewMedia.kind === 'video' ? (
                                <video
                                    src={signedPreviewUrl}
                                    className="w-full h-full object-cover pointer-events-none"
                                    preload="auto"
                                    muted
                                    playsInline
                                    // Show first frame
                                    onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 0; }}
                                />
                            ) : (
                                <img
                                    src={signedPreviewUrl}
                                    alt=""
                                    className="w-full h-full object-cover pointer-events-none"
                                />
                            )
                        ) : null
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-2.5 p-4">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-warm-border bg-warm-surface shadow-sm transition-colors group-hover:bg-brand-light">
                                <FilmSlate className="h-6 w-6 text-brand transition-colors" weight="duotone" />
                            </div>
                            <div className="text-center">
                                <div className="font-display text-[13px] font-bold text-content-primary">Video Editor</div>
                                <div className="mt-0.5 text-[11px] text-content-muted">Double-click to open</div>
                            </div>
                        </div>
                    )}

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center pointer-events-none">
                        {previewMedia && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/70 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                                Open Editor
                            </div>
                        )}
                    </div>
                </div>

                {renderError ? (
                    <div role="alert" className="border-t border-amber-500/25 bg-amber-500/10 px-3 py-2 text-[11px] font-medium leading-4 text-amber-800 dark:text-amber-200">
                        {renderError}
                    </div>
                ) : null}

                {/* Footer Actions */}
                <div className="bg-warm-muted px-3 py-2 border-t border-warm-border flex items-center justify-end h-10">
                    <Button
                        size="sm"
                        onClick={handleRender}
                        disabled={rendering}
                        className="clash-node-primary min-h-0 rounded-xl px-3 py-1.5 text-xs font-bold shadow-sm"
                        leftIcon={<VideoCamera className="w-3.5 h-3.5" weight="fill" />}
                    >
                        {rendering ? 'Rendering...' : 'Render'}
                    </Button>
                </div>
            </div>

            {/* Input Handle */}
            <Handle
                type="target"
                position={Position.Left}
                id="assets"
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-warm-surface !bg-content-muted shadow-sm transition-all hover:scale-125 hover:!bg-brand"
            />
            {/* Output Handle */}
            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-warm-surface !bg-content-muted shadow-sm transition-all hover:scale-125 hover:!bg-brand"
            />
        </div>
    );
};

export default memo(VideoEditorNode);
