'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { EditorState, TimelineDsl, Track } from '@master-clash/remotion-core';
import type { Node, Edge } from 'reactflow';
import { useOptionalLoroSyncContext } from './LoroSyncContext';
import { autoInsertNode } from '@/lib/layout';

/**
 * Convert R2 key to frontend view URL for displaying in editor
 * R2 key: "projects/xxx/assets/..." -> View URL: "/api/assets/view/projects/xxx/assets/..."
 */
function r2KeyToViewUrl(r2Key: string): string {
    if (!r2Key.startsWith('projects/') && !r2Key.startsWith('/projects/')) {
        return r2Key; // Not an R2 key, return as-is
    }
    const normalizedKey = r2Key.startsWith('/') ? r2Key : `/${r2Key}`;
    return `/api/assets/view${normalizedKey}`;
}

/**
 * Convert frontend view URL to R2 key for storage
 * View URL: "/api/assets/view/projects/xxx/assets/..." -> R2 key: "projects/xxx/assets/..."
 */
function viewUrlToR2Key(viewUrl: string): string {
    if (!viewUrl.startsWith('/api/assets/view/') && !viewUrl.startsWith('/api/assets/')) {
        return viewUrl; // Not a view URL, return as-is
    }
    if (viewUrl.startsWith('/api/assets/view/')) {
        return viewUrl.replace('/api/assets/view/', '');
    }
    return viewUrl.replace('/api/assets/', '');
}

/**
 * Convert all src URLs in tracks from R2 keys to view URLs (for editor display)
 */
function convertTracksToViewUrls(tracks: Track[]): Track[] {
    return tracks.map(track => ({
        ...track,
        items: track.items.map(item => {
            if (!('src' in item) || typeof item.src !== 'string') {
                return item;
            }
            return {
                ...item,
                src: r2KeyToViewUrl(item.src),
            };
        }),
    }));
}

/**
 * Convert all src URLs in tracks from view URLs to R2 keys (for storage)
 */
function convertTracksToR2Keys(tracks: Track[]): Track[] {
    return tracks.map(track => ({
        ...track,
        items: track.items.map(item => {
            if (!('src' in item) || typeof item.src !== 'string') {
                return item;
            }
            return {
                ...item,
                src: viewUrlToR2Key(item.src),
            };
        }),
    }));
}

const Editor = dynamic(() => import('@master-clash/remotion-ui').then(mod => mod.Editor), {
    ssr: false,
    loading: () => <div className="text-white p-4">Loading Editor...</div>
});

interface Asset {
    id: string;
    type: 'video' | 'image' | 'audio';
    src: string;
    name?: string;
    width?: number;
    height?: number;
    duration?: number;
    sourceNodeId?: string;
}

// Use TimelineDsl from remotion-core
type TimelineDslType = Pick<
    EditorState,
    'tracks' | 'compositionWidth' | 'compositionHeight' | 'fps' | 'durationInFrames'
>;

