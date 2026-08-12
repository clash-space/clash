import { describe, expect, it } from 'vitest';
import {
  ACTION_INVOCATION_MODE,
  ASSET_ACTION_ID,
  BUILT_IN_ASSET_ACTION_SPECS,
  createAssetActionInvocation,
  resolveAssetActionOutputKind,
} from './asset-edit.js';

describe('asset edit action specs', () => {
  it('declares edit capabilities as serializable action specs', () => {
    expect(BUILT_IN_ASSET_ACTION_SPECS[ASSET_ACTION_ID.ImageEditor]).toMatchObject({
      family: 'edit',
      inputKinds: ['image'],
      operations: [{ id: 'transform', executor: 'client-render', outputKind: 'image' }],
    });
    expect(BUILT_IN_ASSET_ACTION_SPECS[ASSET_ACTION_ID.VideoClipper].operations).toEqual([
      { id: 'screenshot', executor: 'client-render', outputKind: 'image' },
      { id: 'crop', executor: 'server-transform', outputKind: 'video' },
    ]);
  });

  it('derives explicit canvas and implicit preview invocations from the same spec', () => {
    const base = {
      actionId: ASSET_ACTION_ID.ImageEditor,
      projectId: 'project-1',
      source: { assetId: 'asset-1', kind: 'image' as const },
      params: { rotation: 90 as const },
    };

    expect(createAssetActionInvocation({ ...base, surface: 'canvas' })).toMatchObject({
      actionId: 'image-editor',
      mode: ACTION_INVOCATION_MODE.Explicit,
      surface: 'canvas',
    });
    expect(createAssetActionInvocation({ ...base, surface: 'asset-preview' })).toMatchObject({
      actionId: 'image-editor',
      mode: ACTION_INVOCATION_MODE.Implicit,
      surface: 'asset-preview',
    });
  });

  it('resolves operation-specific output kinds from the action spec', () => {
    expect(resolveAssetActionOutputKind(ASSET_ACTION_ID.VideoClipper, { mode: 'screenshot', frameTimeSec: 1 })).toBe('image');
    expect(resolveAssetActionOutputKind(ASSET_ACTION_ID.VideoClipper, { mode: 'crop', startSec: 1, endSec: 2 })).toBe('video');
  });
});
