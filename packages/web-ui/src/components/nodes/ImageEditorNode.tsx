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
import { Handle, Position, NodeProps, useReactFlow, useNodes, useEdges, type Node } from '@xyflow/react';
import { PencilSimple, ImageSquare } from '@phosphor-icons/react';
import { useImageEditor } from '../ImageEditorContext';
import { useAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { SignedImg } from '../SignedMedia';
import { useProject } from '../ProjectContext';
import type { ImageEditParams } from '@clash/shared-types';

const ImageEditorNode = ({ id, data }: NodeProps<Node<Record<string, any>>>) => {
    const { openEditor } = useImageEditor();
    const { projectId } = useProject();
    const reactFlow = useReactFlow();
    const allNodes = useNodes();
    const allEdges = useEdges();

    // Resolve the upstream image node connected to our target handle.
    // ImageEditor accepts at most one upstream image — `useEdges` is reactive,
    // so adding/removing an edge updates the preview immediately.
    const upstreamImageNodeId = useMemo(() => {
        const incoming = allEdges.filter((e) => e.target === id);
        for (const e of incoming) {
            const src = allNodes.find((n) => n.id === e.source);
            if (src?.type === 'image') return src.id;
        }
        return undefined;
    }, [allEdges, allNodes, id]);

    const upstreamNode = upstreamImageNodeId
        ? allNodes.find((n) => n.id === upstreamImageNodeId)
        : undefined;
    const upstreamAssetId = (upstreamNode?.data as Record<string, unknown> | undefined)?.assetId as string | undefined;
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
            <div className="w-full bg-white shadow-md rounded-matrix overflow-hidden ring-1 ring-slate-200 transition-all duration-300 hover:shadow-lg">
                {/* Header */}
                <div className="absolute top-3 left-3 z-10">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/90 backdrop-blur-sm rounded-full shadow-sm border border-slate-200/50">
                        <PencilSimple className="w-3.5 h-3.5 text-emerald-500" weight="fill" />
                        <span className="text-[10px] font-bold font-display text-slate-700 uppercase tracking-wide">Image Editor</span>
                    </div>
                </div>

                {/* Preview */}
                <div className="relative w-full aspect-video bg-stone-100 flex items-center justify-center overflow-hidden border-b border-slate-100">
                    {previewR2Key ? (
                        <SignedImg src={previewR2Key} alt="Source preview" className="w-full h-full object-cover pointer-events-none" />
                    ) : (
                        <div className="flex flex-col items-center gap-2 p-6 text-center">
                            <div className="rounded-full w-14 h-14 flex items-center justify-center bg-white shadow-sm">
                                <ImageSquare className="w-7 h-7 text-stone-400" weight="duotone" />
                            </div>
                            <div className="text-xs text-slate-500">Connect an image to start editing</div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="bg-slate-50 px-3 py-2 border-t border-slate-100 flex items-center justify-between gap-2 h-10">
                    <span className="text-[11px] text-slate-500 truncate">{paramSummary}</span>
                    <button
                        onClick={handleOpen}
                        disabled={!ready}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-700 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                    >
                        <PencilSimple className="w-3.5 h-3.5" weight="fill" />
                        Edit
                    </button>
                </div>
            </div>

            <Handle
                type="target"
                position={Position.Left}
                id="source"
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-emerald-500 hover:scale-125 shadow-sm"
            />
            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-emerald-500 hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(ImageEditorNode);
