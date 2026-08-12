import {
  normalizeEditorAsset,
  type Asset,
  type EditorAssetInput,
  type Item,
  type Track,
} from '@clash/remotion-core';

export type TimelineAssetInsertRequest = {
  requestId: string;
  asset: EditorAssetInput;
};

export function hasTimelineAssetInsertReceipt(
  tracks: readonly { id: string; items: readonly { id: string }[] }[],
  requestId: string,
): boolean {
  const trackId = `track-${requestId}`;
  const itemId = `item-${requestId}`;
  return tracks.some(
    (track) => track.id === trackId && track.items.some((item) => item.id === itemId),
  );
}

export function buildTimelineAssetInsertion({
  asset: input,
  frame,
  fps,
  compositionWidth,
  compositionHeight,
  requestId,
}: TimelineAssetInsertRequest & {
  frame: number;
  fps: number;
  compositionWidth: number;
  compositionHeight: number;
}): { asset: Asset; track: Track } {
  const asset = normalizeEditorAsset(input);
  const sourceNodeId = asset.sourceNodeId ?? asset.id;
  const backingAssetId = asset.backingAssetId ?? asset.id;
  const canvasRatio = compositionWidth / compositionHeight;
  const assetRatio = asset.width && asset.height ? asset.width / asset.height : null;
  const properties = assetRatio
    ? assetRatio >= canvasRatio
      ? { x: 0, y: 0, width: 1, height: canvasRatio / assetRatio, rotation: 0, opacity: 1 }
      : { x: 0, y: 0, width: assetRatio / canvasRatio, height: 1, rotation: 0, opacity: 1 }
    : { x: 0, y: 0, width: 1, height: 1, rotation: 0, opacity: 1 };
  const durationInFrames = asset.type === 'image'
    ? 90
    : asset.duration
      ? Math.max(1, Math.round(asset.duration * fps))
      : 90;
  const common = {
    id: `item-${requestId}`,
    assetId: backingAssetId,
    sourceNodeId,
    from: Math.max(0, Math.round(frame)),
    durationInFrames,
    src: asset.src,
    properties,
  };
  const item: Item = asset.type === 'image'
    ? { ...common, type: 'image' }
    : asset.type === 'video'
      ? { ...common, type: 'video', sourceStartInFrames: 0, waveform: asset.waveform }
      : { ...common, type: 'audio', sourceStartInFrames: 0, waveform: asset.waveform };

  return {
    asset,
    track: {
      id: `track-${requestId}`,
      name: asset.type.charAt(0).toUpperCase() + asset.type.slice(1),
      items: [item],
    },
  };
}
