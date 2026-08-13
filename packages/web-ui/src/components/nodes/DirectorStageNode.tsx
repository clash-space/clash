import { memo, useCallback, useEffect, useState } from "react";
import { Cube, UsersThree, Camera } from "@phosphor-icons/react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  DirectorReferencePacketSchema,
  readProjectDirectorStage,
  type ProjectDirectorStage,
} from "@clash/shared-types";
import { useDirectorStage } from "../DirectorStageContext";
import { useOptionalLoroSyncContext } from "../LoroSyncContext";
import { useProject } from "../ProjectContext";
import { useAsset } from "../../lib/hooks/useAsset";
import { Button } from "../ui/button";

function DirectorStageNode({ data }: NodeProps<Node<Record<string, unknown>>>) {
  const { openDirectorStage } = useDirectorStage();
  const { projectId } = useProject();
  const loroSync = useOptionalLoroSyncContext();
  const stageId = typeof data.stageId === "string" ? data.stageId : "";
  const [stage, setStage] = useState<ProjectDirectorStage | null>(() =>
    loroSync?.doc && stageId
      ? readProjectDirectorStage(loroSync.doc, stageId)
      : null,
  );

  useEffect(() => {
    if (!loroSync?.doc || !stageId) {
      setStage(null);
      return;
    }
    const refresh = () =>
      setStage(readProjectDirectorStage(loroSync.doc!, stageId));
    refresh();
    return loroSync.doc.subscribe(refresh);
  }, [loroSync?.doc, stageId]);

  const handleOpen = useCallback(() => {
    if (stage) openDirectorStage(stage.id);
  }, [openDirectorStage, stage]);

  const label =
    stage?.name ??
    (typeof data.label === "string" ? data.label : "Director Stage");
  const referencePacketResult = DirectorReferencePacketSchema.safeParse(
    data.directorReferencePacket,
  );
  const referencePacket = referencePacketResult.success
    ? referencePacketResult.data
    : undefined;
  const outputVideoAssetId =
    referencePacket?.referenceVideo.assetId ??
    (typeof data.outputVideoAssetId === "string"
      ? data.outputVideoAssetId
      : "");
  const outputVideo = useAsset(projectId, outputVideoAssetId);
  const outputVideoSrc = outputVideo?.url ?? "";

  return (
    <div
      className="group relative w-[400px]"
      data-director-stage-action={stageId}
      onDoubleClick={handleOpen}
    >
      <div className="overflow-hidden rounded-matrix bg-warm-surface shadow-md ring-1 ring-warm-border transition-shadow hover:shadow-lg">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-[#101114]">
          {outputVideoSrc ? (
            <video
              className="absolute inset-0 h-full w-full object-cover"
              src={outputVideoSrc}
              muted
              playsInline
              preload="metadata"
            />
          ) : null}
          {outputVideoSrc ? (
            <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/15" />
          ) : null}
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/65 px-2.5 py-1 text-white shadow-sm backdrop-blur-sm">
            <Cube className="h-3.5 w-3.5 text-brand" weight="duotone" />
            <span className="font-display text-[10px] font-bold uppercase tracking-wide">
              Director Stage
            </span>
          </div>
          <div
            className={`${outputVideoSrc ? "hidden" : "grid"} h-28 w-48 grid-cols-2 gap-3 rounded-xl border border-white/10 bg-white/[0.035] p-4 text-stone-300`}
          >
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-white/[0.04]">
              <UsersThree className="h-7 w-7 text-stone-300" weight="duotone" />
              <span className="text-[10px]">
                {stage?.state.objects.length ?? 0} objects
              </span>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg bg-white/[0.04]">
              <Camera className="h-7 w-7 text-stone-300" weight="duotone" />
              <span className="text-[10px]">
                {stage?.state.cameras.length ?? 0} cameras
              </span>
            </div>
          </div>
        </div>
        <div className="flex h-12 items-center justify-between gap-3 border-t border-warm-border bg-warm-muted px-3">
          <div className="min-w-0">
            <div className="truncate font-display text-xs font-semibold text-content-primary">
              {label}
            </div>
            {outputVideoAssetId ? (
              <div className="text-[10px] font-medium text-content-secondary">
                Reference video ready
              </div>
            ) : null}
          </div>
          <Button
            size="sm"
            disabled={!stage}
            onClick={handleOpen}
            className="clash-node-primary min-h-0 shrink-0 rounded-xl px-3 py-1.5 text-xs font-bold"
          >
            Open Director Stage
          </Button>
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="!h-4 !w-4 !translate-x-2 !border-4 !border-white !bg-stone-400 shadow-sm transition-all hover:scale-125 hover:!bg-brand"
      />
    </div>
  );
}

export default memo(DirectorStageNode);
