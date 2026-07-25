import type { Asset } from '../types';

export type EditorAssetInput = Partial<Asset> & {
  type: Asset['type'];
  src?: string;
  url?: string;
};

export function getEditorAssetKey(asset: Pick<EditorAssetInput, 'id' | 'src' | 'sourceNodeId'>): string {
  return asset.sourceNodeId || asset.id || asset.src || '';
}

export function normalizeEditorAsset(asset: EditorAssetInput): Asset {
  const normalizedType =
    asset.type === 'video' ? 'video' : asset.type === 'image' ? 'image' : 'audio';

  return {
    id: asset.id || `asset-${Date.now()}-${Math.random()}`,
    name: safeEditorAssetName(asset.name, normalizedType),
    type: normalizedType,
    src: asset.src || asset.url || '',
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    thumbnail: asset.thumbnail,
    thumbnailFrameCount: asset.thumbnailFrameCount,
    thumbnailFrameWidth: asset.thumbnailFrameWidth,
    waveform: asset.waveform,
    createdAt: asset.createdAt ?? Date.now(),
    readOnly: asset.readOnly ?? true,
    sourceNodeId: asset.sourceNodeId,
    backingAssetId: asset.backingAssetId,
  };
}

function safeEditorAssetName(name: string | undefined, type: Asset['type']): string {
  const fallback = type.charAt(0).toUpperCase() + type.slice(1);
  const value = name?.trim();
  if (!value) return fallback;
  const looksInternal =
    /^(?:https?:|file:|data:)/i.test(value) ||
    /[\\/]/.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  return looksInternal ? fallback : value;
}
