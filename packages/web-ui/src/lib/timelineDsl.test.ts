import { describe, expect, it } from 'vitest';
import type { Track } from '@master-clash/remotion-core';
import { stripSrcFromTracks } from './timelineDsl';

describe('stripSrcFromTracks', () => {
    it('preserves self-contained data sources while stripping external media URLs', () => {
        const tracks: Track[] = [{
            id: 'visuals',
            name: 'Visuals',
            items: [
                {
                    id: 'spark',
                    type: 'sticker',
                    from: 0,
                    durationInFrames: 90,
                    src: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
                },
                {
                    id: 'photo',
                    type: 'image',
                    from: 0,
                    durationInFrames: 90,
                    src: 'https://signed.example.test/photo.jpg?token=stale',
                    sourceNodeId: 'canvas-photo',
                    assetId: 'asset-photo',
                },
            ],
        }];

        const items = stripSrcFromTracks(tracks)[0]!.items;

        expect(items[0]).toMatchObject({
            id: 'spark',
            src: 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E',
        });
        expect(items[1]).not.toHaveProperty('src');
        expect(items[1]).toMatchObject({
            sourceNodeId: 'canvas-photo',
            assetId: 'asset-photo',
        });
    });
});
