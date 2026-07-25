import { runtimeApiUrl, runtimeAssetFallbackUrl } from '../../lib/runtimeConfig';
import type { Asset } from '@clash/shared-types';

const ABSOLUTE_MEDIA_SOURCE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/** Canonical resolver for every asset preview, thumbnail, and media player. */
export function resolveAssetMediaUrl(value?: string | null): string | null {
  const source = value?.trim();
  if (!source) return null;
  if (ABSOLUTE_MEDIA_SOURCE.test(source)) return source;
  if (source.startsWith('/')) return runtimeApiUrl(source);
  return runtimeAssetFallbackUrl(source);
}

export function firstAssetMediaUrl(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const resolved = resolveAssetMediaUrl(value);
    if (resolved) return resolved;
  }
  return null;
}

/**
 * Resolves the media bytes used for playback/editing. ProjectAsset.url may be
 * a video cover, so moving media must prefer the immutable storage source.
 */
export function projectAssetPlaybackUrl(asset: {
  type: 'image' | 'video' | 'audio';
  url?: string | null;
  storageKey?: string | null;
}): string | null {
  const source =
    asset.type === 'video' || asset.type === 'audio'
      ? asset.storageKey || asset.url
      : asset.url || asset.storageKey;
  return resolveAssetMediaUrl(source);
}

export type AssetPreviewMedia = {
  kind: 'image' | 'video';
  source: string;
};

/**
 * Adapts the persisted Asset DTO to the storage-agnostic media contract used
 * by UI previews. Storage-specific wire fields stay behind this boundary.
 */
export function assetPreviewMedia(asset: Asset): AssetPreviewMedia | null {
  const source = asset.srcR2Key || asset.signedUrl;
  if (!source) return null;

  if (asset.kind === 'image') return { kind: 'image', source };
  if (asset.kind !== 'video') return null;

  const cover = asset.coverR2Key || asset.signedCoverUrl;
  return cover
    ? { kind: 'image', source: cover }
    : { kind: 'video', source };
}
