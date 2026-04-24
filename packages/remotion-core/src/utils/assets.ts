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
    name: asset.name || 'Imported Asset',
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
