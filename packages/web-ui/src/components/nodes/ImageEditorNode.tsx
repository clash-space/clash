/**
 * ImageEditorNode — a copy-on-write image editing slot.
 *
 * Wiring:
 *   <upstream image> ──edge──> ImageEditorNode ──edge──> <new image>
 *
 * The node itself never holds an asset; double-click opens the editor modal
 * (ImageEditorContext) which reads the upstream image, lets the user adjust
 * crop/rotation, and on Apply spawns a fresh image node downstream. The
 * upstream asset is never mutated — that's the CoW invariant.
 */

import { memo, useCallback, useMemo } from 'react';
import { Handle, Position, NodeProps, useNodeConnections, useReactFlow, useStore, type Node } from '@xyflow/react';
import { PencilSimple, ImageSquare } from '@phosphor-icons/react';
import { useImageEditor } from '../ImageEditorContext';
import { useAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { SignedImg } from '../SignedMedia';
import { useProject } from '../ProjectContext';
import type { ImageEditParams } from '@clash/shared-types';
import { Button } from '../ui/button';

const ImageEditorNode = ({ id, data }: NodeProps<Node<Record<string, any>>>) => {
    const { openEditor } = useImageEditor();
    const { projectId } = useProject();
    const reactFlow = useReactFlow();
    const connections = useNodeConnections({ id });

    const upstreamImageNodeId = useMemo(() => {
        return connections.find((connection) => connection.target === id)?.source;
    }, [connections, id]);
    const upstreamAssetId = useStore(useCallback((state) => {
        if (!upstreamImageNodeId) return undefined;
        const upstreamNode = state.nodeLookup.get(upstreamImageNodeId);
        if (upstreamNode?.type !== 'image') return undefined;
        return (upstreamNode.data as Record<string, unknown> | undefined)?.assetId as string | undefined;
    }, [upstreamImageNodeId]));
    const upstreamAsset = useAsset(upstreamAssetId);
    const previewR2Key = upstreamAsset?.srcR2Key;

    const editParams: ImageEditParams = (data.editParams as ImageEditParams | undefined) ?? {};

    const handleOpen = useCallback(() => {
        if (!upstreamAsset || !upstreamAssetId || !previewR2Key) return;
        const naturalWidth = upstreamAsset.metadata?.width ?? 1024;
        const naturalHeight = upstreamAsset.metadata?.height ?? 1024;

        openEditor({
            editorNodeId: id,
            projectId,
            sourceAssetId: upstreamAssetId,
            sourceR2Key: previewR2Key,
            naturalWidth,
            naturalHeight,
            initialParams: editParams,
            nodes: reactFlow.getNodes() as Node[],
            edges: reactFlow.getEdges(),
            parentId: typeof data.parentId === 'string' ? data.parentId : undefined,
        });
    }, [upstreamAsset, upstreamAssetId, previewR2Key, editParams, id, projectId, openEditor, reactFlow, data.parentId]);

    // Build a one-line summary of current params for the card footer.
    const paramSummary = useMemo(() => {
        const parts: string[] = [];
        if (editParams.crop) {
            parts.push(`Crop ${editParams.crop.width}×${editParams.crop.height}`);
        }
        if (editParams.rotation) {
            parts.push(`Rotate ${editParams.rotation}°`);
        }
        return parts.length > 0 ? parts.join(' · ') : 'No edits applied';
    }, [editParams]);

    const ready = !!upstreamAsset;

    return (
        <div className="group relative w-[400px]" onDoubleClick={handleOpen}>
            <div className="w-full bg-warm-surface shadow-md rounded-matrix overflow-hidden ring-1 ring-warm-border transition-all duration-300 hover:shadow-lg">
                {/* Header */}
                <div className="absolute top-3 left-3 z-10">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-warm-surface/95 rounded-lg shadow-sm border border-warm-border">
                        <PencilSimple className="w-3.5 h-3.5 text-image" weight="fill" />
                        <span className="text-[10px] font-bold font-display text-slate-800 dark:text-slate-200 uppercase tracking-wide">Image Editor</span>
                    </div>
                </div>

                {/* Preview */}
                <div className="relative w-full aspect-video bg-stone-100 flex items-center justify-center overflow-hidden border-b border-warm-border">
                    {previewR2Key ? (
                        <SignedImg src={previewR2Key} alt="Source preview" className="w-full h-full object-cover pointer-events-none" />
                    ) : (
                        <div className="flex flex-col items-center gap-2 p-6 text-center">
                            <div className="rounded-2xl w-14 h-14 flex items-center justify-center bg-warm-surface shadow-sm border border-warm-border">
                                <ImageSquare className="w-7 h-7 text-stone-700 dark:text-stone-300" weight="duotone" />
                            </div>
                            <div className="text-xs text-slate-700 dark:text-slate-300">Connect an image to start editing</div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-warm-muted px-3 py-2 border-t border-warm-border flex items-center justify-between gap-2 h-10">
                    <span className="text-[11px] text-slate-700 dark:text-slate-300 truncate">{paramSummary}</span>
                    <Button
                        size="sm"
                        onClick={handleOpen}
                        disabled={!ready}
                        className="clash-node-primary min-h-0 rounded-xl px-3 py-1.5 text-xs font-bold shadow-sm"
                        leftIcon={<PencilSimple className="w-3.5 h-3.5" weight="fill" />}
                    >
                        Edit
                    </Button>
                </div>
            </div>

            <Handle
                type="target"
                position={Position.Left}
                id="source"
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-white !bg-stone-400 transition-all hover:!bg-image hover:scale-125 shadow-sm"
            />
            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-stone-400 transition-all hover:!bg-image hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(ImageEditorNode);