interface VideoEditorContextType {
    isOpen: boolean;
    openEditor: (
        assets: Asset[],
        nodeId: string,
        timelineDsl?: TimelineDslType | null,
        availableAssets?: Array<Asset & { sourceNodeId?: string }>
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
    ) => Promise<Asset | null> | Asset | null;
    onCanvasAssetLinked?: (asset: Asset & { sourceNodeId?: string }, editorNodeId: string) => void;
    nodes?: Node[];
    edges?: Edge[];
}) {
    const loroSync = useOptionalLoroSyncContext();
    const [isOpen, setIsOpen] = useState(false);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [availableAssets, setAvailableAssets] = useState<Array<Asset & { sourceNodeId?: string }>>([]);
    const [timelineDsl, setTimelineDsl] = useState<TimelineDsl | null>(null);
    const [editorNodeId, setEditorNodeId] = useState<string | null>(null);

    // Ref to read editor state on close - no callbacks during playback
    const editorStateRef = useRef<EditorState | null>(null);

    const openEditor = useCallback((
        newAssets: Asset[],
        nodeId: string,
        nextTimelineDsl?: TimelineDslType | null,
        nextAvailableAssets: Array<Asset & { sourceNodeId?: string }> = []
    ) => {

        // Deduplicate assets before setting
        const seenKeys = new Set<string>();
        const deduplicatedAssets = newAssets.filter(asset => {
            const key = asset.sourceNodeId || asset.id;
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

        // Convert R2 keys to view URLs for editor display
        const convertedTimelineDsl = processedDsl ? {
            ...processedDsl,
            tracks: convertTracksToViewUrls(processedDsl.tracks),
        } : null;
        setTimelineDsl(convertedTimelineDsl);

        setAvailableAssets(nextAvailableAssets);
        setIsOpen(true);
    }, []);

    const closeEditor = useCallback(() => {
        // Save state on close - read from ref
        if (editorNodeId && editorStateRef.current && loroSync?.connected) {
            const state = editorStateRef.current;

            // Convert view URLs back to R2 keys for storage
            const finalDsl: TimelineDslType = {
                tracks: convertTracksToR2Keys(state.tracks),
                compositionWidth: state.compositionWidth,
                compositionHeight: state.compositionHeight,
                fps: state.fps,
                durationInFrames: state.durationInFrames,
            };
            loroSync.updateNode(editorNodeId, {
                data: { timelineDsl: finalDsl },
            });
        }

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

        // Calculate actual video duration from timeline content
        let maxEndFrame = 0;
        for (const track of state.tracks) {
            for (const item of track.items) {
                const endFrame = item.from + item.durationInFrames;
                if (endFrame > maxEndFrame) {
                    maxEndFrame = endFrame;
                }
            }
        }

        // Create DSL for export (deep copy and convert view URLs to R2 keys for storage)
        const finalDsl: TimelineDslType = {
            tracks: convertTracksToR2Keys(state.tracks),  // Convert to R2 keys for storage
            compositionWidth: state.compositionWidth,
            compositionHeight: state.compositionHeight,
            fps: state.fps,
            durationInFrames: maxEndFrame,  // Use calculated duration instead of state value
        };

        // Check if there's any content
        if (!finalDsl.tracks || finalDsl.tracks.length === 0) {
            alert('Please add some content to the timeline before exporting!');
            return;
        }

        const durationInSeconds = maxEndFrame / finalDsl.fps;

        // Calculate actual natural dimensions from source assets (not canvas size)
        // Find the largest asset dimensions in the timeline
        let maxAssetWidth = 0;
        let maxAssetHeight = 0;
        for (const track of finalDsl.tracks) {
            for (const item of track.items) {
                if ('assetId' in item && item.assetId) {
                    const asset = state.assets.find(a => a.id === item.assetId || a.sourceNodeId === item.assetId);
                    if (asset && asset.width && asset.height) {
                        // Only consider assets that are larger than canvas (true source resolution)
                        if (asset.width > maxAssetWidth) maxAssetWidth = asset.width;
                        if (asset.height > maxAssetHeight) maxAssetHeight = asset.height;
                    }
                }
            }
        }
        // Fallback to canvas size if no assets found
        const naturalWidth = maxAssetWidth > 0 ? maxAssetWidth : state.compositionWidth;
        const naturalHeight = maxAssetHeight > 0 ? maxAssetHeight : state.compositionHeight;

        // Create a new video node with the rendered content
        const newVideoNodeId = `video-${Date.now()}`;

        // Use autoInsertNode for precise client-side layout
        // Create temporary edge and node objects for calculation
        const tempEdge = {
            id: `temp-edge-${editorNodeId}-${newVideoNodeId}`,
            source: editorNodeId,
            target: newVideoNodeId,
            type: 'default'
        };
        const currentNodes = nodes || [];
        const currentEdges = edges || [];

        const editorNode = currentNodes.find(n => n.id === editorNodeId);
        const tempNode = {
            id: newVideoNodeId,
            type: 'video',
            position: { x: 0, y: 0 },
            data: {},
            parentId: editorNode?.parentId,
            width: state.compositionWidth > 500 ? 500 : state.compositionWidth, // Approx width
            height: state.compositionHeight > 500 ? 500 : state.compositionHeight,
        } as Node;

        // Run auto-layout calculation
        const layoutResult = autoInsertNode(newVideoNodeId, [...currentNodes, tempNode], [...currentEdges, tempEdge]);
        const finalPosition = layoutResult.position;


        const newVideoNode = {
            id: newVideoNodeId,
            type: 'video',
            position: finalPosition,
            parentId: editorNode?.parentId,
            data: {
                label: `Rendered Video`,
                src: null,  // Will be filled by callback when rendering completes
                status: 'pending',
                duration: durationInSeconds,
                timelineDsl: finalDsl,
                pendingTask: null,
                // Use actual source asset dimensions, not canvas size
                naturalWidth,
                naturalHeight,
            },
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
            setAssets((current) => {
                const exists = current.some((asset) =>
                    asset.id === result.id ||
                    asset.src === result.src ||
                    (result.sourceNodeId && asset.sourceNodeId === result.sourceNodeId)
                );
                return exists ? current : [...current, result];
            });
        },
        [editorNodeId, onAssetAddedToCanvas]
    );

    const handleAssetPicked = useCallback(
        (asset: Asset & { sourceNodeId?: string }) => {
            if (!editorNodeId || !onCanvasAssetLinked) return;
            onCanvasAssetLinked(asset, editorNodeId);

            // Add to local assets state so it appears in the editor immediately
            setAssets((current) => {
                const exists = current.some((a) =>
                    a.id === asset.id ||
                    (asset.sourceNodeId && a.sourceNodeId === asset.sourceNodeId)
                );
                return exists ? current : [...current, asset];
            });

            // Remove from available assets since it's now picked
            setAvailableAssets((current) =>
                current.filter(a => a.id !== asset.id && a.sourceNodeId !== asset.sourceNodeId)
            );
        },
        [editorNodeId, onCanvasAssetLinked]
    );

    return (
        <VideoEditorContext.Provider value={{ isOpen, openEditor, closeEditor, exportVideo }}>
            {children}
            {/* Full-screen editor overlay - no animation for performance */}
            {isOpen && (
                <div className="fixed inset-0 z-[100] bg-[#1a1a1a]">
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
                </div>
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
