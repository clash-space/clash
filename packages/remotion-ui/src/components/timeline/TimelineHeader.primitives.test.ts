import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TimelineHeader primitives', () => {
  it('routes the play control through remotion-ui button primitives', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/timeline/TimelineHeader.tsx'),
      'utf8',
    );

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineIconButton');
    expect(source).not.toContain('<button');
  });
});
