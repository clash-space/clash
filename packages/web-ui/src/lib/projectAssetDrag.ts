import type { ProjectAsset } from './types';
import { projectAssetPlaybackUrl } from '../features/assets/media-url';

export const PROJECT_ASSET_DRAG_MIME = 'application/x-clash-project-asset';

function dragAssetSource(asset: ProjectAsset): string {
    return projectAssetPlaybackUrl(asset) ?? '';
}

function remotionAssetPayload(asset: ProjectAsset) {
    return {
        id: asset.id,
        backingAssetId: asset.assetId ?? asset.id,
        sourceNodeId: asset.id,
        name: asset.name?.trim() || `${asset.type.charAt(0).toUpperCase()}${asset.type.slice(1)}`,
        src: dragAssetSource(asset),
        type: asset.type,
    };
}

export function writeProjectAssetDrag(dataTransfer: DataTransfer, asset: ProjectAsset): void {
    dataTransfer.effectAllowed = 'copy';
    dataTransfer.setData(PROJECT_ASSET_DRAG_MIME, JSON.stringify({ assetId: asset.id }));

    // These fields are the existing Remotion editor drag contract.
    dataTransfer.setData('text/plain', asset.id);
    dataTransfer.setData('assetId', asset.id);
    dataTransfer.setData('asset', JSON.stringify(remotionAssetPayload(asset)));
}

export function hasProjectAssetDragData(dataTransfer: DataTransfer): boolean {
    const types = Array.from(dataTransfer.types, (type) => type.toLocaleLowerCase());
    if (types.includes(PROJECT_ASSET_DRAG_MIME) || types.includes('assetid')) return true;

    // Keep the native text fallback for older cross-surface asset drags, but
    // never let another Clash drag contract masquerade as a Project Asset.
    if (types.some((type) => type.startsWith('application/x-clash-'))) return false;
    return types.includes('text/plain');
}

export function readProjectAssetDrag(
    dataTransfer: DataTransfer,
    assets: readonly ProjectAsset[],
): ProjectAsset | undefined {
    const assetId = readProjectAssetDragId(dataTransfer);
    return assetId ? assets.find((asset) => asset.id === assetId) : undefined;
}

export function readProjectAssetDragId(dataTransfer: DataTransfer): string | undefined {
    let assetId = '';
    const clashPayload = dataTransfer.getData(PROJECT_ASSET_DRAG_MIME);
    if (clashPayload) {
        try {
            const parsed = JSON.parse(clashPayload) as { assetId?: unknown };
            if (typeof parsed.assetId === 'string') assetId = parsed.assetId;
        } catch {
            return undefined;
        }
    }
    assetId ||= dataTransfer.getData('assetId');
    assetId ||= dataTransfer.getData('text/plain');
    return assetId || undefined;
}
