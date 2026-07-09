import type { EditorState } from "@master-clash/remotion-core";
import { timelineDslHash } from "@clash/shared-types";

import { calculateScaledDimensions } from "../components/nodes/assetNodeSizing";

export type PendingRenderTimelineDsl = Pick<
  EditorState,
  "tracks" | "compositionWidth" | "compositionHeight" | "fps" | "durationInFrames"
>;

export const DEFAULT_RENDER_DURATION_IN_FRAMES = 150;

export interface PendingRenderAppliedTimelineRevision {
  timelineId: string;
  revisionId: string;
  timelineHash: string;
  loroFrontiers?: unknown;
  loroVersionVector?: unknown;
}

export interface PendingRenderTimelineProvenance {
  sourceTimelineNodeId?: string;
  appliedRevision?: PendingRenderAppliedTimelineRevision | null;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function readPendingRenderAppliedTimelineRevision(
  nodeData: unknown,
): PendingRenderAppliedTimelineRevision | null {
  if (!isRecord(nodeData)) return null;
  const candidate = isRecord(nodeData.appliedRevision)
    ? nodeData.appliedRevision
    : isRecord(nodeData.timelineRevision)
      ? nodeData.timelineRevision
      : null;
  if (!candidate) return null;
  if (
    typeof candidate.timelineId !== "string" ||
    typeof candidate.revisionId !== "string" ||
    typeof candidate.timelineHash !== "string"
  ) {
    return null;
  }
  return {
    timelineId: candidate.timelineId,
    revisionId: candidate.revisionId,
    timelineHash: candidate.timelineHash,
    ...(candidate.loroFrontiers !== undefined ? { loroFrontiers: candidate.loroFrontiers } : {}),
    ...(candidate.loroVersionVector !== undefined ? { loroVersionVector: candidate.loroVersionVector } : {}),
  };
}

async function timelineProvenanceData(
  timelineDsl: PendingRenderTimelineDsl,
  options?: PendingRenderTimelineProvenance,
) {
  const appliedRevision = options?.appliedRevision;
  if (!appliedRevision) {
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
  return {
    ...(options?.sourceTimelineNodeId ? { sourceTimelineNodeId: options.sourceTimelineNodeId } : {}),
    sourceTimelineId: appliedRevision.timelineId,
    sourceTimelineRevisionId: appliedRevision.revisionId,
    sourceTimelineHash: appliedRevision.timelineHash,
    sourceTimelineRevisionStatus: "applied",
    ...(appliedRevision.loroFrontiers !== undefined
      ? { sourceTimelineFrontiers: appliedRevision.loroFrontiers }
      : {}),
    ...(appliedRevision.loroVersionVector !== undefined
      ? { sourceTimelineVersionVector: appliedRevision.loroVersionVector }
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
