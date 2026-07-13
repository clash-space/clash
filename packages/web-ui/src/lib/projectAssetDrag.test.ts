import { describe, expect, it } from 'vitest';
import type { ProjectAsset } from './types';
import {
    PROJECT_ASSET_DRAG_MIME,
    hasProjectAssetDragData,
    readProjectAssetDrag,
    writeProjectAssetDrag,
} from './projectAssetDrag';

function createDataTransfer(): DataTransfer {
    const values = new Map<string, string>();
    const transfer = {
        effectAllowed: 'none',
        dropEffect: 'none',
        get types() {
            return [...values.keys()];
        },
        getData(type: string) {
            return values.get(type) ?? '';
        },
        setData(type: string, value: string) {
            values.set(type, value);
        },
    };
    return transfer as unknown as DataTransfer;
}

describe('project asset drag contract', () => {
    const asset: ProjectAsset = {
        id: 'asset-ref-1',
        assetId: 'sha256-source-1',
        url: '/assets/hero.png',
        type: 'image',
        storageKey: 'shots/hero.png',
        createdAt: null,
    };

    it('writes one payload understood by both the Canvas and Remotion Timeline', () => {
        const transfer = createDataTransfer();

        writeProjectAssetDrag(transfer, asset);

        expect(transfer.effectAllowed).toBe('copy');
        expect(transfer.getData('assetId')).toBe('asset-ref-1');
        expect(transfer.getData('text/plain')).toBe('asset-ref-1');
        expect(JSON.parse(transfer.getData('asset'))).toMatchObject({
            id: 'asset-ref-1',
            backingAssetId: 'sha256-source-1',
            sourceNodeId: 'asset-ref-1',
            name: 'shots/hero.png',
            src: '/assets/hero.png',
            type: 'image',
        });
        expect(JSON.parse(transfer.getData(PROJECT_ASSET_DRAG_MIME))).toEqual({ assetId: 'asset-ref-1' });
        expect(hasProjectAssetDragData(transfer)).toBe(true);
    });

    it('resolves a drop back to the canonical project asset', () => {
        const transfer = createDataTransfer();
        writeProjectAssetDrag(transfer, asset);

        expect(readProjectAssetDrag(transfer, [asset])).toBe(asset);
        expect(readProjectAssetDrag(createDataTransfer(), [asset])).toBeUndefined();
    });

    it('accepts the text/plain fallback preserved by native cross-surface drags', () => {
        const transfer = createDataTransfer();
        transfer.setData('text/plain', asset.id);

        expect(hasProjectAssetDragData(transfer)).toBe(true);
        expect(readProjectAssetDrag(transfer, [asset])).toBe(asset);
    });
});
