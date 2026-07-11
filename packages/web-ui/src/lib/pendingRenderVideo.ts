import type { EditorState } from "@master-clash/remotion-core";
import { timelineDslHash } from "@clash/shared-types";

import { calculateScaledDimensions } from "../components/nodes/assetNodeSizing";

export type PendingRenderTimelineDsl = Pick<
  EditorState,
  "tracks" | "compositionWidth" | "compositionHeight" | "fps" | "durationInFrames"
>;

export const DEFAULT_RENDER_DURATION_IN_FRAMES = 150;

export interface PendingRenderTimelineProvenance {
  sourceTimelineNodeId?: string;
  timelineRevision?: {
    timelineId: string;
    revisionId: string;
  };
}

export function getTimelineDurationInFrames(
  tracks: PendingRenderTimelineDsl["tracks"],
  fallback = DEFAULT_RENDER_DURATION_IN_FRAMES,
): number {
  let maxEndFrame = 0;

  for (const track of tracks || []) {
    for (const item of track.items || []) {
      const from = typeof item.from === "number" ? item.from : 0;
      const duration = typeof item.durationInFrames === "number" ? item.durationInFrames : 0;
      maxEndFrame = Math.max(maxEndFrame, from + duration);
    }
  }

  return maxEndFrame > 0 ? maxEndFrame : fallback;
}

async function timelineProvenanceData(
  timelineDsl: PendingRenderTimelineDsl,
  options?: PendingRenderTimelineProvenance,
) {
  const timelineRevision = options?.timelineRevision;
  if (timelineRevision) {
    return {
      ...(options?.sourceTimelineNodeId ? { sourceTimelineNodeId: options.sourceTimelineNodeId } : {}),
      sourceTimelineId: timelineRevision.timelineId,
      sourceTimelineRevisionId: timelineRevision.revisionId,
      sourceTimelineHash: await timelineDslHash(timelineDsl),
      sourceTimelineRevisionStatus: "applied",
    };
  }
  return {
    ...(options?.sourceTimelineNodeId ? { sourceTimelineNodeId: options.sourceTimelineNodeId } : {}),
    ...(options?.sourceTimelineNodeId
      ? {
          sourceTimelineHash: await timelineDslHash(timelineDsl),
          sourceTimelineRevisionStatus: "draft-canvas",
        }
      : {}),
  };
}

export async function buildPendingRenderVideoNodePayload(
  timelineDsl: PendingRenderTimelineDsl,
  provenance?: PendingRenderTimelineProvenance,
) {
  const naturalWidth =
    typeof timelineDsl.compositionWidth === "number" && timelineDsl.compositionWidth > 0
      ? timelineDsl.compositionWidth
      : 1920;
  const naturalHeight =
    typeof timelineDsl.compositionHeight === "number" && timelineDsl.compositionHeight > 0
      ? timelineDsl.compositionHeight
      : 1080;
  const measuredSize = calculateScaledDimensions(naturalWidth, naturalHeight);

  return {
    width: measuredSize.width,
    height: measuredSize.height,
    style: {
      width: measuredSize.width,
      height: measuredSize.height,
    },
    data: {
      label: "Rendered Video",
      status: "pending",
      timelineDsl,
      pendingTask: null,
      naturalWidth,
      naturalHeight,
      aspectRatio: `${naturalWidth}:${naturalHeight}`,
      ...(await timelineProvenanceData(timelineDsl, provenance)),
    },
  };
}
