import type { ResolvedAsset } from '@clash/shared-types';

/** Canonical resolver for every asset preview, thumbnail, and media player. */
export function resolveAssetMediaUrl(value?: string | null): string | null {
  const source = value?.trim();
  return source || null;
}

export function firstAssetMediaUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const resolved = resolveAssetMediaUrl(value);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * The Host owns URL projection. UI consumers never reconstruct object-store
 * paths or sign storage keys.
 */
export function projectAssetPlaybackUrl(asset: ResolvedAsset): string | null {
  return resolveAssetMediaUrl(asset.url);
}

export type AssetPreviewMedia = {
  kind: 'image' | 'video';
  source: string;
};

/**
 * Adapts the canonical Host-resolved view to the small preview contract.
 */
export function assetPreviewMedia(asset: ResolvedAsset): AssetPreviewMedia | null {
  const source = resolveAssetMediaUrl(asset.url);
  const thumbnail = resolveAssetMediaUrl(asset.thumbnailUrl);
  if (asset.kind === 'image') {
    const preview = thumbnail ?? source;
    return preview ? { kind: 'image', source: preview } : null;
  }
  if (asset.kind !== 'video') return null;
  if (thumbnail) return { kind: 'image', source: thumbnail };
  return source ? { kind: 'video', source } : null;
}
