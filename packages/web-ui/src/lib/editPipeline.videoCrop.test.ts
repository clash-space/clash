import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyVideoCrop } from './editPipeline';

describe('applyVideoCrop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes time-range edits through the server and marks preview edits implicit', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      id: 'edited-video',
      kind: 'video',
      metadata: {},
      lifecycle: { state: 'active' },
      status: 'ready',
      url: 'https://assets.example/edited-video.mp4',
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await applyVideoCrop({
      projectId: 'project-1',
      sourceAssetId: 'source-video',
      params: { mode: 'crop', startSec: 1, endSec: 4 },
      origin: 'asset-preview',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/edits/video-crop', expect.objectContaining({
      method: 'POST',
    }));
    const request = fetchMock.mock.calls[0]![1]!;
    expect(JSON.parse(String(request.body))).toEqual({
      projectId: 'project-1',
      sourceAssetId: 'source-video',
      params: { mode: 'crop', startSec: 1, endSec: 4 },
      origin: 'asset-preview',
      invocation: {
        actionId: 'video-clipper',
        projectId: 'project-1',
        source: { assetId: 'source-video', kind: 'video' },
        params: { mode: 'crop', startSec: 1, endSec: 4 },
        surface: 'asset-preview',
        mode: 'implicit',
      },
    });
  });

  it('rejects a successful HTTP response that is not a ResolvedAsset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ id: 'edited-video' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    );

    await expect(
      applyVideoCrop({
        projectId: 'project-1',
        sourceAssetId: 'source-video',
        params: { mode: 'crop', startSec: 1, endSec: 4 },
      }),
    ).rejects.toThrow();
  });
});
