/**
 * VideoClipperNode — copy-on-write screenshot/crop slot for a video.
 *
 * Wiring:
 *   <upstream video> ──edge──> VideoClipperNode ──edge──> <new image>
 *
 * Only Screenshot mode produces output in v1. The node is always CoW: the
 * upstream video asset is never mutated.
 */

import { memo, useCallback, useMemo } from "react";
import {
  Handle,
  Position,
  NodeProps,
  useNodeConnections,
  useReactFlow,
  useStore,
  type Node,
} from "@xyflow/react";
import { Camera, FilmStrip } from "@phosphor-icons/react";
import { useVideoClipper } from "../VideoClipperContext";
import { useAsset } from "@clash/web-ui/lib/hooks/useAsset";
import { useProject } from "../ProjectContext";
import type { VideoClipParams } from "@clash/shared-types";
import { Button } from "../ui/button";
import { VideoPoster } from "../../features/assets/VideoPoster";

const VideoClipperNode = ({
  id,
  data,
}: NodeProps<Node<Record<string, any>>>) => {
  const { openEditor } = useVideoClipper();
  const { projectId } = useProject();
  const reactFlow = useReactFlow();
  const connections = useNodeConnections({ id });

  const upstreamVideoNodeId = useMemo(() => {
    return connections.find((connection) => connection.target === id)?.source;
  }, [connections, id]);
  const upstreamAssetId = useStore(
    useCallback(
      (state) => {
        if (!upstreamVideoNodeId) return undefined;
        const upstreamNode = state.nodeLookup.get(upstreamVideoNodeId);
        if (upstreamNode?.type !== "video") return undefined;
        return (upstreamNode.data as Record<string, unknown> | undefined)
          ?.assetId as string | undefined;
      },
      [upstreamVideoNodeId],
    ),
  );
  const upstreamAsset = useAsset(projectId, upstreamAssetId);

  const editParams: VideoClipParams | undefined = data.editParams as
    VideoClipParams | undefined;

  const handleOpen = useCallback(() => {
    if (
      upstreamAsset?.status !== "ready" ||
      !upstreamAsset.url ||
      !upstreamAssetId
    )
      return;
    const durationSec = (upstreamAsset.metadata?.durationMs ?? 0) / 1000;
    openEditor({
      editorNodeId: id,
      projectId,
      sourceAssetId: upstreamAssetId,
      sourceUrl: upstreamAsset.url,
      durationSec: durationSec || 1,
      initialParams: editParams,
      nodes: reactFlow.getNodes() as Node[],
      edges: reactFlow.getEdges(),
      parentId: typeof data.parentId === "string" ? data.parentId : undefined,
    });
  }, [
    upstreamAsset,
    upstreamAssetId,
    editParams,
    id,
    projectId,
    openEditor,
    reactFlow,
    data.parentId,
  ]);

  const paramSummary = useMemo(() => {
    if (!editParams) return "No clip configured";
    if (editParams.mode === "screenshot")
      return `Frame @ ${editParams.frameTimeSec.toFixed(2)}s`;
    return `Range ${editParams.startSec.toFixed(2)}–${editParams.endSec.toFixed(2)}s`;
  }, [editParams]);

  const ready = upstreamAsset?.status === "ready" && Boolean(upstreamAsset.url);

  return (
    <div className="group relative w-[400px]" onDoubleClick={handleOpen}>
      <div className="w-full bg-warm-surface shadow-md rounded-matrix overflow-hidden ring-1 ring-warm-border transition-all duration-300 hover:shadow-lg">
        <div className="absolute top-3 left-3 z-10">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-warm-surface/95 rounded-lg shadow-sm border border-warm-border">
            <FilmStrip className="w-3.5 h-3.5 text-video" weight="fill" />
            <span className="font-display text-[10px] font-bold uppercase tracking-wide text-content-primary">
              Video Clipper
            </span>
          </div>
        </div>

        <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden border-b border-warm-border bg-warm-muted">
          {upstreamAsset ? (
            <VideoPoster
              thumbnailSrc={upstreamAsset.thumbnailUrl}
              videoSrc={upstreamAsset.url}
              status={upstreamAsset.status}
              alt="Source poster"
              className="w-full h-full object-cover pointer-events-none"
              fallback={
                <div className="flex flex-col items-center gap-2 p-6 text-center">
                  <div className="rounded-2xl w-14 h-14 flex items-center justify-center bg-warm-surface shadow-sm border border-warm-border">
                    <FilmStrip
                      className="w-7 h-7 text-stone-700 dark:text-stone-300"
                      weight="duotone"
                    />
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300">
                    {upstreamAsset.status === "ready"
                      ? "Preparing source poster"
                      : "Source video unavailable"}
                  </div>
                </div>
              }
            />
          ) : (
            <div className="flex flex-col items-center gap-2 p-6 text-center">
              <div className="rounded-2xl w-14 h-14 flex items-center justify-center bg-warm-surface shadow-sm border border-warm-border">
                <FilmStrip
                  className="w-7 h-7 text-stone-700 dark:text-stone-300"
                  weight="duotone"
                />
              </div>
              <div className="text-xs text-slate-700 dark:text-slate-300">
                Connect a video to start clipping
              </div>
            </div>
          )}
        </div>

        <div className="bg-warm-muted px-3 py-2 border-t border-warm-border flex items-center justify-between gap-2 h-10">
          <span className="text-[11px] text-slate-700 dark:text-slate-300 truncate">
            {paramSummary}
          </span>
          <Button
            size="sm"
            onClick={handleOpen}
            disabled={!ready}
            className="clash-node-primary min-h-0 rounded-xl px-3 py-1.5 text-xs font-bold shadow-sm"
            leftIcon={<Camera className="w-3.5 h-3.5" weight="fill" />}
          >
            Clip
          </Button>
        </div>
      </div>

      <Handle
        type="target"
        position={Position.Left}
        id="source"
        className="!h-4 !w-4 !-translate-x-2 !border-4 !border-white !bg-stone-400 transition-all hover:!bg-video hover:scale-125 shadow-sm"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-stone-400 transition-all hover:!bg-video hover:scale-125 shadow-sm"
      />
    </div>
  );
};

export default memo(VideoClipperNode);
