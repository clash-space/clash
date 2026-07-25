import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyVideoCrop } from './editPipeline';

describe('applyVideoCrop', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('routes time-range edits through the server and marks preview edits implicit', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      assetId: 'edited-video', srcR2Key: 'edits/video.mp4', coverR2Key: null,
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
});
