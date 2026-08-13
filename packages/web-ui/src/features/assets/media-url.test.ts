import { afterEach, describe, expect, it } from 'vitest';
import type { ResolvedAsset } from '@clash/shared-types';
import {
  assetPreviewMedia,
  projectAssetPlaybackUrl,
  resolveAssetMediaUrl,
} from './media-url';

function resolvedAsset(overrides: Partial<ResolvedAsset> = {}): ResolvedAsset {
  return {
    id: 'asset-1',
    kind: 'video',
    name: 'Talking head',
    metadata: {},
    lifecycle: { state: 'active' },
    status: 'ready',
    url: 'https://media.clash.test/assets/asset-1',
    thumbnailUrl: 'https://media.clash.test/thumbnails/asset-1',
    ...overrides,
  };
}

afterEach(() => {
  globalThis.__CLASH_RUNTIME_CONFIG__ = undefined;
});

describe('ResolvedAsset media projection', () => {
  it('uses the Host-projected playback URL without reconstructing storage paths', () => {
    expect(projectAssetPlaybackUrl(resolvedAsset())).toBe(
      'https://media.clash.test/assets/asset-1',
    );
  });

  it('uses thumbnailUrl only for previews and falls back to video playback', () => {
    expect(assetPreviewMedia(resolvedAsset())).toEqual({
      kind: 'image',
      source: 'https://media.clash.test/thumbnails/asset-1',
    });
    expect(assetPreviewMedia(resolvedAsset({ thumbnailUrl: undefined }))).toEqual({
      kind: 'video',
      source: 'https://media.clash.test/assets/asset-1',
    });
  });

  it('does not rewrite a URL against the runtime API origin', () => {
    globalThis.__CLASH_RUNTIME_CONFIG__ = { apiBaseUrl: 'http://127.0.0.1:49920' };
    expect(resolveAssetMediaUrl('/host-projected/media/asset-1')).toBe(
      '/host-projected/media/asset-1',
    );
  });
});
