import type { Asset, BaseItem, Item } from '../types';

type TimelineItemRef = Pick<BaseItem, 'assetId' | 'sourceNodeId'>;
type TimelineItemLookup = TimelineItemRef & {
  src?: string;
  type?: Item['type'];
};

function secondsToFrames(seconds: number, fps: number): number {
  return Math.floor(seconds * fps + 1e-6);
}

/**
 * Timeline DSL used to store the source canvas node in `assetId`.
 * Newer items store it explicitly as `sourceNodeId`, while `assetId`
 * matches canvas node `data.assetId` (the D1 asset row id).
 */
export function getItemSourceNodeId(item: TimelineItemRef): string | undefined {
  return item.sourceNodeId ?? item.assetId;
}

export function getItemLookupIds(item: TimelineItemRef): string[] {
  const ids = [item.sourceNodeId, item.assetId].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  return Array.from(new Set(ids));
}

export function findAssetForItem(item: TimelineItemLookup, assets: Asset[]): Asset | null {
  const sourceNodeId = getItemSourceNodeId(item);
  if (sourceNodeId) {
    const found = assets.find((asset) => asset.id === sourceNodeId || asset.sourceNodeId === sourceNodeId);
    if (found) {
      return found;
    }
  }

  if (item.assetId) {
    const found = assets.find((asset) => asset.backingAssetId === item.assetId || asset.id === item.assetId);
    if (found) {
      return found;
    }
  }

  if (item.src) {
    return assets.find((asset) => asset.src === item.src) ?? null;
  }

  return null;
}

export function getItemResolvedType(item: TimelineItemLookup, assets: Asset[]): Item['type'] | undefined {
  return item.type ?? findAssetForItem(item, assets)?.type;
}

export function getItemResolvedSrc(item: TimelineItemLookup, assets: Asset[]): string | undefined {
  return item.src || findAssetForItem(item, assets)?.src;
}

export function getItemAssetDurationInFrames(
  item: TimelineItemLookup,
  assets: Asset[],
  fps: number
): number | undefined {
  const duration = findAssetForItem(item, assets)?.duration;
  if (typeof duration !== 'number' || duration <= 0) {
    return undefined;
  }

  return secondsToFrames(duration, fps);
}
