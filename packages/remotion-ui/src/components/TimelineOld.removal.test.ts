import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('legacy Timeline.old surface', () => {
  it('does not keep the unreferenced legacy timeline GUI in source', () => {
    expect(existsSync(new URL('./Timeline.old.tsx', import.meta.url))).toBe(false);
  });
});
