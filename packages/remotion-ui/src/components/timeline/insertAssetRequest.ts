import {
  normalizeEditorAsset,
  type Asset,
  type EditorAssetInput,
  type Item,
  type Track,
} from "@clash/remotion-core";

export type TimelineAssetInsertRequest = {
  requestId: string;
  asset: EditorAssetInput;
};

export const TIMELINE_INSERT_MEDIA_FIT = "contain" as const;

export function createTimelineInsertProperties() {
  return {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    rotation: 0,
    opacity: 1,
  };
}

export function hasTimelineAssetInsertReceipt(
  tracks: readonly { id: string; items: readonly { id: string }[] }[],
  requestId: string,
): boolean {
  const trackId = `track-${requestId}`;
  const itemId = `item-${requestId}`;
  return tracks.some(
    (track) =>
      track.id === trackId && track.items.some((item) => item.id === itemId),
  );
}

export function buildTimelineAssetInsertion({
  asset: input,
  frame,
  fps,
  requestId,
}: TimelineAssetInsertRequest & {
  frame: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
}): { asset: Asset; track: Track } {
  const { waveform: _waveform, ...asset } = normalizeEditorAsset(input);
  const sourceNodeId = asset.sourceNodeId ?? asset.id;
  const projectAssetId = asset.projectAssetId;
  if (!projectAssetId) {
    throw new Error(
      "Timeline media must be admitted as a Project Asset before insertion",
    );
  }
  // The renderer treats 1 × 1 as its contain-fit sentinel: it scales both
  // axes uniformly from the source's natural dimensions. Pre-scaling one axis
  // here would apply that adjustment a second time and visibly distort media.
  const properties = createTimelineInsertProperties();
  const durationInFrames =
    asset.type === "image"
      ? 90
      : asset.duration
        ? Math.max(1, Math.round(asset.duration * fps))
        : 90;
  const common = {
    id: `item-${requestId}`,
    assetId: projectAssetId,
    sourceNodeId,
    from: Math.max(0, Math.round(frame)),
    durationInFrames,
    src: asset.src,
    properties,
  };
  const item: Item =
    asset.type === "image"
      ? {
          ...common,
          type: "image",
          mediaFit: TIMELINE_INSERT_MEDIA_FIT,
        }
      : asset.type === "video"
        ? {
            ...common,
            type: "video",
            mediaFit: TIMELINE_INSERT_MEDIA_FIT,
            sourceStartInFrames: 0,
          }
        : {
            ...common,
            type: "audio",
            sourceStartInFrames: 0,
          };

  return {
    asset,
    track: {
      id: `track-${requestId}`,
      name: asset.type.charAt(0).toUpperCase() + asset.type.slice(1),
      items: [item],
    },
  };
}
