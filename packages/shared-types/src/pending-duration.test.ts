import { describe, expect, it } from 'vitest';

import { buildPendingAssetNode } from './canvas';
import { MODEL_CARDS } from './models';
import { validateModelCardConfiguration } from './model-constraints';

/**
 * A pending video node must not invent a duration its own model rejects.
 *
 * `buildPendingAssetNode` stamped `modelParams.duration ?? 5` onto every video node, then
 * ran the result through `parseInt`, so a Card whose menu offers `auto` alongside numbers
 * lost the sentinel twice over: `parseInt('auto')` is NaN, and `NaN || 5` is 5. Five is not
 * on every menu, and the generation died at its own validator before any request was made:
 *
 *   seedance-2-fast-startend  candidates ["auto", 4, 6, 8, 10, 15]
 *   stamped                   5
 *   result                    "Duration must be one of the configured candidates."
 */
describe('pending video nodes carry a duration their Card accepts', () => {
  function pendingDuration(modelId: string, modelParams: Record<string, unknown> = {}) {
    const node = buildPendingAssetNode({
      nodeId: 'pending-1',
      actionType: 'video-gen',
      modelId,
      prompt: 'the helmet turns toward the light',
      modelParams,
    } as Parameters<typeof buildPendingAssetNode>[0]);
    return (node.data as Record<string, unknown>).duration;
  }

  it('keeps a sentinel the Card offers instead of coercing it to a number', () => {
    expect(pendingDuration('seedance-2-fast-startend', { duration: 'auto' })).toBe('auto');
  });

  it('falls back to what the Card declares, not to a house number', () => {
    const card = MODEL_CARDS.find(candidate => candidate.id === 'seedance-2-fast-startend')!;
    expect(pendingDuration('seedance-2-fast-startend')).toBe(card.defaultParams.duration);
  });

  it('never stamps a duration any video Card would reject', () => {
    const offenders = MODEL_CARDS
      .filter(card => card.kind === 'video')
      .map(card => ({ id: card.id, duration: pendingDuration(card.id) }))
      .filter(({ id, duration }) => {
        const card = MODEL_CARDS.find(candidate => candidate.id === id)!;
        if (duration === undefined) return false;
        return validateModelCardConfiguration(card, {
          prompt: 'the helmet turns toward the light',
          modelParams: { duration: duration as string | number },
        }) !== null;
      });
    expect(offenders).toEqual([]);
  });

  it('still honours an explicit numeric duration', () => {
    expect(pendingDuration('seedance-2-fast-startend', { duration: 8 })).toBe(8);
  });
});
