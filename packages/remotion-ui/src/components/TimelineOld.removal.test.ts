import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('legacy Timeline.old surface', () => {
  it('does not keep the unreferenced legacy timeline GUI in source', () => {
    expect(
      existsSync(join(process.cwd(), 'packages/remotion-ui/src/components/Timeline.old.tsx')),
    ).toBe(false);
  });
});
