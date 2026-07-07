const MEDIA_NODE_TYPES = new Set(["image", "video", "audio"]);

export function isMediaNodeType(type: string): boolean {
  return MEDIA_NODE_TYPES.has(type);
}

export function createMediaAssetCowNodeData(options: {
  sourceNodeId: string;
  sourceLabel?: string;
  sourceAssetId?: string;
  assetId: string;
  label?: string;
}): Record<string, unknown> {
  const sourceLabel = options.sourceLabel?.trim();
  const label = options.label?.trim() || (sourceLabel ? `${sourceLabel} (copy)` : `Copy of ${options.sourceNodeId}`);
  return {
    label,
    status: "completed",
    assetId: options.assetId,
    copyOnWrite: true,
    copyOnWriteKind: "media-asset-replacement",
    sourceMediaNodeId: options.sourceNodeId,
    ...(options.sourceAssetId ? { sourceAssetId: options.sourceAssetId } : {}),
  };
}
