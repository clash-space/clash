type AssetDropDataTransfer = Pick<DataTransfer, 'getData'>;

type TimelineAsset = {
  id: string;
  type: string;
  [key: string]: unknown;
};

function serializedAsset(dataTransfer: AssetDropDataTransfer): TimelineAsset | undefined {
  const value = dataTransfer.getData('asset');
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.id !== 'string' || typeof candidate.type !== 'string') return undefined;
    return candidate as TimelineAsset;
  } catch {
    return undefined;
  }
}

/**
 * Resolves both assets already admitted to the Timeline scope and the payload
 * of a Project-sidebar drag. The latter bridges the single drop event while
 * the host persists the new scope reference.
 */
export function resolveAssetDropPayload<T extends TimelineAsset>({
  assetId,
  dataTransfer,
  assets,
  currentDraggedAsset,
}: {
  assetId?: string;
  dataTransfer: AssetDropDataTransfer;
  assets: readonly T[];
  currentDraggedAsset?: T | null;
}): T | TimelineAsset | undefined {
  const scopedAsset = assetId ? assets.find((asset) => asset.id === assetId) : undefined;
  if (scopedAsset) return scopedAsset;
  if (currentDraggedAsset && (!assetId || currentDraggedAsset.id === assetId)) return currentDraggedAsset;
  const payload = serializedAsset(dataTransfer);
  return payload && (!assetId || payload.id === assetId) ? payload : undefined;
}
