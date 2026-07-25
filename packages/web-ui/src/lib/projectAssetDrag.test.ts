import { afterEach, describe, expect, it } from 'vitest';
import type { ProjectAsset } from './types';
import {
    PROJECT_ASSET_DRAG_MIME,
    hasProjectAssetDragData,
    readProjectAssetDrag,
    readProjectAssetDragId,
    writeProjectAssetDrag,
} from './projectAssetDrag';

afterEach(() => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
});

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
        name: 'Edited image',
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
            name: 'Edited image',
            src: '/assets/hero.png',
            type: 'image',
        });
        expect(JSON.parse(transfer.getData(PROJECT_ASSET_DRAG_MIME))).toEqual({ assetId: 'asset-ref-1' });
        expect(hasProjectAssetDragData(transfer)).toBe(true);
    });

    it('writes a desktop-local API URL instead of a Vite-relative media URL', () => {
        globalThis.__CLASH_RUNTIME_CONFIG__ = {
            mode: 'desktop',
            apiBaseUrl: 'http://127.0.0.1:49920',
        };
        const transfer = createDataTransfer();

        writeProjectAssetDrag(transfer, asset);

        expect(JSON.parse(transfer.getData('asset'))).toMatchObject({
            src: 'http://127.0.0.1:49920/assets/hero.png',
        });
    });

    it('drags the playable video source instead of its cover preview', () => {
        const transfer = createDataTransfer();

        writeProjectAssetDrag(transfer, {
            id: 'video-ref',
            assetId: 'video-asset',
            name: 'Talking head',
            url: '/assets/covers/talking-head.png',
            thumbnailUrl: '/assets/covers/talking-head.png',
            type: 'video',
            storageKey: 'local-blobs/video/original.mp4',
            createdAt: null,
        });

        expect(JSON.parse(transfer.getData('asset'))).toMatchObject({
            src: '/assets/local-blobs/video/original.mp4',
        });
    });

    it('resolves a drop back to the canonical project asset', () => {
        const transfer = createDataTransfer();
        writeProjectAssetDrag(transfer, asset);

        expect(readProjectAssetDrag(transfer, [asset])).toBe(asset);
        expect(readProjectAssetDragId(transfer)).toBe(asset.id);
        expect(readProjectAssetDrag(createDataTransfer(), [asset])).toBeUndefined();
    });

    it('accepts the text/plain fallback preserved by native cross-surface drags', () => {
        const transfer = createDataTransfer();
        transfer.setData('text/plain', asset.id);

        expect(hasProjectAssetDragData(transfer)).toBe(true);
        expect(readProjectAssetDrag(transfer, [asset])).toBe(asset);
    });

    it('does not misclassify a Timeline Library drag as a Project Asset', () => {
        const transfer = createDataTransfer();
        transfer.setData('application/x-clash-timeline-library', 'transition-prism-split');
        transfer.setData('text/plain', 'transition-prism-split');

        expect(hasProjectAssetDragData(transfer)).toBe(false);
    });
});
