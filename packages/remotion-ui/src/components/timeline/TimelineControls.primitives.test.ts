import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('TimelineControls primitives', () => {
  it('routes timeline buttons and range inputs through remotion-ui primitives', () => {
    const source = readFileSync(
      join(process.cwd(), 'packages/remotion-ui/src/components/timeline/TimelineControls.tsx'),
      'utf8',
    );

    expect(source).toContain('../ui/controls');
    expect(source).toContain('<TimelineIconButton');
    expect(source).toContain('<TimelineRangeInput');
    expect(source).not.toContain('<button');
    expect(source).not.toContain('<input');
  });
});
