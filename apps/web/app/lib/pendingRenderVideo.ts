import type { EditorState } from "@master-clash/remotion-core";

import { calculateScaledDimensions } from "../app/components/nodes/assetNodeSizing";

export type PendingRenderTimelineDsl = Pick<
  EditorState,
  "tracks" | "compositionWidth" | "compositionHeight" | "fps" | "durationInFrames"
>;

export const DEFAULT_RENDER_DURATION_IN_FRAMES = 150;

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

export function buildPendingRenderVideoNodePayload(timelineDsl: PendingRenderTimelineDsl) {
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
    },
  };
}
