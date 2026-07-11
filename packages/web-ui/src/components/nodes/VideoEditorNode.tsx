
import React, { memo, useCallback, useState } from 'react';
/* eslint-disable @next/next/no-img-element */
import { Handle, Position, NodeProps, useReactFlow, Node } from '@xyflow/react';
import { FilmSlate, VideoCamera } from '@phosphor-icons/react';
import { useVideoEditor } from '../VideoEditorContext';
import { useOptionalLoroSyncContext } from '../LoroSyncContext';
import { SignedImg } from '../SignedMedia';
import { useSignedUrl, getSignedUrl } from '@clash/web-ui/lib/hooks/useSignedUrl';
import { normalizeStatus, isActiveStatus } from '@clash/web-ui/lib/assetStatus';
import { autoInsertNode } from '@clash/web-ui/lib/layout';
import {
    buildPendingRenderVideoNodePayload,
    getTimelineDurationInFrames,
} from '@clash/web-ui/lib/pendingRenderVideo';
import { hydrateAssetIdsFromNodes } from '@clash/web-ui/lib/timelineDsl';
import { getAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { getItemSourceNodeId } from '@master-clash/remotion-core';
import { Button } from '../ui/button';
import { listProjectTimelines, type ProjectTimeline } from '@clash/shared-types';

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

/**
 * Resolve a canvas node's authoritative R2 key + cover + dimensions + duration.
 *
 * Canvas nodes carry only `data.assetId`. The actual `srcR2Key`/`coverR2Key`
 * and `metadata.{width,height,durationMs}` live on the D1 asset row, fetched
 * via `getAsset(assetId)`. That row is the single source of truth; there is
 * no Loro-mirrored `data.src` fallback anymore.
 */
async function resolveNodeAsset(node: Node): Promise<{
    backingAssetId: string | undefined;
    srcR2Key: string | undefined;
    coverR2Key: string | undefined;
    width: number | undefined;
    height: number | undefined;
    durationSec: number | undefined;
}> {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const assetId = typeof data.assetId === 'string' ? data.assetId : undefined;

    if (!assetId) {
        console.warn('[resolveNodeAsset] node has no assetId', {
            nodeId: node.id,
            nodeType: node.type,
            label: (data as any).label,
            dataKeys: Object.keys(data),
        });
        return {
            backingAssetId: undefined,
            srcR2Key: undefined,
            coverR2Key: undefined,
            width: undefined,
            height: undefined,
            durationSec: undefined,
        };
    }

    const asset = await getAsset(assetId).catch((e) => {
        console.error('[resolveNodeAsset] getAsset failed', { nodeId: node.id, assetId, error: e?.message });
        return null;
    });
    const out = {
        backingAssetId: assetId,
        srcR2Key: asset?.srcR2Key,
        coverR2Key: asset?.coverR2Key ?? undefined,
        width: asset?.metadata?.width,
        height: asset?.metadata?.height,
        durationSec:
            asset?.metadata?.durationMs != null
                ? asset.metadata.durationMs / 1000
                : undefined,
    };
    console.log('[resolveNodeAsset]', { nodeId: node.id, assetId, result: out });
    return out;
}

const VideoEditorNode = ({ data, id }: NodeProps<Node<Record<string, any>>>) => {
    const { openEditor } = useVideoEditor();
    const loroSync = useOptionalLoroSyncContext();
    const reactFlow = useReactFlow();
    const [rendering, setRendering] = useState(false);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const signedPreviewUrl = useSignedUrl(previewSrc || undefined);

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
                if (!cancelled) setPreviewSrc(null);
                return;
            }

            // Find the earliest visual item (by `from`) whose sourceNodeId points
            // at a canvas node we can resolve to an R2 key via the asset row.
            const nodes = reactFlow.getNodes();
            let earliestAssetNode: Node | null = null;
            let minFrom = Infinity;

            for (const track of timelineDsl.tracks) {
                for (const item of (track.items || [])) {
                    const sourceNodeId = getItemSourceNodeId(item);
                    if (!sourceNodeId) continue;
                    if (typeof item.from !== 'number' || item.from >= minFrom) continue;
                    const assetNode = nodes.find((n) => n.id === sourceNodeId);
                    if (!assetNode) continue;
                    minFrom = item.from;
                    earliestAssetNode = assetNode;
                }
            }

            if (!earliestAssetNode) {
                if (!cancelled) setPreviewSrc(null);
                return;
            }

            const resolved = await resolveNodeAsset(earliestAssetNode);
            if (cancelled) return;
            setPreviewSrc(resolved.srcR2Key ?? null);
        })();

        return () => {
            cancelled = true;
        };
    }, [data.timelineId, id, loroSync?.doc, loroUpdateTrigger]);

    const handleOpenEditor = useCallback(async () => {
        // Derive connected assets dynamically from edges
        // This removes the need to sync edge data to node.data.inputs
        // Get nodes/edges inside callback to avoid reactFlow dependency
        const nodes = reactFlow.getNodes();
        const edges = reactFlow.getEdges();

        // Find edges connected to this node's 'assets' handle
        // Relaxed check: Look for ANY edge connected to this target node,
        // prioritizing 'assets' handle but falling back to null handle if needed.
        const connectedEdges = edges.filter(
            (edge) => edge.target === id && (edge.targetHandle === 'assets' || !edge.targetHandle)
        );

        // Map connected edges to canvas source nodes, each resolved through
        // the D1 asset row (see resolveNodeAsset) to obtain authoritative
        // srcR2Key / dimensions / duration from assetId alone.
        const edgeSourceNodes = connectedEdges
            .map((edge) => nodes.find((n) => n.id === edge.source))
            .filter((n): n is Node => !!n)
            .filter((n) => {
                const nodeType = (n.type || '').toLowerCase();
                if (!['image', 'video', 'audio'].includes(nodeType)) return false;
                // Skip only when a video is actively generating AND has no src anywhere.
                const statusValue = n.data?.status;
                const normalizedStatus = normalizeStatus(
                    typeof statusValue === 'string' ? statusValue : undefined,
                );
                const isActive = isActiveStatus(normalizedStatus);
                const hasAnySrc = typeof n.data?.assetId === 'string';
                return !(nodeType === 'video' && isActive && !hasAnySrc);
            });

        const edgeAssets = await Promise.all(
            edgeSourceNodes.map(async (sourceNode) => {
                const resolved = await resolveNodeAsset(sourceNode);
                const nodeType = (sourceNode.type || '').toLowerCase() as
                    | 'image'
                    | 'video'
                    | 'audio';
                const label =
                    typeof sourceNode.data.label === 'string' ? sourceNode.data.label : undefined;
                return {
                    id: sourceNode.id,
                    type: nodeType,
                    src: resolved.srcR2Key ? await getSignedUrl(resolved.srcR2Key) : undefined,
                    thumbnail: resolved.coverR2Key
                        ? await getSignedUrl(resolved.coverR2Key)
                        : undefined,
                    name: label || sourceNode.type,
                    width: resolved.width,
                    height: resolved.height,
                    duration: resolved.durationSec,
                    sourceNodeId: sourceNode.id,
                    backingAssetId: resolved.backingAssetId,
                };
            }),
        );

        // Fallback/Supplement: Scan timelineDsl for used assets
        // This ensures that if arrange_timeline put something in the timeline, it shows up in assets
        // even if edges are missing or malformed.
        const timeline = readTimelineForAction(loroSync?.doc ?? null, id);
        let timelineDsl = timeline?.state as any;

        // Migrate legacy items (src but no assetId) to reference-by-nodeId
        // BEFORE we scan for timeline assets — otherwise legacy items without
        // assetId get dropped from the editor's initial asset set and fail
        // to resolve inside the editor canvas.
        if (timelineDsl?.tracks) {
            timelineDsl = {
                ...timelineDsl,
                tracks: hydrateAssetIdsFromNodes(timelineDsl.tracks, nodes),
            };
        }

        const timelineAssets: any[] = [];
        if (timelineDsl?.tracks) {
            const sourceNodeIdsInTimeline = new Set<string>();
            timelineDsl.tracks.forEach((track: any) => {
                track.items?.forEach((item: any) => {
                    const sourceNodeId = getItemSourceNodeId(item);
                    if (sourceNodeId) {
                        sourceNodeIdsInTimeline.add(sourceNodeId);
                    }
                });
            });

            await Promise.all(Array.from(sourceNodeIdsInTimeline).map(async (sourceNodeId) => {
                const node = nodes.find(n => n.id === sourceNodeId);
                if (!node) return;
                const nodeType = (node.type || '').toLowerCase();
                if (!['image', 'video', 'audio'].includes(nodeType)) return;
                const resolved = await resolveNodeAsset(node);
                const label =
                    typeof node.data.label === 'string' ? node.data.label : undefined;
                timelineAssets.push({
                    id: node.id,
                    type: nodeType as 'image' | 'video' | 'audio',
                    src: resolved.srcR2Key ? await getSignedUrl(resolved.srcR2Key) : undefined,
                    thumbnail: resolved.coverR2Key
                        ? await getSignedUrl(resolved.coverR2Key)
                        : undefined,
                    name: label || node.type,
                    width: resolved.width,
                    height: resolved.height,
                    duration: resolved.durationSec,
                    sourceNodeId: node.id,
                    backingAssetId: resolved.backingAssetId,
                });
            }));
        }

        // Combine and deduplicate
        const allAssets = [...edgeAssets, ...timelineAssets];
        const uniqueAssets = Array.from(new Map(allAssets.map(item => [item.id, item])).values());

        const connectedAssetIds = new Set(uniqueAssets.map(a => a.id));
        const inputSrcs = new Set(
            uniqueAssets.map((asset: any) => asset?.src).filter(Boolean)
        );
        const seenKeys = new Set<string>();
        // Available assets: everything resolvable on the canvas that isn't
        // already wired to the editor. A node is only a usable asset source
        // if it carries an assetId — that's the single input to resolution.
        const availableCandidates = nodes
            .filter((node) => ['image', 'video', 'audio'].includes((node.type || '').toLowerCase()))
            .filter((node) => {
                if (connectedAssetIds.has(node.id)) return false;
                return typeof node.data?.assetId === 'string';
            })
            .filter((node) => {
                const statusValue = node.data?.status;
                if (typeof statusValue !== 'string') return true;
                return !isActiveStatus(normalizeStatus(statusValue));
            });
        const availableAssets = await Promise.all(
            availableCandidates.map(async (node) => {
                const resolved = await resolveNodeAsset(node);
                const label = typeof node.data?.label === 'string' ? node.data.label : undefined;
                return {
                    id: node.id,
                    type: (node.type || '').toLowerCase() as 'image' | 'video' | 'audio',
                    src: resolved.srcR2Key ? await getSignedUrl(resolved.srcR2Key) : undefined,
                    thumbnail: resolved.coverR2Key
                        ? await getSignedUrl(resolved.coverR2Key)
                        : undefined,
                    name: label || node.type,
                    width: resolved.width,
                    height: resolved.height,
                    duration: resolved.durationSec,
                    sourceNodeId: node.id,
                    backingAssetId: resolved.backingAssetId,
                };
            }),
        );
        const filteredAvailableAssets = availableAssets
            .filter((a): a is typeof a & { src: string } => typeof a.src === 'string' && !!a.src)
            .filter((asset) => {
                if (inputSrcs.has(asset.src)) return false;
                const key = asset.sourceNodeId || asset.src;
                if (seenKeys.has(key)) return false;
                seenKeys.add(key);
                return true;
            });
        // Drop any edge/timeline asset that couldn't be resolved to a src at
        // all — the Editor expects Asset.src: string. An unresolved asset
        // usually means the node is still generating; it'll show up next open.
        const uniqueAssetsResolved = uniqueAssets.filter(
            (a): a is typeof a & { src: string } => typeof a.src === 'string' && !!a.src,
        );

        console.group('[VideoEditor.openEditor] passing to Editor');
        console.log('editorNodeId:', id);
        console.log('timelineDsl.tracks:', timelineDsl?.tracks?.map((t: any) => ({
            name: t.name,
            items: t.items?.map((it: any) => ({
                id: it.id, type: it.type, sourceNodeId: it.sourceNodeId, assetId: it.assetId,
                from: it.from, duration: it.durationInFrames,
            })),
        })));
        console.log('allAssets (before filter):', uniqueAssets.map((a: any) => ({
            id: a.id, type: a.type, src: a.src?.slice(0, 80) ?? null, hasSrc: !!a.src,
        })));
        console.log('uniqueAssetsResolved (after src-required filter):', uniqueAssetsResolved.map((a: any) => ({
            id: a.id, src: a.src?.slice(0, 80),
        })));
        console.log('filteredAvailableAssets:', filteredAvailableAssets.map((a: any) => ({ id: a.id, src: a.src?.slice(0, 80) })));
        console.groupEnd();

        openEditor(uniqueAssetsResolved, id, timelineDsl, filteredAvailableAssets);
        // Note: reactFlow is intentionally excluded from deps - we read it inside the callback
        // to avoid re-creating this callback on every ProjectEditor render
    }, [data.timelineId, id, loroSync, openEditor]);

    const handleRender = useCallback(async () => {

        if (!loroSync?.doc) {
            console.error('[VideoEditorNode] LoroSync not connected');
            return;
        }

        setRendering(true);
        try {
            const timeline = readTimelineForAction(loroSync.doc, id);
            const timelineDsl = timeline?.state as any;

            if (!timeline || !timelineDsl || !timelineDsl.tracks || timelineDsl.tracks.length === 0) {
                alert('Please open the editor and create some content first!');
                return;
            }

            // Create a new video node with the rendered content
            // IMPORTANT: Override durationInFrames to use calculated value
            const updatedTimelineDsl = {
                ...timelineDsl,
                durationInFrames: getTimelineDurationInFrames(
                    timelineDsl.tracks,
                    timelineDsl.durationInFrames,
                ),
            };
            const pendingVideoNode = await buildPendingRenderVideoNodePayload(updatedTimelineDsl, {
                sourceTimelineNodeId: id,
                timelineRevision: {
                    timelineId: timeline.id,
                    revisionId: timeline.revisionId,
                },
            });

            // Calculate auto-layout position locally to ensure immediate correct placement
            const newVideoNodeId = `video-${Date.now()}`;
            const currentNodes = reactFlow.getNodes();
            const currentEdges = reactFlow.getEdges();

            // Create temporary node for layout calculation
            // We pretend the edge already exists for the calculation
            const tempEdge = {
                id: `temp-edge-${id}-${newVideoNodeId}`,
                source: id,
                target: newVideoNodeId,
                type: 'default'
            };
            const tempEdges = [...currentEdges, tempEdge];

            // Create temporary node object
            const tempNode: Node = {
                id: newVideoNodeId,
                type: 'video',
                position: { x: 0, y: 0 }, // Placeholder
                data: pendingVideoNode.data,
                parentId: data.parentId, // Inherit parent if inside a group? No, outputs usually go outside or same level. Let's assume same level.
                width: pendingVideoNode.width,
                height: pendingVideoNode.height,
                style: pendingVideoNode.style,
            };
            const tempNodes = [...currentNodes, tempNode];

            // Run auto-layout calculation
            const layoutResult = autoInsertNode(newVideoNodeId, tempNodes, tempEdges);
            const finalPosition = layoutResult.position;


            const newVideoNode = {
                id: newVideoNodeId,
                type: 'video',
                position: finalPosition,
                parentId: data.parentId, // Keep in same group if editor is in a group
                ...pendingVideoNode,
            };

            // Add new node to LoroSync
            loroSync.addNode(newVideoNodeId, newVideoNode);

            // Create edge from editor to new video node
            const edgeId = `${id}-${newVideoNodeId}`;
            const newEdge = {
                id: edgeId,
                source: id,
                target: newVideoNodeId,
                type: 'default',
            };
            loroSync.addEdge(edgeId, newEdge);

            // Also add to ReactFlow for immediate UI update (with calculated position)
            reactFlow.addNodes(newVideoNode);
            reactFlow.addEdges(newEdge);

            // Sync pushed nodes from layout result
            if (layoutResult.pushedNodes.size > 0) {
                layoutResult.pushedNodes.forEach((pos, nodeId) => {
                    loroSync.updateNode(nodeId, { position: pos });
                    // Also update ReactFlow locally
                    reactFlow.setNodes((nds) =>
                        nds.map((n) => (n.id === nodeId ? { ...n, position: pos } : n))
                    );
                });
            }

            // Debug: Check what ReactFlow actually has
            setTimeout(() => {
                const nodeInFlow = reactFlow.getNode(newVideoNodeId);
            }, 100);
        } catch (error) {
            console.error('[VideoEditorNode] Failed to trigger render:', error);
        } finally {
            setRendering(false);
        }
        // Note: reactFlow is intentionally excluded from deps - we read it inside the callback
        // to avoid re-creating this callback on every ProjectEditor render
    }, [data, id, loroSync]);

    return (
        <div
            className="group relative w-[400px]"
            onDoubleClick={handleOpenEditor}
        >
            {/* Main Card */}
            <div className="w-full bg-warm-surface shadow-md rounded-matrix overflow-hidden transition-all duration-300 hover:shadow-lg ring-1 ring-warm-border">
                {/* Header Badge */}
                <div className="absolute top-3 left-3 z-10">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-warm-surface/95 rounded-lg shadow-sm border border-warm-border">
                        <FilmSlate className="w-3.5 h-3.5 text-video" weight="fill" />
                        <span className="text-[10px] font-bold font-display text-slate-800 dark:text-slate-200 uppercase tracking-wide">Timeline Editor</span>
                    </div>
                </div>
                {/* Preview Area */}
                <div className="relative w-full aspect-video bg-stone-100 flex items-center justify-center overflow-hidden border-b border-warm-border">
                    {previewSrc ? (
                        previewSrc.match(/\.(mp4|webm|mov)$/i) ? (
                            signedPreviewUrl ? (
                                <video
                                    src={signedPreviewUrl}
                                    className="w-full h-full object-cover pointer-events-none"
                                    preload="auto"
                                    muted
                                    playsInline
                                    // Show first frame
                                    onLoadedMetadata={(e) => { (e.target as HTMLVideoElement).currentTime = 0; }}
                                />
                            ) : null
                        ) : (
                            <SignedImg
                                src={previewSrc}
                                alt="Preview"
                                className="w-full h-full object-cover pointer-events-none"
                            />
                        )
                    ) : (
                        <div className="flex flex-col items-center justify-center gap-3 p-6">
                            <div className="rounded-2xl w-16 h-16 flex justify-center items-center bg-warm-surface shadow-sm border border-warm-border group-hover:bg-video-light transition-colors">
                                <FilmSlate className="w-8 h-8 text-stone-700 dark:text-stone-300 group-hover:text-video transition-colors" weight="duotone" />
                            </div>
                            <div className="text-center">
                                <div className="text-sm font-bold font-display text-stone-700">Video Editor</div>
                                <div className="text-xs text-stone-700 dark:text-stone-300 mt-1">Double-click to open</div>
                            </div>
                        </div>
                    )}

                    {/* Hover Overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors flex items-center justify-center pointer-events-none">
                        {previewSrc && (
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-slate-950/70 text-white px-3 py-1.5 rounded-lg text-xs font-medium">
                                Open Editor
                            </div>
                        )}
                    </div>
                </div>

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
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-white !bg-stone-400 transition-all hover:!bg-video hover:scale-125 shadow-sm"
            />
            {/* Output Handle */}
            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-stone-400 transition-all hover:!bg-video hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(VideoEditorNode);
