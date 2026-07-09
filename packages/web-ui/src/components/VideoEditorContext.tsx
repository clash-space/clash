
import React, { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';
import { lazy, Suspense } from 'react';
import { getEditorAssetKey, normalizeEditorAsset } from '@master-clash/remotion-core';
import type { Asset, EditorAssetInput, EditorState, TimelineDsl, Track } from '@master-clash/remotion-core';
import type { Node, Edge } from '@xyflow/react';
import { useOptionalLoroSyncContext } from './LoroSyncContext';
import { EditorModalDialog } from './EditorModalDialog';
import { autoInsertNode } from '@clash/web-ui/lib/layout';
import {
    buildPendingRenderVideoNodePayload,
    getTimelineDurationInFrames,
    readPendingRenderAppliedTimelineRevision,
} from '@clash/web-ui/lib/pendingRenderVideo';
import { stripSrcFromTracks } from '@clash/web-ui/lib/timelineDsl';

// ─── Timeline item persistence contract ─────────────────────────────────────
// Items persisted in Loro reference their canvas source by `sourceNodeId`.
// `assetId` follows the rest of the app: the D1 asset row id from
// `node.data.assetId`. Concrete `src`/`type`/dimensions are resolved at editor
// open time from the canvas node + asset row.
//
// `item.src` is never persisted: stripped here on save, and already stripped
// by VideoEditorNode before openEditor is called (VideoEditorNode runs the
// legacy-src → assetId hydration first so its own asset scan can pick up
// legacy items). Helpers live in `lib/timelineDsl.ts`.

/** Prepare tracks for persistence: reference-only, no `src` baked in. */
function tracksForPersistence(tracks: Track[]): Track[] {
    return stripSrcFromTracks(tracks);
}

const Editor = lazy(() =>
    import('@master-clash/remotion-ui').then(mod => ({ default: mod.Editor }))
);

// Use TimelineDsl from remotion-core
type TimelineDslType = Pick<
    EditorState,
    'tracks' | 'compositionWidth' | 'compositionHeight' | 'fps' | 'durationInFrames'
>;

interface VideoEditorContextType {
    isOpen: boolean;
    openEditor: (
        assets: EditorAssetInput[],
        nodeId: string,
        timelineDsl?: TimelineDslType | null,
        availableAssets?: EditorAssetInput[]
    ) => void;
    closeEditor: () => void;
    exportVideo: () => Promise<void>;
}

const VideoEditorContext = createContext<VideoEditorContextType | undefined>(undefined);

export function VideoEditorProvider({
    children,
    onAssetAddedToCanvas,
    onCanvasAssetLinked,
    nodes = [],
    edges = [],
}: {
    children: ReactNode;
    onAssetAddedToCanvas?: (
        file: File,
        type: 'video' | 'image' | 'audio',
        editorNodeId: string
    ) => Promise<EditorAssetInput | null> | EditorAssetInput | null;
    onCanvasAssetLinked?: (asset: EditorAssetInput, editorNodeId: string) => void;
    nodes?: Node[];
    edges?: Edge[];
}) {
    const loroSync = useOptionalLoroSyncContext();
    const [isOpen, setIsOpen] = useState(false);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [availableAssets, setAvailableAssets] = useState<EditorAssetInput[]>([]);
    const [timelineDsl, setTimelineDsl] = useState<TimelineDsl | null>(null);
    const [editorNodeId, setEditorNodeId] = useState<string | null>(null);

    // Ref to read editor state on close - no callbacks during playback
    const editorStateRef = useRef<EditorState | null>(null);

    const openEditor = useCallback((
        newAssets: EditorAssetInput[],
        nodeId: string,
        nextTimelineDsl?: TimelineDslType | null,
        nextAvailableAssets: EditorAssetInput[] = []
    ): void => {

        // Deduplicate assets before setting
        const seenKeys = new Set<string>();
        const deduplicatedAssets = newAssets.map(normalizeEditorAsset).filter(asset => {
            const key = getEditorAssetKey(asset);
            if (seenKeys.has(key)) {
                return false;
            }
            seenKeys.add(key);
            return true;
        });

        setAssets(deduplicatedAssets);
        setEditorNodeId(nodeId);

        // Process DSL - normalize keys and ensure IDs exist
        // Note: src/type are no longer hydrated here - they are resolved dynamically
        // at render time by VideoComposition using the allNodes map
        let processedDsl = nextTimelineDsl;
        if (processedDsl && processedDsl.tracks) {
             processedDsl = {
                 ...processedDsl,
                 tracks: processedDsl.tracks.map(track => ({
                     ...track,
                     items: track.items.map(item => {
                         let newItem = { ...item };

                         // 1. Ensure ID exists
                         if (!newItem.id) {
                             newItem.id = `item-auto-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                         }

                         // 2. Handle legacy snake_case keys from backend (asset_id -> assetId)
                         if ((newItem as any).asset_id && !newItem.assetId) {
                             newItem.assetId = (newItem as any).asset_id;
                         }
                         if ((newItem as any).duration_in_frames && !newItem.durationInFrames) {
                             newItem.durationInFrames = (newItem as any).duration_in_frames;
                         }
                         if ((newItem as any).start_at && !newItem.from) {
                             newItem.from = (newItem as any).start_at;
                         }

                         // 3. Normalize Type (lowercase) - only if type is already present
                         // src/type resolution now happens at render time via VideoComposition
                         if (newItem.type) {
                             newItem.type = newItem.type.toLowerCase() as any;
                         }

                         return newItem;
                     })
                 }))
             };
        }

        // Leave `src` intact inside the editor — consumers prefer `assetId`
        // for resolution but will fall back to `src` if the assetId lookup
        // misses (e.g. legacy items whose hydration couldn't match any
        // canvas node). Stripping happens only at the persistence boundary
        // (closeEditor / exportVideo) so stale URLs never re-enter Loro.
        setTimelineDsl(processedDsl ?? null);

        setAvailableAssets(nextAvailableAssets);
        setIsOpen(true);

        // Declare timeline soft-lock to ProjectRoom: remote timeline_editor
        // events should remain proposals while the user's in-flight editor
        // state is open. Released on closeEditor or WS disconnect.
        loroSync?.sendSideband?.({ type: 'set_editing_node', nodeId });
    }, [loroSync]);

    const closeEditor = useCallback(() => {
        // Save state on close - read from ref
        if (editorNodeId && editorStateRef.current && loroSync?.connected) {
            const state = editorStateRef.current;

            // Persist reference-only: items carry `assetId` (node id); `src`
            // is stripped so stale signed URLs can't leak across sessions.
            const finalDsl: TimelineDslType = {
                tracks: tracksForPersistence(state.tracks),
                compositionWidth: state.compositionWidth,
                compositionHeight: state.compositionHeight,
                fps: state.fps,
                durationInFrames: state.durationInFrames,
            };
            const saved = loroSync.applyTimelineDsl(editorNodeId, finalDsl);
            if (!saved) return;
        }

        // Release timeline soft-lock after a successful save so server-side
        // writers do not resume while unsaved local edits are still open.
        loroSync?.sendSideband?.({ type: 'set_editing_node', nodeId: null });

        setIsOpen(false);
        setAssets([]);
        setAvailableAssets([]);
        setTimelineDsl(null);
        setEditorNodeId(null);
        editorStateRef.current = null;
    }, [editorNodeId, loroSync]);

    const exportVideo = useCallback(async () => {
        if (!editorNodeId || !loroSync?.connected) {
            console.error('[VideoEditorContext] Cannot export: no nodeId or LoroSync not connected');
            return;
        }

        // Get current timeline DSL from editor state
        if (!editorStateRef.current) {
            alert('No content to export!');
            return;
        }

        const state = editorStateRef.current;

        // Create DSL for export (reference-only: items carry assetId, no src)
        const finalDsl: TimelineDslType = {
            tracks: tracksForPersistence(state.tracks),
            compositionWidth: state.compositionWidth,
            compositionHeight: state.compositionHeight,
            fps: state.fps,
            durationInFrames: getTimelineDurationInFrames(state.tracks, state.durationInFrames),
        };

        // Check if there's any content
        if (!finalDsl.tracks || finalDsl.tracks.length === 0) {
            alert('Please add some content to the timeline before exporting!');
            return;
        }

        // Create a new video node with the rendered content
        const newVideoNodeId = `video-${Date.now()}`;
        const currentNodes = nodes || [];
        const currentEdges = edges || [];
        const editorNode = currentNodes.find(n => n.id === editorNodeId);
        const pendingVideoNode = buildPendingRenderVideoNodePayload(finalDsl, {
            sourceTimelineNodeId: editorNodeId,
            appliedRevision: readPendingRenderAppliedTimelineRevision(editorNode?.data),
        });

        // Use autoInsertNode for precise client-side layout
        // Create temporary edge and node objects for calculation
        const tempEdge = {
            id: `temp-edge-${editorNodeId}-${newVideoNodeId}`,
            source: editorNodeId,
            target: newVideoNodeId,
            type: 'default'
        };

        const tempNode = {
            id: newVideoNodeId,
            type: 'video',
            position: { x: 0, y: 0 },
            data: pendingVideoNode.data,
            parentId: editorNode?.parentId,
            width: pendingVideoNode.width,
            height: pendingVideoNode.height,
            style: pendingVideoNode.style,
        } as Node;

        // Run auto-layout calculation
        const layoutResult = autoInsertNode(newVideoNodeId, [...currentNodes, tempNode], [...currentEdges, tempEdge]);
        const finalPosition = layoutResult.position;


        const newVideoNode = {
            id: newVideoNodeId,
            type: 'video',
            position: finalPosition,
            parentId: editorNode?.parentId,
            ...pendingVideoNode,
        };

        // Add new node to LoroSync
        loroSync.addNode(newVideoNodeId, newVideoNode);

        // Create edge from editor to new video node
        const edgeId = `${editorNodeId}-${newVideoNodeId}`;
        const newEdge = {
            id: edgeId,
            source: editorNodeId,
            target: newVideoNodeId,
            type: 'default',
        };
        loroSync.addEdge(edgeId, newEdge);

        // Sync pushed nodes from layout result
        if (layoutResult.pushedNodes.size > 0) {
            layoutResult.pushedNodes.forEach((pos, nodeId) => {
                loroSync.updateNode(nodeId, { position: pos });
            });
        }


        // Note: The actual rendering will be triggered by NodeProcessor
        // when it detects the new video node with 'pending' status
    }, [editorNodeId, loroSync, nodes, edges]);

    const handleAssetUpload = useCallback(
        async (file: File, type: 'video' | 'image' | 'audio') => {
            if (!editorNodeId || !onAssetAddedToCanvas) return;
            const result = await onAssetAddedToCanvas(file, type, editorNodeId);
            if (!result) return;
            const normalizedResult = normalizeEditorAsset(result);
            setAssets((current) => {
                const exists = current.some((asset) =>
                    asset.id === normalizedResult.id ||
                    asset.src === normalizedResult.src ||
                    (normalizedResult.sourceNodeId && asset.sourceNodeId === normalizedResult.sourceNodeId)
                );
                return exists ? current : [...current, normalizedResult];
            });
        },
        [editorNodeId, onAssetAddedToCanvas]
    );

    const handleAssetPicked = useCallback(
        (asset: EditorAssetInput) => {
            if (!editorNodeId || !onCanvasAssetLinked) return;
            const normalizedAsset = normalizeEditorAsset(asset);
            onCanvasAssetLinked(normalizedAsset, editorNodeId);
            const assetKey = getEditorAssetKey(asset);

            // Add to local assets state so it appears in the editor immediately
            setAssets((current) => {
                const exists = current.some((a) => getEditorAssetKey(a) === assetKey);
                return exists ? current : [...current, normalizedAsset];
            });

            // Remove from available assets since it's now picked
            setAvailableAssets((current) =>
                current.filter((a) => getEditorAssetKey(a) !== assetKey)
            );
        },
        [editorNodeId, onCanvasAssetLinked]
    );

    return (
        <VideoEditorContext.Provider value={{ isOpen, openEditor, closeEditor, exportVideo }}>
            {children}
            {isOpen && (
                <EditorModalDialog
                    open={isOpen}
                    onClose={closeEditor}
                    ariaLabel="Video editor"
                    panelTestId="video-editor-panel"
                    panelClassName="h-[min(920px,calc(100vh-48px))] w-[min(1480px,calc(100vw-48px))]"
                    closeOnInteractOutside={false}
                >
                    <Suspense
                        fallback={
                            <div className="flex h-full w-full items-center justify-center bg-[#fffdfb] text-sm font-medium text-slate-700 dark:text-slate-300">
                                Loading Editor...
                            </div>
                        }
                    >
                        <Editor
                            initialAssets={assets}
                            initialState={timelineDsl ?? undefined}
                            stateRef={editorStateRef}
                            onBack={closeEditor}
                            backLabel="返回"
                            onAssetUpload={handleAssetUpload}
                            availableAssets={availableAssets}
                            onAssetPicked={handleAssetPicked}
                            editorKey={editorNodeId ?? undefined}
                            onExport={exportVideo}
                        />
                    </Suspense>
                </EditorModalDialog>
            )}
        </VideoEditorContext.Provider>
    );
}

export function useVideoEditor() {
    const context = useContext(VideoEditorContext);
    if (!context) {
        throw new Error('useVideoEditor must be used within VideoEditorProvider');
    }
    return context;
}
