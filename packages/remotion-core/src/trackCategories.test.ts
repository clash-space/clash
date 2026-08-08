import { describe, expect, it } from 'vitest';

import { itemTrackCategory } from './trackCategories';

describe('Timeline track category inference', () => {
  it('treats a Remotion composition as a visual Timeline asset', () => {
    expect(itemTrackCategory({ type: 'composition' })).toBe('visual');
  });
});
