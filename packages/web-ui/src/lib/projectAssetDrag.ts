import type { ProjectAsset } from './types';

export const PROJECT_ASSET_DRAG_MIME = 'application/x-clash-project-asset';

function remotionAssetPayload(asset: ProjectAsset) {
    return {
        id: asset.id,
        backingAssetId: asset.assetId ?? asset.id,
        sourceNodeId: asset.id,
        name: asset.storageKey ?? asset.id,
        src: asset.url,
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
    return Array.from(dataTransfer.types).some((type) => {
        const normalized = type.toLocaleLowerCase();
        return normalized === PROJECT_ASSET_DRAG_MIME || normalized === 'assetid' || normalized === 'text/plain';
    });
}

export function readProjectAssetDrag(
    dataTransfer: DataTransfer,
    assets: readonly ProjectAsset[],
): ProjectAsset | undefined {
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
    return assets.find((asset) => asset.id === assetId);
}
