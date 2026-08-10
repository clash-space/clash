// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import VideoEditorNode from './VideoEditorNode';
import { assetPreviewMedia } from '../../features/assets/media-url';

const mocks = vi.hoisted(() => ({
    nodes: [
        {
            id: 'video-node',
            type: 'video',
            position: { x: 0, y: 0 },
            data: { assetId: 'video-asset' },
        },
        {
            id: 'audio-node',
            type: 'audio',
            position: { x: 0, y: 0 },
            data: { assetId: 'audio-asset' },
        },
    ],
    timelineState: {
        tracks: [
            {
                id: 'primary',
                items: [
                    {
                        id: 'clip-1',
                        type: 'video',
                        from: 0,
                        durationInFrames: 90,
                        sourceNodeId: 'video-node',
                    },
                ] as Array<{
                    id: string;
                    type: string;
                    from: number;
                    durationInFrames: number;
                    sourceNodeId: string;
                    assetId?: string;
                }>,
            },
        ],
    },
    asset: {
        id: 'video-asset',
        kind: 'video',
        srcR2Key: 'legacy-storage/video-without-extension',
        coverR2Key: 'legacy-storage/video-cover.webp' as string | null,
        signedUrl: 'https://media.clash.test/video',
        signedCoverUrl: 'https://media.clash.test/video-cover.webp' as string | undefined,
        metadata: {},
    },
    audioAsset: {
        id: 'audio-asset',
        kind: 'audio',
        srcR2Key: 'legacy-storage/narration-without-extension',
        signedUrl: 'https://media.clash.test/narration',
        metadata: {},
    },
}));

vi.mock('@xyflow/react', () => ({
    Handle: () => null,
    Position: { Left: 'left', Right: 'right' },
    useReactFlow: () => ({
        getNodes: () => mocks.nodes,
        getEdges: () => [],
        addNodes: vi.fn(),
        addEdges: vi.fn(),
        getNode: vi.fn(),
        setNodes: vi.fn(),
    }),
}));

vi.mock('../VideoEditorContext', () => ({
    useVideoEditor: () => ({ openTimeline: vi.fn() }),
}));

vi.mock('../LoroSyncContext', () => ({
    useOptionalLoroSyncContext: () => ({
        doc: {
            subscribe: () => () => undefined,
            getMap: () => ({
                get: () => ({ data: { timelineId: 'timeline-1' } }),
            }),
        },
    }),
}));

// Replacing the whole module dropped every other export the component tree reads,
// so keep the real module and override only the lookup this test controls.
vi.mock('@clash/shared-types', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@clash/shared-types')>()),
    listProjectTimelines: () => [
        {
            id: 'timeline-1',
            revisionId: 'revision-1',
            state: mocks.timelineState,
        },
    ],
}));

vi.mock('@clash/web-ui/lib/hooks/useAsset', () => ({
    getAsset: vi.fn(async (assetId: string) =>
        assetId === mocks.audioAsset.id ? mocks.audioAsset : mocks.asset),
}));

vi.mock('@clash/web-ui/lib/hooks/useSignedUrl', () => ({
    useSignedUrl: (src?: string) => {
        if (src === mocks.asset.coverR2Key) return mocks.asset.signedCoverUrl ?? '';
        if (src === mocks.asset.srcR2Key) return mocks.asset.signedUrl;
        if (src === mocks.audioAsset.srcR2Key) return mocks.audioAsset.signedUrl;
        return src ?? '';
    },
}));

const baseNodeProps = {
    selected: false,
    dragging: false,
    draggable: true,
    selectable: true,
    deletable: true,
    zIndex: 1,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
};

afterEach(() => {
    cleanup();
    mocks.asset.coverR2Key = 'legacy-storage/video-cover.webp';
    mocks.asset.signedCoverUrl = 'https://media.clash.test/video-cover.webp';
    mocks.nodes = [
        {
            id: 'video-node',
            type: 'video',
            position: { x: 0, y: 0 },
            data: { assetId: 'video-asset' },
        },
        {
            id: 'audio-node',
            type: 'audio',
            position: { x: 0, y: 0 },
            data: { assetId: 'audio-asset' },
        },
    ];
    mocks.timelineState.tracks[0].items = [
        {
            id: 'clip-1',
            type: 'video',
            from: 0,
            durationInFrames: 90,
            sourceNodeId: 'video-node',
        },
    ];
});

describe('VideoEditorNode cover', () => {
    it('keeps the preview locator stable instead of capturing an expiring delivery URL', () => {
        expect(assetPreviewMedia(mocks.asset as never)).toEqual({
            kind: 'image',
            source: mocks.asset.coverR2Key,
        });
    });

    it('uses the asset media URL for a persisted video cover', async () => {
        render(
            <VideoEditorNode
                {...baseNodeProps}
                id="timeline-action"
                type="videoEditor"
                data={{ timelineId: 'timeline-1' }}
            />,
        );

        await waitFor(() => {
            expect(document.querySelector('img')?.getAttribute('src')).toBe(mocks.asset.signedCoverUrl);
        });
    });

    it('renders a local video source when its cover is not available yet', async () => {
        mocks.asset.coverR2Key = null;
        mocks.asset.signedCoverUrl = undefined;

        render(
            <VideoEditorNode
                {...baseNodeProps}
                id="timeline-action"
                type="videoEditor"
                data={{ timelineId: 'timeline-1' }}
            />,
        );

        await waitFor(() => {
            expect(document.querySelector('video')?.getAttribute('src')).toBe(mocks.asset.signedUrl);
        });
        expect(document.querySelector('img')).toBeNull();
    });

    it('uses the earliest visual asset instead of an earlier audio item', async () => {
        mocks.timelineState.tracks[0].items = [
            {
                id: 'narration',
                type: 'audio',
                from: 0,
                durationInFrames: 120,
                sourceNodeId: 'audio-node',
            },
            {
                id: 'clip-1',
                type: 'video',
                from: 30,
                durationInFrames: 90,
                sourceNodeId: 'video-node',
            },
        ];

        render(
            <VideoEditorNode
                {...baseNodeProps}
                id="timeline-action"
                type="videoEditor"
                data={{ timelineId: 'timeline-1' }}
            />,
        );

        await waitFor(() => {
            expect(document.querySelector('img')?.getAttribute('src')).toBe(mocks.asset.signedCoverUrl);
        });
    });

    it('resolves a project or local asset directly when no Canvas node exists', async () => {
        mocks.nodes = [];
        mocks.timelineState.tracks[0].items = [
            {
                id: 'clip-1',
                type: 'video',
                from: 0,
                durationInFrames: 90,
                sourceNodeId: 'timeline-asset:video-asset',
                assetId: 'video-asset',
            },
        ];

        render(
            <VideoEditorNode
                {...baseNodeProps}
                id="timeline-action"
                type="videoEditor"
                data={{ timelineId: 'timeline-1' }}
            />,
        );

        await waitFor(() => {
            expect(document.querySelector('img')?.getAttribute('src')).toBe(mocks.asset.signedCoverUrl);
        });
    });
});
