/**
 * VideoClipperNode — copy-on-write screenshot/crop slot for a video.
 *
 * Wiring:
 *   <upstream video> ──edge──> VideoClipperNode ──edge──> <new image>
 *
 * Only Screenshot mode produces output in v1. The node is always CoW: the
 * upstream video asset is never mutated.
 */

import { memo, useCallback, useMemo } from 'react';
import { Handle, Position, NodeProps, useReactFlow, useNodes, useEdges, type Node } from '@xyflow/react';
import { Camera, FilmStrip } from '@phosphor-icons/react';
import { useVideoClipper } from '../VideoClipperContext';
import { useAsset } from '@clash/web-ui/lib/hooks/useAsset';
import { SignedImg } from '../SignedMedia';
import { useProject } from '../ProjectContext';
import type { VideoClipParams } from '@clash/shared-types';

const VideoClipperNode = ({ id, data }: NodeProps<Node<Record<string, any>>>) => {
    const { openEditor } = useVideoClipper();
    const { projectId } = useProject();
    const reactFlow = useReactFlow();
    const allNodes = useNodes();
    const allEdges = useEdges();

    const upstreamVideoNodeId = useMemo(() => {
        const incoming = allEdges.filter((e) => e.target === id);
        for (const e of incoming) {
            const src = allNodes.find((n) => n.id === e.source);
            if (src?.type === 'video') return src.id;
        }
        return undefined;
    }, [allEdges, allNodes, id]);

    const upstreamNode = upstreamVideoNodeId
        ? allNodes.find((n) => n.id === upstreamVideoNodeId)
        : undefined;
    const upstreamAssetId = (upstreamNode?.data as Record<string, unknown> | undefined)?.assetId as string | undefined;
    const upstreamAsset = useAsset(upstreamAssetId);
    const previewR2Key = upstreamAsset?.coverR2Key ?? undefined;

    const editParams: VideoClipParams | undefined = data.editParams as VideoClipParams | undefined;

    const handleOpen = useCallback(() => {
        if (!upstreamAsset || !upstreamAssetId) return;
        const durationSec = (upstreamAsset.metadata?.durationMs ?? 0) / 1000;
        openEditor({
            editorNodeId: id,
            projectId,
            sourceAssetId: upstreamAssetId,
            sourceR2Key: upstreamAsset.srcR2Key,
            durationSec: durationSec || 1,
            initialParams: editParams,
            nodes: reactFlow.getNodes() as Node[],
            edges: reactFlow.getEdges(),
            parentId: typeof data.parentId === 'string' ? data.parentId : undefined,
        });
    }, [upstreamAsset, upstreamAssetId, editParams, id, projectId, openEditor, reactFlow, data.parentId]);

    const paramSummary = useMemo(() => {
        if (!editParams) return 'No clip configured';
        if (editParams.mode === 'screenshot') return `Frame @ ${editParams.frameTimeSec.toFixed(2)}s`;
        return `Range ${editParams.startSec.toFixed(2)}–${editParams.endSec.toFixed(2)}s`;
    }, [editParams]);

    const ready = !!upstreamAsset;

    return (
        <div className="group relative w-[400px]" onDoubleClick={handleOpen}>
            <div className="w-full bg-white shadow-md rounded-matrix overflow-hidden ring-1 ring-slate-200 transition-all duration-300 hover:shadow-lg">
                <div className="absolute top-3 left-3 z-10">
                    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white/90 backdrop-blur-sm rounded-full shadow-sm border border-slate-200/50">
                        <FilmStrip className="w-3.5 h-3.5 text-purple-500" weight="fill" />
                        <span className="text-[10px] font-bold font-display text-slate-700 uppercase tracking-wide">Video Clipper</span>
                    </div>
                </div>

                <div className="relative w-full aspect-video bg-stone-100 flex items-center justify-center overflow-hidden border-b border-slate-100">
                    {previewR2Key ? (
                        <SignedImg src={previewR2Key} alt="Source poster" className="w-full h-full object-cover pointer-events-none" />
                    ) : (
                        <div className="flex flex-col items-center gap-2 p-6 text-center">
                            <div className="rounded-full w-14 h-14 flex items-center justify-center bg-white shadow-sm">
                                <FilmStrip className="w-7 h-7 text-stone-400" weight="duotone" />
                            </div>
                            <div className="text-xs text-slate-500">Connect a video to start clipping</div>
                        </div>
                    )}
                </div>

                <div className="bg-slate-50 px-3 py-2 border-t border-slate-100 flex items-center justify-between gap-2 h-10">
                    <span className="text-[11px] text-slate-500 truncate">{paramSummary}</span>
                    <button
                        onClick={handleOpen}
                        disabled={!ready}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-slate-900 hover:bg-slate-700 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm active:scale-95"
                    >
                        <Camera className="w-3.5 h-3.5" weight="fill" />
                        Clip
                    </button>
                </div>
            </div>

            <Handle
                type="target"
                position={Position.Left}
                id="source"
                className="!h-4 !w-4 !-translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-purple-500 hover:scale-125 shadow-sm"
            />
            <Handle
                type="source"
                position={Position.Right}
                id="output"
                className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-slate-400 transition-all hover:!bg-purple-500 hover:scale-125 shadow-sm"
            />
        </div>
    );
};

export default memo(VideoClipperNode);
